from __future__ import annotations

import hmac
import io
import json
import os
import time
from typing import Any

import numpy as np
import pandas as pd
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from scipy.stats import skew
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import (
    GradientBoostingClassifier,
    GradientBoostingRegressor,
    RandomForestClassifier,
    RandomForestRegressor,
)
from sklearn.impute import SimpleImputer
from sklearn.inspection import permutation_importance
from sklearn.linear_model import Lasso, LinearRegression, LogisticRegression, Ridge
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    mean_absolute_error,
    mean_squared_error,
    precision_score,
    r2_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor
from sklearn.neighbors import KNeighborsClassifier
from sklearn.svm import SVC

MAX_FILE_BYTES = 100 * 1024 * 1024
app = FastAPI(title="InsightForge Compute", docs_url=None, redoc_url=None)


@app.middleware("http")
async def require_internal_token(request, call_next):
    if request.url.path != "/healthz":
        expected = os.environ.get("SESSION_SECRET", "")
        supplied = request.headers.get("x-service-token", "")
        if not expected or not supplied or not hmac.compare_digest(expected, supplied):
            return Response(status_code=401, content="Unauthorized")
    return await call_next(request)


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


def read_frame(upload: UploadFile) -> pd.DataFrame:
    filename = (upload.filename or "dataset.csv").lower()
    content = upload.file.read(MAX_FILE_BYTES + 1)
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    if len(content) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="The dataset exceeds 100 MB.")
    source = io.BytesIO(content)
    try:
        if filename.endswith(".csv"):
            frame = pd.read_csv(source, low_memory=False)
        elif filename.endswith(".xlsx") or filename.endswith(".xls"):
            frame = pd.read_excel(source)
        elif filename.endswith(".json"):
            frame = pd.read_json(source)
        else:
            raise HTTPException(
                status_code=400,
                detail="Supported formats are CSV, XLSX, and JSON.",
            )
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=400,
            detail=f"Could not parse the dataset: {str(error)[:240]}",
        ) from error
    if frame.empty or len(frame.columns) == 0:
        raise HTTPException(status_code=400, detail="The dataset has no rows or columns.")
    if len(frame.columns) > 500:
        raise HTTPException(status_code=400, detail="Datasets may have at most 500 columns.")
    if len(frame) > 1_000_000:
        raise HTTPException(status_code=400, detail="Datasets may have at most 1,000,000 rows.")
    return frame


def clean_value(value: Any) -> Any:
    if value is None or value is pd.NA:
        return None
    if isinstance(value, (np.bool_, bool)):
        return bool(value)
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        return float(value) if np.isfinite(value) else None
    if isinstance(value, (np.datetime64, pd.Timestamp)):
        return value.isoformat()
    if isinstance(value, (np.ndarray,)):
        return [clean_value(item) for item in value.tolist()]
    if isinstance(value, dict):
        return {str(key): clean_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean_value(item) for item in value]
    if pd.isna(value):
        return None
    return value.item() if hasattr(value, "item") else value


def frame_profile(frame: pd.DataFrame) -> dict[str, Any]:
    rows = len(frame)
    columns = []
    missing_cells = int(frame.isna().sum().sum())
    type_counts = {"numeric": 0, "categorical": 0, "datetime": 0, "boolean": 0}
    for name in frame.columns:
        series = frame[name]
        missing = int(series.isna().sum())
        unique = int(series.nunique(dropna=True))
        if pd.api.types.is_bool_dtype(series):
            data_type = "boolean"
        elif pd.api.types.is_numeric_dtype(series):
            data_type = "numeric"
        elif pd.api.types.is_datetime64_any_dtype(series):
            data_type = "datetime"
        else:
            data_type = "categorical" if unique <= min(50, max(20, rows // 10)) else "text"
        type_counts[data_type if data_type in type_counts else "categorical"] += 1
        item: dict[str, Any] = {
            "name": str(name),
            "dataType": data_type,
            "missingCount": missing,
            "missingPct": round(missing / max(rows, 1) * 100, 2),
            "uniqueCount": unique,
            "sampleValues": [clean_value(value) for value in series.dropna().head(5).tolist()],
        }
        if data_type == "numeric":
            numeric = pd.to_numeric(series, errors="coerce").dropna()
            if len(numeric):
                item.update(
                    {
                        "mean": clean_value(numeric.mean()),
                        "median": clean_value(numeric.median()),
                        "std": clean_value(numeric.std()),
                        "min": clean_value(numeric.min()),
                        "max": clean_value(numeric.max()),
                    }
                )
        else:
            top = series.dropna().astype(str).value_counts().head(1)
            if len(top):
                item["topValue"] = str(top.index[0])
                item["topCount"] = int(top.iloc[0])
        columns.append(item)

    duplicates = int(frame.duplicated().sum())
    missing_pct = missing_cells / max(rows * len(frame.columns), 1) * 100
    duplicate_pct = duplicates / max(rows, 1) * 100
    quality_score = max(0, min(100, 100 - missing_pct * 0.7 - duplicate_pct * 0.3))
    target_candidates = []
    for column in frame.columns:
        count = int(frame[column].nunique(dropna=True))
        if 1 < count <= min(50, max(20, int(rows * 0.15))):
            target_candidates.append(str(column))
    sample_rows = [
        {str(key): clean_value(value) for key, value in row.items()}
        for row in frame.head(8).to_dict(orient="records")
    ]
    return {
        "rows": rows,
        "columns": len(frame.columns),
        "qualityScore": round(quality_score, 1),
        "targetCandidates": target_candidates,
        "profile": {
            "columns": columns,
            "duplicateRows": duplicates,
            "missingCells": missing_cells,
            "missingPct": round(missing_pct, 2),
            "memoryUsageBytes": int(frame.memory_usage(deep=True).sum()),
            "typeCounts": type_counts,
            "sampleRows": sample_rows,
        },
    }


@app.post("/profile")
def profile(file: UploadFile = File(...)):
    frame = read_frame(file)
    return frame_profile(frame)


@app.post("/statistics")
def statistics(file: UploadFile = File(...)):
    frame = read_frame(file)
    numeric = frame.select_dtypes(include=np.number)
    descriptive = []
    for column in numeric.columns:
        series = numeric[column].dropna()
        if len(series) == 0:
            continue
        descriptive.append(
            {
                "column": str(column),
                "count": int(len(series)),
                "mean": clean_value(series.mean()),
                "median": clean_value(series.median()),
                "std": clean_value(series.std()),
                "min": clean_value(series.min()),
                "q1": clean_value(series.quantile(0.25)),
                "q3": clean_value(series.quantile(0.75)),
                "max": clean_value(series.max()),
                "skew": clean_value(skew(series, nan_policy="omit")) if len(series) > 2 else None,
            }
        )
    categorical = []
    for column in frame.columns:
        if column in numeric.columns:
            continue
        counts = frame[column].dropna().astype(str).value_counts().head(12)
        categorical.append(
            {
                "column": str(column),
                "unique": int(frame[column].nunique(dropna=True)),
                "counts": [{"value": str(key), "count": int(value)} for key, value in counts.items()],
            }
        )
    corr = numeric.corr(numeric_only=True)
    correlation = {
        "columns": [str(column) for column in corr.columns],
        "matrix": [[clean_value(value) for value in row] for row in corr.to_numpy()],
    }
    return {
        "rows": len(frame),
        "numeric": descriptive,
        "categorical": categorical,
        "correlation": correlation,
    }


@app.post("/eda")
def eda(file: UploadFile = File(...), args: str = Form("{}")):
    frame = read_frame(file)
    try:
        options = json.loads(args)
    except json.JSONDecodeError as error:
        raise HTTPException(status_code=400, detail="Invalid chart options.") from error
    chart_type = options.get("chartType")
    x_column = options.get("xColumn")
    y_column = options.get("yColumn")
    if chart_type == "correlation":
        numeric = frame.select_dtypes(include=np.number)
        corr = numeric.corr(numeric_only=True)
        return {
            "chartType": chart_type,
            "columns": [str(column) for column in corr.columns],
            "matrix": [[clean_value(value) for value in row] for row in corr.to_numpy()],
        }
    if x_column not in frame.columns:
        raise HTTPException(status_code=400, detail="Choose a valid X column.")
    if chart_type in {"scatter", "box"} and y_column and y_column not in frame.columns:
        raise HTTPException(status_code=400, detail="Choose a valid Y column.")
    if chart_type == "histogram":
        series = frame[x_column].dropna()
        if pd.api.types.is_numeric_dtype(series):
            counts, edges = np.histogram(series, bins=20)
            points = [
                {"x": clean_value((edges[index] + edges[index + 1]) / 2), "y": int(count)}
                for index, count in enumerate(counts)
            ]
        else:
            counts = series.astype(str).value_counts().head(30)
            points = [{"x": str(name), "y": int(count)} for name, count in counts.items()]
        return {"chartType": chart_type, "xLabel": str(x_column), "points": points}
    if chart_type == "bar":
        aggregation = options.get("aggregation", "count")
        if y_column and y_column in frame.columns and pd.api.types.is_numeric_dtype(frame[y_column]):
            grouped = frame.groupby(x_column, dropna=False)[y_column]
            values = grouped.agg(aggregation if aggregation in {"mean", "median", "sum", "count"} else "mean")
            points = [{"x": str(name), "y": clean_value(value)} for name, value in values.head(50).items()]
        else:
            values = frame[x_column].fillna("(missing)").astype(str).value_counts().head(50)
            points = [{"x": str(name), "y": int(value)} for name, value in values.items()]
        return {"chartType": chart_type, "xLabel": str(x_column), "yLabel": str(y_column or "count"), "points": points}
    if chart_type == "scatter":
        if not y_column:
            raise HTTPException(status_code=400, detail="Choose a Y column for a scatter plot.")
        plot_data = frame[[x_column, y_column]].dropna()
        if not all(pd.api.types.is_numeric_dtype(plot_data[column]) for column in [x_column, y_column]):
            raise HTTPException(status_code=400, detail="Scatter plots require numeric columns.")
        plot_data = plot_data.sample(min(len(plot_data), 1000), random_state=42) if len(plot_data) else plot_data
        return {
            "chartType": chart_type,
            "xLabel": str(x_column),
            "yLabel": str(y_column),
            "points": [
                {"x": clean_value(row[x_column]), "y": clean_value(row[y_column])}
                for _, row in plot_data.iterrows()
            ],
        }
    if chart_type == "box":
        if not pd.api.types.is_numeric_dtype(frame[x_column]):
            raise HTTPException(status_code=400, detail="Box plots require a numeric X column.")
        values = frame[x_column].dropna()
        groups = []
        if y_column and not pd.api.types.is_numeric_dtype(frame[y_column]):
            for name, series in frame.groupby(y_column, dropna=False)[x_column]:
                clean = series.dropna()
                if len(clean):
                    groups.append(
                        {
                            "group": str(name),
                            "count": len(clean),
                            "min": clean_value(clean.min()),
                            "q1": clean_value(clean.quantile(0.25)),
                            "median": clean_value(clean.median()),
                            "q3": clean_value(clean.quantile(0.75)),
                            "max": clean_value(clean.max()),
                        }
                    )
        if not groups and len(values):
            groups.append(
                {
                    "group": "all",
                    "count": len(values),
                    "min": clean_value(values.min()),
                    "q1": clean_value(values.quantile(0.25)),
                    "median": clean_value(values.median()),
                    "q3": clean_value(values.quantile(0.75)),
                    "max": clean_value(values.max()),
                }
            )
        return {"chartType": chart_type, "xLabel": str(x_column), "groups": groups}
    raise HTTPException(status_code=400, detail="Choose a supported chart type.")


@app.post("/clean")
def clean(file: UploadFile = File(...), args: str = Form("{}")):
    frame = read_frame(file)
    try:
        options = json.loads(args)
    except json.JSONDecodeError as error:
        raise HTTPException(status_code=400, detail="Invalid cleaning instructions.") from error
    for operation in options.get("operations", []):
        kind = operation.get("type")
        column = operation.get("column")
        if kind == "remove_duplicates":
            frame = frame.drop_duplicates()
        elif kind == "drop_column":
            if column not in frame.columns:
                raise HTTPException(status_code=400, detail=f"Unknown column: {column}")
            frame = frame.drop(columns=[column])
        elif kind == "fill_missing":
            if column not in frame.columns:
                raise HTTPException(status_code=400, detail=f"Unknown column: {column}")
            value = operation.get("value")
            if value == "median":
                if not pd.api.types.is_numeric_dtype(frame[column]):
                    raise HTTPException(status_code=400, detail="Median fill requires a numeric column.")
                frame[column] = frame[column].fillna(frame[column].median())
            elif value == "mode":
                mode = frame[column].mode(dropna=True)
                if len(mode):
                    frame[column] = frame[column].fillna(mode.iloc[0])
            elif value == "drop":
                frame = frame.dropna(subset=[column])
            else:
                frame[column] = frame[column].fillna(value if value is not None else "")
        elif kind == "rename_column":
            new_name = operation.get("newName")
            if column not in frame.columns or not new_name:
                raise HTTPException(status_code=400, detail="Choose a column and a new name.")
            if new_name in frame.columns and new_name != column:
                raise HTTPException(status_code=400, detail=f"Column already exists: {new_name}")
            frame = frame.rename(columns={column: new_name})
        elif kind == "convert_type":
            if column not in frame.columns:
                raise HTTPException(status_code=400, detail=f"Unknown column: {column}")
            target_type = operation.get("targetType")
            try:
                if target_type == "number":
                    frame[column] = pd.to_numeric(frame[column], errors="raise")
                elif target_type == "date":
                    frame[column] = pd.to_datetime(frame[column], errors="raise")
                elif target_type == "string":
                    frame[column] = frame[column].astype("string")
                else:
                    raise HTTPException(status_code=400, detail="Choose a supported target type.")
            except (ValueError, TypeError) as error:
                raise HTTPException(status_code=400, detail=f"Could not convert {column}: {str(error)[:160]}") from error
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported cleaning operation: {kind}")
    csv_data = frame.to_csv(index=False).encode("utf-8")
    return Response(
        content=csv_data,
        media_type="text/csv; charset=utf-8",
        headers={"x-cleaned-rows": str(len(frame)), "x-cleaned-columns": str(len(frame.columns))},
    )


def model_instance(problem_type: str, model: str, seed: int):
    key = model.strip().lower().replace("_", " ").replace("-", " ")
    if problem_type == "classification":
        models = {
            "logistic regression": LogisticRegression(max_iter=1000, random_state=seed),
            "random forest": RandomForestClassifier(n_estimators=120, random_state=seed, n_jobs=1),
            "gradient boosting": GradientBoostingClassifier(random_state=seed),
            "decision tree": DecisionTreeClassifier(random_state=seed),
            "knn": KNeighborsClassifier(n_neighbors=5),
            "support vector machine": SVC(probability=True, random_state=seed),
        }
    else:
        models = {
            "linear regression": LinearRegression(),
            "ridge": Ridge(),
            "lasso": Lasso(max_iter=5000),
            "random forest": RandomForestRegressor(n_estimators=120, random_state=seed, n_jobs=1),
            "gradient boosting": GradientBoostingRegressor(random_state=seed),
            "decision tree": DecisionTreeRegressor(random_state=seed),
        }
    if key not in models:
        choices = ", ".join(models.keys())
        raise HTTPException(status_code=400, detail=f"Unsupported {problem_type} model. Choose: {choices}.")
    return models[key]


@app.post("/train")
def train(file: UploadFile = File(...), args: str = Form("{}")):
    frame = read_frame(file)
    try:
        options = json.loads(args)
    except json.JSONDecodeError as error:
        raise HTTPException(status_code=400, detail="Invalid model configuration.") from error
    target = options.get("targetColumn")
    features = options.get("features", [])
    if target not in frame.columns:
        raise HTTPException(status_code=400, detail="Choose a valid target column.")
    features = [column for column in features if column in frame.columns and column != target]
    if not features:
        raise HTTPException(status_code=400, detail="Choose at least one feature other than the target.")
    model_frame = frame[features + [target]].dropna(subset=[target])
    if len(model_frame) < 20:
        raise HTTPException(status_code=400, detail="At least 20 labeled rows are required to train a model.")
    if len(model_frame) > 50_000:
        model_frame = model_frame.sample(50_000, random_state=int(options.get("randomSeed", 42)))
    y = model_frame[target]
    requested_type = options.get("problemType", "auto")
    if requested_type == "auto":
        unique = int(y.nunique())
        requested_type = "classification" if not pd.api.types.is_numeric_dtype(y) or unique <= 20 else "regression"
    if requested_type not in {"classification", "regression"}:
        raise HTTPException(status_code=400, detail="Choose classification or regression.")
    if requested_type == "classification" and y.nunique() < 2:
        raise HTTPException(status_code=400, detail="The target needs at least two classes.")
    if requested_type == "regression":
        y = pd.to_numeric(y, errors="coerce")
        valid = y.notna()
        model_frame = model_frame.loc[valid]
        y = y.loc[valid]
        if len(y) < 20:
            raise HTTPException(status_code=400, detail="At least 20 valid numeric target values are required.")
    X = model_frame[features]
    numeric_features = [column for column in features if pd.api.types.is_numeric_dtype(X[column])]
    categorical_features = [column for column in features if column not in numeric_features]
    numeric_pipeline = Pipeline([("imputer", SimpleImputer(strategy="median")), ("scale", StandardScaler())])
    categorical_pipeline = Pipeline(
        [
            ("imputer", SimpleImputer(strategy="most_frequent")),
            ("encode", OneHotEncoder(handle_unknown="ignore")),
        ]
    )
    transformers = []
    if numeric_features:
        transformers.append(("numeric", numeric_pipeline, numeric_features))
    if categorical_features:
        transformers.append(("categorical", categorical_pipeline, categorical_features))
    preprocessing = ColumnTransformer(transformers, remainder="drop")
    seed = int(options.get("randomSeed", 42))
    test_size = float(options.get("testSize", 0.2))
    if not 0.1 <= test_size <= 0.5:
        raise HTTPException(status_code=400, detail="Test size must be between 0.1 and 0.5.")
    try:
        stratify = y if requested_type == "classification" and y.value_counts().min() >= 2 else None
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=test_size, random_state=seed, stratify=stratify
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=f"Could not split the dataset: {str(error)[:200]}") from error
    estimator = model_instance(requested_type, options.get("model", ""), seed)
    pipeline = Pipeline([("preprocess", preprocessing), ("model", estimator)])
    start = time.perf_counter()
    try:
        pipeline.fit(X_train, y_train)
        predictions = pipeline.predict(X_test)
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"Model training failed: {str(error)[:240]}") from error
    metrics: dict[str, Any]
    matrix = None
    if requested_type == "classification":
        metrics = {
            "accuracy": clean_value(accuracy_score(y_test, predictions)),
            "precision": clean_value(precision_score(y_test, predictions, average="weighted", zero_division=0)),
            "recall": clean_value(recall_score(y_test, predictions, average="weighted", zero_division=0)),
            "f1": clean_value(f1_score(y_test, predictions, average="weighted", zero_division=0)),
            "testRows": len(y_test),
        }
        labels = np.unique(y)
        matrix = confusion_matrix(y_test, predictions, labels=labels).tolist()
        if len(labels) == 2 and hasattr(pipeline, "predict_proba"):
            try:
                probabilities = pipeline.predict_proba(X_test)[:, 1]
                metrics["rocAuc"] = clean_value(roc_auc_score(y_test, probabilities))
            except Exception:
                pass
    else:
        mse = mean_squared_error(y_test, predictions)
        metrics = {
            "mae": clean_value(mean_absolute_error(y_test, predictions)),
            "mse": clean_value(mse),
            "rmse": clean_value(np.sqrt(mse)),
            "r2": clean_value(r2_score(y_test, predictions)),
            "testRows": len(y_test),
        }
    importance = []
    try:
        scoring = "accuracy" if requested_type == "classification" else "neg_mean_squared_error"
        result = permutation_importance(
            pipeline, X_test, y_test, n_repeats=3, random_state=seed, scoring=scoring, n_jobs=1
        )
        importance = [
            {"feature": str(feature), "importance": clean_value(max(0, value))}
            for feature, value in sorted(
                zip(features, result.importances_mean), key=lambda pair: pair[1], reverse=True
            )
        ]
    except Exception:
        importance = [{"feature": str(feature), "importance": 0.0} for feature in features]
    return {
        "problemType": requested_type,
        "metrics": metrics,
        "featureImportance": importance,
        "confusionMatrix": matrix,
        "durationSeconds": round(time.perf_counter() - start, 3),
        "trainRows": len(y_train),
    }