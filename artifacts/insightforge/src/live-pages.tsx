import "./live-pages.css";
import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import { Link } from "wouter";
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Check,
  CircleHelp,
  Database,
  Download,
  FileChartColumn,
  FileText,
  FlaskConical,
  Info,
  LoaderCircle,
  MessageSquareText,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { DeleteDatasetResponse } from "@workspace/api-zod";
import { useAuth } from "@workspace/replit-auth-web";
import { Button, Card, PageTitle, SectionHead } from "./components";
import {
  ApiError,
  apiRequest,
  chatWithAnalyst,
  cleanDataset,
  createVisualization,
  generateReport,
  getDatasetProfile,
  getDatasetStatistics,
  getExperiment,
  listExperiments,
  listReports,
  trainModel,
  uploadDataset,
} from "./lib/api";
import { type DatasetRecord, useWorkspace } from "./lib/workspace";

type ColumnProfile = {
  name: string;
  dataType?: string;
  missingCount?: number;
  missingPct?: number;
  uniqueCount?: number;
  mean?: number;
  median?: number;
  std?: number;
  min?: number;
  max?: number;
  topValue?: string;
  topCount?: number;
};

type DatasetProfile = {
  columns?: ColumnProfile[];
  duplicateRows?: number;
  missingCells?: number;
  missingPct?: number;
  memoryUsageBytes?: number;
  typeCounts?: Record<string, number>;
  sampleRows?: Array<Record<string, unknown>>;
};

type NumericSummary = {
  column: string;
  count: number;
  mean: number | null;
  median: number | null;
  std: number | null;
  min: number | null;
  q1: number | null;
  q3: number | null;
  max: number | null;
  skew: number | null;
};

type CategorySummary = {
  column: string;
  unique: number;
  counts: Array<{ value: string; count: number }>;
};

type StatisticsResult = {
  rows: number;
  numeric: NumericSummary[];
  categorical: CategorySummary[];
  correlation: { columns: string[]; matrix: Array<Array<number | null>> };
};

type PlotResult = {
  chartType: string;
  xLabel?: string;
  yLabel?: string;
  points?: Array<{ x: string | number; y: number }>;
  columns?: string[];
  matrix?: Array<Array<number | null>>;
  groups?: Array<{
    group: string;
    count: number;
    min: number;
    q1: number;
    median: number;
    q3: number;
    max: number;
  }>;
};

type ExperimentRecord = {
  id: string;
  datasetId: string;
  datasetName: string;
  name: string;
  problemType: string;
  targetColumn: string;
  features: string[];
  model: string;
  metrics: Record<string, number | string | null>;
  featureImportance: Array<{ feature: string; importance: number }>;
  confusionMatrix?: number[][] | null;
  durationSeconds: number;
  createdAt: string | Date;
};

type ReportRecord = {
  id: string;
  datasetId: string;
  title: string;
  content: Record<string, unknown>;
  createdAt: string | Date;
};

function DataTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: Array<Array<string | number>>;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{headers.map((heading) => <th key={heading}>{heading}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>
                  {cellIndex === 0 ? <strong>{cell}</strong> : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Metric({
  value,
  label,
  note,
  color = "mint",
}: {
  value: string;
  label: string;
  note: string;
  color?: string;
}) {
  return (
    <Card className="metric-card">
      <div className="metric-top">
        <span>{label}</span>
        <span className={`metric-icon metric-${color}`}><BarChart3 size={16} /></span>
      </div>
      <div className="metric-value">{value}</div>
      <div className="metric-foot">{note}</div>
    </Card>
  );
}

function DatasetPicker() {
  const {
    datasets,
    activeDatasetId,
    setActiveDatasetId,
    isLoadingDatasets,
  } = useWorkspace();
  return (
    <select
      className="select-control"
      aria-label="Choose dataset"
      value={activeDatasetId}
      disabled={isLoadingDatasets || datasets.length === 0}
      onChange={(event) => setActiveDatasetId(event.target.value)}
    >
      {datasets.length === 0 && <option value="">No datasets yet</option>}
      {datasets.map((dataset) => (
        <option key={dataset.id} value={dataset.id}>{dataset.name}</option>
      ))}
    </select>
  );
}

function EmptyDataset({ children }: { children?: ReactNode }) {
  return (
    <div className="empty-state">
      <Database size={25} />
      <b>Upload a dataset to get started</b>
      <p>Your private CSV, XLSX, or JSON files will appear here after profiling.</p>
      {children ?? <Link className="btn primary" href="/datasets"><Upload size={15} /> Add a dataset</Link>}
    </div>
  );
}

function ErrorNotice({ error, onRetry }: { error: string; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="inline-alert error" role="alert">
      <Info size={16} />
      <span>{error}</span>
      {onRetry && <button className="text-link" onClick={onRetry}>Retry</button>}
    </div>
  );
}

function LoadingNotice({ label = "Loading analysis…" }: { label?: string }) {
  return (
    <div className="inline-alert">
      <LoaderCircle size={16} className="spin" />
      <span>{label}</span>
    </div>
  );
}

function useActiveProfile() {
  const { activeDataset } = useWorkspace();
  const [profile, setProfile] = useState<DatasetProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (!activeDataset) {
      setProfile(null);
      setLoading(false);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    getDatasetProfile(activeDataset.id)
      .then((value) => {
        if (active) setProfile(value as DatasetProfile);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "Could not load the profile.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [activeDataset?.id]);
  return { profile, loading, error, setError };
}

function useActiveExperiments(datasetId?: string) {
  const [experiments, setExperiments] = useState<ExperimentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await listExperiments();
      setExperiments(response.experiments as ExperimentRecord[]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load experiments.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void refresh(); }, []);
  const filtered = datasetId
    ? experiments.filter((experiment) => experiment.datasetId === datasetId)
    : experiments;
  return { experiments: filtered, allExperiments: experiments, loading, error, refresh };
}

function shortDate(value: string | Date) {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function readableBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function Overview() {
  const { datasets, isLoadingDatasets, datasetError } = useWorkspace();
  const { experiments, loading, error } = useActiveExperiments();
  const qualityData = datasets.map((dataset) => ({
    name: dataset.name.length > 14 ? `${dataset.name.slice(0, 12)}…` : dataset.name,
    quality: dataset.qualityScore,
  }));
  return (
    <>
      <div className="welcome-row">
        <div>
          <div className="eyebrow">PRIVATE DATA WORKSPACE <span className="eyebrow-dot" /> INSIGHTFORGE</div>
          <h1>Your data, ready to explore <span className="wave-mark">∗</span></h1>
          <p className="welcome-copy">Turn real datasets into defensible decisions.</p>
          <p className="welcome-secondary">Profile, analyze, train models, and save reports from your own private files.</p>
        </div>
        <div className="welcome-actions">
          <Link className="btn primary" href="/datasets"><Upload size={16} /> Upload dataset</Link>
          <Link className="btn secondary" href="/ai-analyst"><MessageSquareText size={15} /> Ask the analyst</Link>
        </div>
      </div>
      <div className="metric-grid">
        <Metric value={String(datasets.length).padStart(2, "0")} label="Datasets" note="Private files in your workspace" />
        <Metric value={String(experiments.length).padStart(2, "0")} label="Experiments" note="Saved model runs" color="blue" />
        <Metric value={String(datasets.reduce((sum, item) => sum + item.rows, 0).toLocaleString())} label="Rows profiled" note="Across your datasets" color="amber" />
        <Metric value={String(datasets.length ? Math.round(datasets.reduce((sum, item) => sum + item.qualityScore, 0) / datasets.length) : "—")} label="Average quality" note="Computed from missing and duplicate data" color="violet" />
      </div>
      {(datasetError || error) && <ErrorNotice error={datasetError || error} />}
      <div className="overview-grid">
        <Card className="chart-panel">
          <SectionHead title="Dataset quality" sub="Computed profile score for each uploaded dataset" />
          {isLoadingDatasets ? <LoadingNotice /> : qualityData.length ? (
            <div className="chart-area">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={qualityData}>
                  <CartesianGrid stroke="#293139" vertical={false} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#78848d", fontSize: 10 }} />
                  <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fill: "#78848d", fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "#171d23", border: "1px solid #2a343c", borderRadius: 9, color: "#e7ecec" }} />
                  <Bar dataKey="quality" name="Quality score" fill="#55d6b0" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyDataset />}
        </Card>
        <Card className="model-compare">
          <SectionHead title="Recent experiments" sub="Saved results from Python model training" />
          {loading ? <LoadingNotice /> : experiments.length ? (
            <>
              <div className="mini-bars">
                {experiments.slice(0, 4).map((experiment) => {
                  const score = Number(experiment.metrics.accuracy ?? experiment.metrics.r2 ?? 0);
                  return (
                    <div className="mini-bar-row" key={experiment.id}>
                      <span>{experiment.model}</span>
                      <div className="mini-track"><i style={{ width: `${Math.max(0, Math.min(100, score * 100))}%` }} /></div>
                      <b>{score.toFixed(3)}</b>
                    </div>
                  );
                })}
              </div>
              <Link className="text-link" href="/experiments">View all experiments <span>→</span></Link>
            </>
          ) : <p className="body-note">Your saved model runs will appear here.</p>}
        </Card>
      </div>
      <Card className="recent-panel">
        <SectionHead title="Your datasets" sub="Most recently profiled" action={<Link className="text-link" href="/datasets">Manage datasets <span>→</span></Link>} />
        {datasets.length ? (
          <DataTable
            headers={["DATASET", "ROWS", "COLUMNS", "QUALITY", "FILE", "CREATED"]}
            rows={datasets.slice(0, 6).map((dataset) => [
              dataset.name,
              dataset.rows.toLocaleString(),
              dataset.columns,
              `${dataset.qualityScore.toFixed(1)} / 100`,
              dataset.fileType.toUpperCase(),
              shortDate(dataset.createdAt),
            ])}
          />
        ) : <EmptyDataset />}
      </Card>
    </>
  );
}

export function Datasets() {
  const { datasets, refreshDatasets, isLoadingDatasets } = useWorkspace();
  const [drag, setDrag] = useState(false);
  const [query, setQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadLabel, setUploadLabel] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const upload = async (files: File[]) => {
    const supported = files.filter((file) => /\.(csv|xlsx|json)$/i.test(file.name));
    if (!supported.length) {
      setError("Choose CSV, XLSX, or JSON files.");
      return;
    }
    const oversized = supported.find((file) => file.size > 100 * 1024 * 1024);
    if (oversized) {
      setError(`${oversized.name} exceeds the 100 MB file limit.`);
      return;
    }
    setUploading(true);
    setError("");
    setNotice("");
    try {
      for (let index = 0; index < supported.length; index += 1) {
        setUploadLabel(`Uploading and profiling ${supported[index].name} (${index + 1}/${supported.length})…`);
        await uploadDataset(supported[index]);
      }
      await refreshDatasets();
      setNotice(`${supported.length} dataset${supported.length === 1 ? "" : "s"} profiled successfully.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Upload failed.");
    } finally {
      setUploading(false);
      setUploadLabel("");
    }
  };
  const onInput = (event: ChangeEvent<HTMLInputElement>) => {
    void upload(Array.from(event.target.files ?? []));
    event.target.value = "";
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDrag(false);
    void upload(Array.from(event.dataTransfer.files));
  };
  const filtered = datasets.filter((dataset) =>
    dataset.name.toLowerCase().includes(query.toLowerCase()),
  );
  const remove = async (dataset: DatasetRecord) => {
    if (!window.confirm(`Delete ${dataset.name} and its stored file? This cannot be undone.`)) return;
    try {
      await apiRequest(`/datasets/${encodeURIComponent(dataset.id)}`, DeleteDatasetResponse, {
        method: "DELETE",
      });
      await refreshDatasets();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not delete dataset.");
    }
  };

  return (
    <>
      <PageTitle
        eyebrow="DATA WORKSPACE"
        title="Datasets"
        subtitle="Upload private files, profile their structure, and prepare them for analysis."
        action={<label className="btn primary"><Plus size={16} /> Add dataset<input hidden type="file" multiple accept=".csv,.xlsx,.json" onChange={onInput} /></label>}
      />
      <div
        className={`upload-zone ${drag ? "dragging" : ""}`}
        onDragOver={(event) => { event.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        data-testid="upload-dropzone"
      >
        <div className="upload-icon"><Upload size={21} /></div>
        <b>{uploading ? uploadLabel : "Drop your data files here"}</b>
        <p>CSV, XLSX, or JSON · up to 100 MB per file</p>
        <label className="btn secondary compact">{uploading ? "Uploading…" : "Browse files"}<input hidden type="file" multiple accept=".csv,.xlsx,.json" disabled={uploading} onChange={onInput} /></label>
        <span className="upload-note">Files are stored privately and only visible to your account.</span>
      </div>
      {uploading && <LoadingNotice label={uploadLabel} />}
      {notice && <div className="inline-alert"><Check size={16} />{notice}</div>}
      <ErrorNotice error={error} />
      <div className="filter-row">
        <div className="field-search"><Search size={16} /><input placeholder="Search datasets…" value={query} onChange={(event) => setQuery(event.target.value)} data-testid="input-search-datasets" /></div>
        <span className="results-count">{filtered.length} datasets</span>
      </div>
      {isLoadingDatasets ? <LoadingNotice /> : (
        <div className="dataset-grid">
          {filtered.map((dataset) => (
            <Card key={dataset.id} className="dataset-card">
              <div className="dataset-head">
                <span className={`file-tile ${dataset.fileType === "csv" ? "mint" : "blue"}`}>{dataset.fileType.toUpperCase()}</span>
                <button className="icon-button" aria-label={`Delete ${dataset.name}`} onClick={() => void remove(dataset)}><Trash2 size={16} /></button>
              </div>
              <b className="dataset-name">{dataset.name}</b>
              <div className="dataset-meta">{dataset.rows.toLocaleString()} rows <span>·</span> {dataset.columns} columns</div>
              <div className="dataset-meta">File size · {readableBytes(dataset.fileSize)}</div>
              <div className="dataset-target"><span>Quality score</span><b>{dataset.qualityScore.toFixed(1)} / 100</b></div>
              <div className="dataset-card-foot"><span className="status-pill status-done"><i />Profiled</span><span>{shortDate(dataset.createdAt)}</span></div>
              <Link className="analyze-link" href="/profiling">Open profile <span>→</span></Link>
            </Card>
          ))}
        </div>
      )}
      {!filtered.length && !isLoadingDatasets && (
        <div className="empty-state"><Database size={24} /><b>{query ? "No datasets match that search" : "No datasets yet"}</b><p>{query ? "Try a different search." : "Upload a CSV, XLSX, or JSON file to start a real analysis."}</p></div>
      )}
    </>
  );
}

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function Profiling() {
  const { activeDataset, datasets, refreshDatasets, setActiveDatasetId } = useWorkspace();
  const { profile, loading, error } = useActiveProfile();
  const [cleanColumn, setCleanColumn] = useState("");
  const [cleanAction, setCleanAction] = useState("none");
  const [removeDuplicates, setRemoveDuplicates] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleanError, setCleanError] = useState("");
  const [cleanNotice, setCleanNotice] = useState("");
  const columns = profile?.columns ?? [];

  const runClean = async () => {
    if (!activeDataset) return;
    const operations: Array<Record<string, string>> = [];
    if (removeDuplicates) operations.push({ type: "remove_duplicates" });
    if (cleanAction !== "none" && cleanColumn) {
      if (cleanAction === "drop_missing") operations.push({ type: "fill_missing", column: cleanColumn, value: "drop" });
      if (cleanAction === "median") operations.push({ type: "fill_missing", column: cleanColumn, value: "median" });
      if (cleanAction === "mode") operations.push({ type: "fill_missing", column: cleanColumn, value: "mode" });
      if (cleanAction === "drop_column") operations.push({ type: "drop_column", column: cleanColumn });
    }
    if (!operations.length) {
      setCleanError("Select at least one cleaning operation.");
      return;
    }
    setCleaning(true);
    setCleanError("");
    setCleanNotice("");
    try {
      const cleaned = await cleanDataset(activeDataset.id, { operations });
      await refreshDatasets();
      setActiveDatasetId(cleaned.id);
      setCleanNotice(`Saved cleaned copy: ${cleaned.name}`);
    } catch (reason) {
      setCleanError(reason instanceof Error ? reason.message : "Cleaning failed.");
    } finally {
      setCleaning(false);
    }
  };

  if (!activeDataset && !loading) return <><PageTitle eyebrow="DATA QUALITY" title="Data profiling" subtitle="Review computed completeness, structure, and quality." /><EmptyDataset /></>;
  return (
    <>
      <PageTitle eyebrow="DATA QUALITY" title="Data profiling" subtitle="Computed completeness, structure, and quality for your selected dataset." action={<DatasetPicker />} />
      {loading && <LoadingNotice />}
      <ErrorNotice error={error} />
      {activeDataset && profile && (
        <>
          <div className="quality-banner">
            <div className="quality-score"><b>{activeDataset.qualityScore.toFixed(1)}</b><small>/ 100</small><span>Overall quality</span></div>
            <div className="quality-copy">
              <div className="quality-label"><ShieldCheck size={15} /> Profile computed from your data</div>
              <p>{activeDataset.rows.toLocaleString()} rows across {activeDataset.columns} columns. {profile.missingCells ?? 0} missing cells and {profile.duplicateRows ?? 0} duplicate rows were detected.</p>
              <div className="quality-tags"><span>{activeDataset.columns} columns</span><span>{activeDataset.rows.toLocaleString()} rows</span><span>{Number(profile.missingPct ?? 0).toFixed(2)}% missing</span><span>{profile.duplicateRows ?? 0} duplicates</span></div>
            </div>
            <div className="quality-ring">{Math.round(activeDataset.qualityScore)}<span>%</span></div>
          </div>
          <div className="metric-grid four">
            <Metric value={String(profile.missingCells ?? 0)} label="Missing cells" note={`${Number(profile.missingPct ?? 0).toFixed(2)}% of data`} color="amber" />
            <Metric value={String(profile.duplicateRows ?? 0)} label="Duplicate rows" note="Detected during profiling" color="blue" />
            <Metric value={String(activeDataset.columns)} label="Total columns" note={`${profile.typeCounts?.numeric ?? 0} numeric · ${profile.typeCounts?.categorical ?? 0} categorical`} />
            <Metric value={activeDataset.rows.toLocaleString()} label="Total rows" note={`File size ${readableBytes(activeDataset.fileSize)}`} color="violet" />
          </div>
          <Card className="profile-card">
            <SectionHead title="Column profiles" sub={`${activeDataset.name} · ${activeDataset.rows.toLocaleString()} records`} action={<button className="btn secondary compact" onClick={() => downloadJson(`${activeDataset.name.replace(/\.[^.]+$/, "")}-profile.json`, profile)}><Download size={14} /> Export profile</button>} />
            <DataTable
              headers={["COLUMN", "TYPE", "MISSING", "UNIQUE", "SUMMARY"]}
              rows={columns.map((column) => [
                column.name,
                column.dataType ?? "unknown",
                `${column.missingCount ?? 0} (${Number(column.missingPct ?? 0).toFixed(1)}%)`,
                column.uniqueCount ?? "—",
                column.dataType === "numeric"
                  ? `mean ${Number(column.mean ?? 0).toPrecision(4)} · range ${column.min ?? "—"}–${column.max ?? "—"}`
                  : `${column.topValue ?? "—"}${column.topCount == null ? "" : ` · ${column.topCount} rows`}`,
              ])}
            />
          </Card>
          <Card className="cleaning-panel">
            <SectionHead title="Create a cleaned copy" sub="Cleaning never overwrites your original file." />
            <div className="cleaning-controls">
              <label className="setting-switch"><span><b>Remove duplicate rows</b><small>Keep the first occurrence of each row</small></span><input type="checkbox" checked={removeDuplicates} onChange={(event) => setRemoveDuplicates(event.target.checked)} /></label>
              <label>Column<select value={cleanColumn} onChange={(event) => setCleanColumn(event.target.value)}><option value="">Choose a column</option>{columns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}</select></label>
              <label>Missing values / column<select value={cleanAction} onChange={(event) => setCleanAction(event.target.value)}><option value="none">Leave unchanged</option><option value="drop_missing">Drop rows missing this value</option><option value="mode">Fill with most common value</option><option value="median">Fill with median (numeric only)</option><option value="drop_column">Drop selected column</option></select></label>
              <Button icon={cleaning ? <LoaderCircle size={15} /> : <Check size={15} />} onClick={() => void runClean()}>{cleaning ? "Cleaning…" : "Clean and save copy"}</Button>
            </div>
            <ErrorNotice error={cleanError} />
            {cleanNotice && <div className="inline-alert"><Check size={16} />{cleanNotice}</div>}
          </Card>
        </>
      )}
      {!loading && !datasets.length && <EmptyDataset />}
    </>
  );
}

export function EDA() {
  const { activeDataset } = useWorkspace();
  const { profile, loading: profileLoading } = useActiveProfile();
  const columns = profile?.columns ?? [];
  const [chartType, setChartType] = useState("histogram");
  const [xColumn, setXColumn] = useState("");
  const [yColumn, setYColumn] = useState("");
  const [aggregation, setAggregation] = useState("mean");
  const [plot, setPlot] = useState<PlotResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (columns.length) {
      setXColumn((current) => columns.some((column) => column.name === current) ? current : columns[0].name);
      setYColumn((current) => columns.some((column) => column.name === current) ? current : columns[1]?.name ?? columns[0].name);
    }
  }, [activeDataset?.id, columns.map((column) => column.name).join("|")]);
  const run = async () => {
    if (!activeDataset) return;
    setLoading(true);
    setError("");
    try {
      const result = await createVisualization(activeDataset.id, {
        chartType,
        ...(chartType !== "correlation" ? { xColumn } : {}),
        ...(["scatter", "box", "bar"].includes(chartType) && yColumn ? { yColumn } : {}),
        ...(chartType === "bar" ? { aggregation } : {}),
      });
      setPlot(result as PlotResult);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not generate the chart.");
    } finally {
      setLoading(false);
    }
  };
  if (!activeDataset) return <><PageTitle eyebrow="EXPLORE YOUR DATA" title="Exploratory analysis" subtitle="Build charts from real columns in your data." /><EmptyDataset /></>;
  return (
    <>
      <PageTitle eyebrow="EXPLORE YOUR DATA" title="Exploratory analysis" subtitle={`Generate live charts from ${activeDataset.name}.`} action={<DatasetPicker />} />
      <div className="control-strip">
        <span className="demo-chip"><i /> Live data</span><span className="control-sep" />
        <label>X-axis <select value={xColumn} disabled={profileLoading} onChange={(event) => setXColumn(event.target.value)}>{columns.map((column) => <option key={column.name}>{column.name}</option>)}</select></label>
        {["scatter", "box", "bar"].includes(chartType) && <label>Y-axis <select value={yColumn} onChange={(event) => setYColumn(event.target.value)}>{columns.map((column) => <option key={column.name}>{column.name}</option>)}</select></label>}
        <label>Chart <select value={chartType} onChange={(event) => setChartType(event.target.value)}><option value="histogram">Histogram</option><option value="bar">Bar</option><option value="scatter">Scatter</option><option value="box">Box plot</option><option value="correlation">Correlation matrix</option></select></label>
        {chartType === "bar" && <label>Aggregation <select value={aggregation} onChange={(event) => setAggregation(event.target.value)}><option value="mean">Mean</option><option value="median">Median</option><option value="sum">Sum</option><option value="count">Count</option></select></label>}
        <Button onClick={() => void run()}>{loading ? "Building…" : "Build chart"}</Button>
      </div>
      <ErrorNotice error={error} />
      <div className="eda-grid">
        <Card className="eda-main">
          <SectionHead title={plot ? `${plot.chartType} · ${activeDataset.name}` : "Chart preview"} sub={plot ? `${plot.xLabel ?? ""}${plot.yLabel ? ` vs. ${plot.yLabel}` : ""}` : "Choose chart options and build a chart from your dataset"} />
          {loading && <LoadingNotice label="Computing chart from your data…" />}
          {!plot && !loading && <div className="preview-empty"><BarChart3 size={27} /><b>No chart yet</b><p>Build a chart to see computed values here.</p></div>}
          {plot?.chartType === "correlation" && plot.columns && plot.matrix && (
            <div className="table-wrap"><table><thead><tr><th>FEATURE</th>{plot.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{plot.matrix.map((row, index) => <tr key={plot.columns?.[index]}><td><strong>{plot.columns?.[index]}</strong></td>{row.map((value, valueIndex) => <td key={valueIndex}>{value == null ? "—" : value.toFixed(3)}</td>)}</tr>)}</tbody></table></div>
          )}
          {plot?.points && (
            <div className="eda-chart">
              <ResponsiveContainer width="100%" height="100%">
                {plot.chartType === "scatter" ? (
                  <ScatterChart><CartesianGrid stroke="#293139" /><XAxis type="number" dataKey="x" name={plot.xLabel} tick={{ fill: "#879198", fontSize: 10 }} /><YAxis type="number" dataKey="y" name={plot.yLabel} tick={{ fill: "#879198", fontSize: 10 }} /><Tooltip contentStyle={{ background: "#171d23", border: "1px solid #2a343c", borderRadius: 8 }} /><Scatter data={plot.points} fill="#5bd4b2" fillOpacity={0.82} /></ScatterChart>
                ) : (
                  <BarChart data={plot.points}><CartesianGrid stroke="#293139" vertical={false} /><XAxis dataKey="x" axisLine={false} tickLine={false} tick={{ fill: "#879198", fontSize: 10 }} /><YAxis axisLine={false} tickLine={false} tick={{ fill: "#879198", fontSize: 10 }} /><Tooltip contentStyle={{ background: "#171d23", border: "1px solid #2a343c", borderRadius: 8 }} /><Bar dataKey="y" name={plot.yLabel ?? "count"} fill="#5bd4b2" radius={[4, 4, 0, 0]} /></BarChart>
                )}
              </ResponsiveContainer>
            </div>
          )}
          {plot?.groups && <DataTable headers={["GROUP", "COUNT", "MIN", "Q1", "MEDIAN", "Q3", "MAX"]} rows={plot.groups.map((group) => [group.group, group.count, group.min, group.q1, group.median, group.q3, group.max])} />}
          {plot && <div className="chart-caption">Computed from {activeDataset.rows.toLocaleString()} source rows. No sample or demo series.</div>}
        </Card>
        <Card className="heat-card">
          <SectionHead title="Dataset profile" sub="Column types detected from the uploaded file" />
          <div className="context-stats"><span>Rows<b>{activeDataset.rows.toLocaleString()}</b></span><span>Columns<b>{activeDataset.columns}</b></span><span>Quality<b>{activeDataset.qualityScore.toFixed(1)} / 100</b></span></div>
          <div className="finding"><span className="finding-spark">↗</span><p><b>Use correlation matrix</b><br />to compare numeric columns, or choose a column chart to inspect distributions.</p></div>
        </Card>
      </div>
    </>
  );
}

export function Statistics() {
  const { activeDataset } = useWorkspace();
  const [statistics, setStatistics] = useState<StatisticsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (!activeDataset) {
      setStatistics(null);
      return;
    }
    setLoading(true);
    setError("");
    getDatasetStatistics(activeDataset.id)
      .then((result) => { if (active) setStatistics(result as StatisticsResult); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Could not calculate statistics."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [activeDataset?.id]);
  const pairs = useMemo(() => {
    if (!statistics) return [];
    const { columns, matrix } = statistics.correlation;
    const result: Array<{ first: string; second: string; value: number }> = [];
    for (let i = 0; i < columns.length; i += 1) {
      for (let j = i + 1; j < columns.length; j += 1) {
        const value = matrix[i]?.[j];
        if (typeof value === "number" && Number.isFinite(value)) {
          result.push({ first: columns[i], second: columns[j], value });
        }
      }
    }
    return result.sort((left, right) => Math.abs(right.value) - Math.abs(left.value)).slice(0, 12);
  }, [statistics]);
  if (!activeDataset) return <><PageTitle eyebrow="QUANTITATIVE SUMMARY" title="Statistics" subtitle="Descriptive statistics and correlations computed from your data." /><EmptyDataset /></>;
  return (
    <>
      <PageTitle eyebrow="QUANTITATIVE SUMMARY" title="Statistics" subtitle={`Descriptive statistics calculated from ${activeDataset.name}.`} action={<DatasetPicker />} />
      <div className="inline-alert"><Activity size={15} /> All measures below are calculated from the uploaded dataset by the Python analysis service.</div>
      {loading && <LoadingNotice />}
      <ErrorNotice error={error} />
      {statistics && (
        <>
          <Card className="stats-table"><SectionHead title="Descriptive statistics" sub={`${statistics.rows.toLocaleString()} rows · numeric columns`} /><DataTable headers={["FEATURE", "COUNT", "MEAN", "MEDIAN", "STD. DEV.", "MIN", "25TH", "75TH", "MAX", "SKEW"]} rows={statistics.numeric.map((item) => [item.column, item.count, item.mean?.toPrecision(5) ?? "—", item.median?.toPrecision(5) ?? "—", item.std?.toPrecision(5) ?? "—", item.min ?? "—", item.q1 ?? "—", item.q3 ?? "—", item.max ?? "—", item.skew?.toFixed(3) ?? "—"])} /></Card>
          <div className="stats-grid">
            <Card><SectionHead title="Strongest correlations" sub="Pearson coefficients from numeric columns" />{pairs.length ? pairs.map((pair) => <div className="correlation-row" key={`${pair.first}-${pair.second}`}><span>{pair.first} ↔ {pair.second}</span><b className={pair.value >= 0 ? "text-mint" : "text-coral"}>{pair.value.toFixed(3)}</b><i>{Math.abs(pair.value) >= 0.7 ? "Strong" : Math.abs(pair.value) >= 0.4 ? "Moderate" : "Weak"} {pair.value >= 0 ? "positive" : "negative"}</i></div>) : <p className="body-note">No numeric column pairs are available for correlation.</p>}</Card>
            <Card><SectionHead title="Categorical summaries" sub="Most frequent values by column" />{statistics.categorical.slice(0, 8).map((item) => <div className="category-summary" key={item.column}><b>{item.column}</b><span>{item.unique} unique values</span><div>{item.counts.slice(0, 4).map((value) => <span className="quality-tag" key={value.value}>{value.value} · {value.count}</span>)}</div></div>)}</Card>
          </div>
        </>
      )}
    </>
  );
}

export function MLLab() {
  const { activeDataset } = useWorkspace();
  const { profile } = useActiveProfile();
  const columns = profile?.columns ?? [];
  const [target, setTarget] = useState("");
  const [features, setFeatures] = useState<string[]>([]);
  const [problemType, setProblemType] = useState("auto");
  const [model, setModel] = useState("Random Forest");
  const [testSize, setTestSize] = useState(0.2);
  const [training, setTraining] = useState(false);
  const [experiment, setExperiment] = useState<ExperimentRecord | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setTarget((current) => columns.some((column) => column.name === current) ? current : activeDataset?.targetCandidates[0] ?? columns[0]?.name ?? "");
    setFeatures((current) => current.filter((name) => columns.some((column) => column.name === name)));
    setExperiment(null);
  }, [activeDataset?.id, columns.map((column) => column.name).join("|")]);
  const toggleFeature = (name: string) => {
    setFeatures((current) => current.includes(name) ? current.filter((feature) => feature !== name) : [...current, name]);
  };
  const train = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeDataset) return;
    setTraining(true);
    setError("");
    try {
      const result = await trainModel({
        datasetId: activeDataset.id,
        targetColumn: target,
        features: features.filter((feature) => feature !== target),
        model,
        problemType,
        testSize,
        randomSeed: 42,
      });
      setExperiment(result as ExperimentRecord);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Model training failed.");
    } finally {
      setTraining(false);
    }
  };
  if (!activeDataset) return <><PageTitle eyebrow="MODEL WORKBENCH" title="ML Lab" subtitle="Train real scikit-learn models on your dataset." /><EmptyDataset /></>;
  const modelOptions = problemType === "regression"
    ? ["Linear Regression", "Ridge", "Lasso", "Random Forest", "Gradient Boosting", "Decision Tree"]
    : problemType === "classification"
      ? ["Logistic Regression", "Random Forest", "Gradient Boosting", "Decision Tree", "KNN", "Support Vector Machine"]
      : ["Random Forest", "Gradient Boosting", "Decision Tree"];
  return (
    <>
      <PageTitle eyebrow="MODEL WORKBENCH" title="ML Lab" subtitle="Train a scikit-learn model and save its measured results." action={<DatasetPicker />} />
      <div className="ml-config-grid">
        <Card>
          <SectionHead title="Experiment setup" sub={`${activeDataset.name} · ${activeDataset.rows.toLocaleString()} rows`} />
          <form onSubmit={(event) => void train(event)}>
            <div className="form-row">
              <label>Problem type<select value={problemType} onChange={(event) => setProblemType(event.target.value)}><option value="auto">Auto detect</option><option value="classification">Classification</option><option value="regression">Regression</option></select></label>
              <label>Target variable<select value={target} onChange={(event) => setTarget(event.target.value)}>{columns.map((column) => <option key={column.name}>{column.name}</option>)}</select></label>
            </div>
            <label className="form-full">Estimator<select value={model} onChange={(event) => setModel(event.target.value)}>{modelOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
            <label className="form-full">Test split <select value={testSize} onChange={(event) => setTestSize(Number(event.target.value))}><option value={0.2}>20% test / 80% train</option><option value={0.25}>25% test / 75% train</option><option value={0.3}>30% test / 70% train</option></select></label>
            <div className="feature-label">Features <span>{features.filter((feature) => feature !== target).length} selected</span></div>
            <div className="feature-pills">{columns.filter((column) => column.name !== target).map((column) => <button type="button" onClick={() => toggleFeature(column.name)} className={features.includes(column.name) ? "selected" : ""} key={column.name}>{features.includes(column.name) && <Check size={12} />} {column.name}</button>)}</div>
            <div className="preprocess"><b>Preprocessing</b><p>Missing values are imputed, numeric features scaled, and categorical features encoded within the training pipeline.</p></div>
            <Button icon={training ? <LoaderCircle size={15} /> : <FlaskConical size={15} />}>{training ? "Training model…" : "Train and save experiment"}</Button>
          </form>
          <ErrorNotice error={error} />
        </Card>
        <Card className="model-cards-panel">
          <SectionHead title="Available estimators" sub="Supported by the Python analysis service" />
          {modelOptions.map((name, index) => <div className="candidate" key={name}><span className={`model-symbol symbol-${index % 4}`}>{name.split(" ").map((word) => word[0]).join("").slice(0, 2)}</span><div><b>{name}</b><small>{problemType === "regression" ? "Regression estimator" : "Classification estimator"}</small></div></div>)}
        </Card>
      </div>
      {experiment && (
        <Card className="model-results">
          <SectionHead title="Measured model performance" sub={`${experiment.model} · ${experiment.problemType} · ${experiment.metrics.testRows ?? ""} holdout rows · ${experiment.durationSeconds}s`} action={<Link className="text-link" href="/experiments">Saved experiment <ArrowUpRight size={14} /></Link>} />
          <div className="metric-grid four">{Object.entries(experiment.metrics).filter(([key, value]) => key !== "testRows" && typeof value === "number").map(([key, value]) => <Metric key={key} value={Number(value).toFixed(4)} label={key} note="Holdout-set metric" />)}</div>
          <SectionHead title="Permutation feature importance" sub="Measured by shuffling each feature in the test set" />
          <div className="importance-list">{experiment.featureImportance.map((item) => <div className="importance-row" key={item.feature}><span>{item.feature}</span><div><i style={{ width: `${Math.max(0, Math.min(100, item.importance * 100))}%` }} /></div><b>{item.importance.toFixed(3)}</b></div>)}</div>
          {experiment.confusionMatrix && <><SectionHead title="Confusion matrix" sub="Actual class by predicted class" /><DataTable headers={["ACTUAL / PREDICTED", ...experiment.confusionMatrix.map((_, index) => `CLASS ${index + 1}`)]} rows={experiment.confusionMatrix.map((row, index) => [`Class ${index + 1}`, ...row])} /></>}
        </Card>
      )}
      <div className="inline-alert"><Info size={16} /> Training uses a holdout split. Metrics and permutation importance are computed from the selected dataset.</div>
    </>
  );
}

export function Explainability() {
  const { activeDataset } = useWorkspace();
  const { experiments, loading, error } = useActiveExperiments(activeDataset?.id);
  const [selectedId, setSelectedId] = useState("");
  const [experiment, setExperiment] = useState<ExperimentRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  useEffect(() => {
    setSelectedId(experiments[0]?.id ?? "");
  }, [experiments.map((item) => item.id).join("|")]);
  useEffect(() => {
    let active = true;
    if (!selectedId) {
      setExperiment(null);
      return;
    }
    setDetailLoading(true);
    getExperiment(selectedId)
      .then((result) => { if (active) setExperiment(result as ExperimentRecord); })
      .catch((reason) => { if (active) setDetailError(reason instanceof Error ? reason.message : "Could not load experiment."); })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [selectedId]);
  return (
    <>
      <PageTitle eyebrow="MODEL INTERPRETATION" title="Model explainability" subtitle="Inspect measured permutation importance for a saved experiment." action={<select className="select-control" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}><option value="">Choose experiment</option>{experiments.map((item) => <option value={item.id} key={item.id}>{item.model} · {item.datasetName} · {shortDate(item.createdAt)}</option>)}</select>} />
      {loading && <LoadingNotice />}
      <ErrorNotice error={error || detailError} />
      {detailLoading && <LoadingNotice label="Loading experiment details…" />}
      {!experiments.length && !loading && <div className="empty-state"><Sparkles size={24} /><b>No saved experiment for this dataset</b><p>Train a model in the ML Lab to see its measured feature importance here.</p><Link className="btn primary" href="/ml-lab">Open ML Lab</Link></div>}
      {experiment && (
        <>
          <div className="demo-banner"><Sparkles size={15} /> Permutation importance is computed on the holdout data. No simulated attribution values.</div>
          <Card className="explain-hero"><div><span className="risk-label">{experiment.problemType.toUpperCase()} · {experiment.model}</span><h2>Global model importance</h2><p>{experiment.featureImportance.length} selected features evaluated with the saved model.</p></div><div className="risk-ring"><span>{experiment.featureImportance.length}</span><small>FEATURES</small></div></Card>
          <div className="two-panels">
            <Card><SectionHead title="Permutation feature importance" sub="Decrease in holdout score when each feature is shuffled" /><div className="importance-list">{experiment.featureImportance.map((item) => <div className="importance-row" key={item.feature}><span>{item.feature}</span><div><i style={{ width: `${Math.max(0, Math.min(100, item.importance * 100))}%` }} /></div><b>{item.importance.toFixed(4)}</b></div>)}</div></Card>
            <Card><SectionHead title="Model metrics" sub="Saved with this experiment" />{Object.entries(experiment.metrics).map(([name, value]) => <div className="correlation-row" key={name}><span>{name}</span><b className="text-mint">{typeof value === "number" ? value.toFixed(4) : String(value)}</b></div>)}<div className="baseline-note">Target column <b>{experiment.targetColumn}</b><span>Training duration <strong>{experiment.durationSeconds}s</strong></span></div></Card>
          </div>
          <div className="inline-alert"><Info size={16} /> These are global feature contributions from permutation testing. This model run does not retain individual-level predictions.</div>
        </>
      )}
    </>
  );
}

export function Experiments() {
  const { experiments, loading, error, refresh } = useActiveExperiments();
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState<ExperimentRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const open = async (id: string) => {
    setDetailLoading(true);
    setDetailError("");
    try {
      setDetail(await getExperiment(id) as ExperimentRecord);
    } catch (reason) {
      setDetailError(reason instanceof Error ? reason.message : "Could not load experiment.");
    } finally {
      setDetailLoading(false);
    }
  };
  const compared = experiments.filter((item) => selected.includes(item.id));
  return (
    <>
      <PageTitle eyebrow="MODEL TRACKING" title="Experiments" subtitle="Persisted training runs and measured results." action={<Link className="btn primary" href="/ml-lab"><Plus size={15} /> New experiment</Link>} />
      {error && <ErrorNotice error={error} onRetry={() => void refresh()} />}
      {loading && <LoadingNotice />}
      <Card className="experiment-card"><SectionHead title="Experiment runs" sub={`${experiments.length} saved runs · newest first`} action={<button className="btn secondary compact" onClick={() => void refresh()}>Refresh</button>} />
        {experiments.length ? <div className="table-wrap"><table><thead><tr><th></th><th>EXPERIMENT</th><th>MODEL</th><th>DATASET</th><th>TYPE</th><th>SCORE</th><th>DATE</th></tr></thead><tbody>{experiments.map((item) => {
          const metricName = "accuracy" in item.metrics ? "accuracy" : "r2";
          return <tr key={item.id}><td><input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggle(item.id)} aria-label={`Select ${item.name}`} /></td><td><button className="table-link" onClick={() => void open(item.id)}>{item.name}</button></td><td>{item.model}</td><td>{item.datasetName}</td><td>{item.problemType}</td><td><b className="text-mint">{Number(item.metrics[metricName] ?? 0).toFixed(3)}</b></td><td>{shortDate(item.createdAt)}</td></tr>;
        })}</tbody></table></div> : !loading && <div className="empty-state"><FlaskConical size={24} /><b>No experiments saved yet</b><p>Train a model in the ML Lab. Results will be saved here for later comparison.</p><Link className="btn primary" href="/ml-lab">Train a model</Link></div>}
        {!!experiments.length && <div className="table-bottom"><span>{selected.length} selected</span><button disabled={selected.length < 2} className="btn secondary compact" onClick={() => document.getElementById("experiment-comparison")?.scrollIntoView({ behavior: "smooth" })}>Compare selected</button></div>}
      </Card>
      <ErrorNotice error={detailError} />
      {detailLoading && <LoadingNotice label="Loading saved experiment…" />}
      {detail && <Card><SectionHead title={detail.name} sub={`${detail.model} · ${detail.datasetName} · ${shortDate(detail.createdAt)}`} action={<button className="btn secondary compact" onClick={() => setDetail(null)}>Close</button>} /><div className="detail-grid">{[["Problem type", detail.problemType], ["Target", detail.targetColumn], ["Features", detail.features.join(", ")], ["Training time", `${detail.durationSeconds}s`]].map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}</div><div className="metric-grid four">{Object.entries(detail.metrics).filter(([, value]) => typeof value === "number").map(([name, value]) => <Metric key={name} value={Number(value).toFixed(4)} label={name} note="Saved holdout metric" />)}</div></Card>}
      {compared.length > 1 && <Card id="experiment-comparison"><SectionHead title="Selected run comparison" sub="Measured metrics for the selected saved experiments" /><DataTable headers={["MODEL", "DATASET", "PROBLEM", ...Array.from(new Set(compared.flatMap((item) => Object.keys(item.metrics))))]} rows={compared.map((item) => [item.model, item.datasetName, item.problemType, ...Array.from(new Set(compared.flatMap((run) => Object.keys(run.metrics)))).map((key) => item.metrics[key] ?? "—")])} /></Card>}
    </>
  );
}

type ChatEntry = { role: "user" | "assistant"; text: string; tools?: Array<{ name: string; result: unknown }> };

export function Analyst() {
  const { activeDataset } = useWorkspace();
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const ask = async (event?: FormEvent, suggested?: string) => {
    event?.preventDefault();
    const message = (suggested ?? question).trim();
    if (!message || !activeDataset || sending) return;
    setQuestion("");
    setMessages((current) => [...current, { role: "user", text: message }]);
    setSending(true);
    setError("");
    try {
      const response = await chatWithAnalyst({ datasetId: activeDataset.id, message });
      setMessages((current) => [...current, { role: "assistant", text: response.answer, tools: response.toolResults as ChatEntry["tools"] }]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The analyst could not answer.");
    } finally {
      setSending(false);
    }
  };
  if (!activeDataset) return <><PageTitle eyebrow="ASK YOUR DATA" title="AI Data Analyst" subtitle="Ask questions about your own profiled data." /><EmptyDataset /></>;
  return (
    <>
      <PageTitle eyebrow="ASK YOUR DATA" title="AI Data Analyst" subtitle={`Ask grounded questions about ${activeDataset.name}.`} action={<DatasetPicker />} />
      <div className="analyst-grid">
        <Card className="analyst-context"><SectionHead title="Dataset context" sub="Active private analysis" /><div className="context-dataset"><span className="file-tile mint">{activeDataset.fileType.toUpperCase()}</span><div><b>{activeDataset.name}</b><small>{activeDataset.rows.toLocaleString()} rows · {activeDataset.columns} columns</small></div></div><div className="context-rule" /><div className="context-stats"><span>Quality score<b>{activeDataset.qualityScore.toFixed(1)} / 100</b></span><span>Available tools<b>Profile · statistics · distributions</b></span></div><div className="analyst-notice"><Info size={16} /><p>The analyst calls real, read-only analysis tools. File contents are not stored in the chat history.</p></div></Card>
        <Card className="chat-panel">
          <div className="chat-head"><span className="analyst-avatar"><Sparkles size={17} /></span><div><b>InsightForge Analyst</b><small><i /> {sending ? "Analyzing your data…" : "Ready to explore"}</small></div><span className="demo-chip">LIVE</span></div>
          <div className="chat-scroll">
            {!messages.length && <div className="assistant-message"><span className="assistant-mark"><Sparkles size={14} /></span><div><b>Ask a data question.</b><p>I’ll use your dataset profile, descriptive statistics, or a column distribution to ground the answer.</p></div></div>}
            {messages.map((message, index) => message.role === "user" ? <div className="user-message" key={index}>{message.text}</div> : <div className="assistant-message" key={index}><span className="assistant-mark"><Sparkles size={14} /></span><div><p>{message.text}</p>{message.tools?.length ? <div className="response-source"><FileText size={13} /> Tools used: {message.tools.map((tool) => tool.name.replaceAll("_", " ")).join(", ")}</div> : null}</div></div>)}
            {sending && <LoadingNotice label="Calling analysis tools and drafting an answer…" />}
          </div>
          <div className="suggestions">{["Summarize missingness and data quality.", "Which numeric columns are most correlated?", "Show the distribution of a column."].map((prompt) => <button key={prompt} onClick={() => void ask(undefined, prompt)}>{prompt}<span>↗</span></button>)}</div>
          <form className="chat-compose" onSubmit={(event) => void ask(event)}><input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask a question about your dataset…" data-testid="input-analyst-question" /><button disabled={sending || !question.trim()} aria-label="Send question" data-testid="button-send-question"><Send size={16} /></button></form>
          <ErrorNotice error={error} />
          <div className="chat-disclaimer">Answers are generated from computed dataset statistics and tool results.</div>
        </Card>
      </div>
    </>
  );
}

export function Reports() {
  const { activeDataset, datasets } = useWorkspace();
  const { experiments } = useActiveExperiments(activeDataset?.id);
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [selectedExperiment, setSelectedExperiment] = useState("");
  const [latest, setLatest] = useState<ReportRecord | null>(null);
  const refresh = async () => {
    setLoading(true);
    try {
      const response = await listReports();
      setReports(response.reports as ReportRecord[]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load reports.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void refresh(); }, []);
  useEffect(() => { setSelectedExperiment(""); }, [activeDataset?.id]);
  const generate = async () => {
    if (!activeDataset) return;
    setGenerating(true);
    setError("");
    try {
      const report = await generateReport({
        datasetId: activeDataset.id,
        ...(selectedExperiment ? { experimentId: selectedExperiment } : {}),
      });
      setLatest(report as ReportRecord);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not generate report.");
    } finally {
      setGenerating(false);
    }
  };
  if (!activeDataset && !datasets.length) return <><PageTitle eyebrow="SHARE YOUR FINDINGS" title="Reports" subtitle="Generate and download persisted analysis reports." /><EmptyDataset /></>;
  const report = latest ?? reports[0] ?? null;
  return (
    <>
      <PageTitle eyebrow="SHARE YOUR FINDINGS" title="Reports" subtitle="Generate a report from computed profile, statistics, and saved model results." action={<DatasetPicker />} />
      <div className="report-layout">
        <Card><SectionHead title="Report contents" sub="Generated from saved analysis data" /><div className="report-checks">{["Dataset overview", "Data quality profile", "Descriptive statistics", "Optional model results"].map((label) => <label key={label}><input type="checkbox" checked readOnly /><span><b>{label}</b><small>Computed values from the selected dataset</small></span></label>)}</div><div className="report-controls"><label>Saved experiment<select value={selectedExperiment} onChange={(event) => setSelectedExperiment(event.target.value)}><option value="">No model run</option>{experiments.map((item) => <option key={item.id} value={item.id}>{item.model} · {shortDate(item.createdAt)}</option>)}</select></label><Button icon={generating ? <LoaderCircle size={15} /> : <FileText size={15} />} onClick={() => void generate()}>{generating ? "Generating…" : "Generate report"}</Button></div></Card>
        <Card className="report-preview"><div className="preview-toolbar"><span><FileText size={16} /> SAVED REPORTS</span><button onClick={() => void refresh()}>Refresh</button></div>{loading ? <LoadingNotice /> : reports.length ? <div className="report-list">{reports.map((item) => <button className={`report-list-item ${report?.id === item.id ? "selected" : ""}`} key={item.id} onClick={() => setLatest(item)}><span><b>{item.title}</b><small>{shortDate(item.createdAt)}</small></span><FileChartColumn size={16} /></button>)}</div> : <div className="preview-empty"><FileText size={27} /><b>No saved reports yet</b><p>Generate a report to save computed results in your workspace.</p></div>}</Card>
      </div>
      <ErrorNotice error={error} />
      {report && <Card className="saved-report-preview"><SectionHead title={report.title} sub={`Saved ${shortDate(report.createdAt)}`} action={<a className="btn secondary compact" href={`/api/reports/${encodeURIComponent(report.id)}/download`}><Download size={14} /> Download HTML</a>} /><pre>{JSON.stringify(report.content, null, 2)}</pre></Card>}
    </>
  );
}

export function SettingsPage() {
  const auth = useAuth();
  const name = [auth.user?.firstName, auth.user?.lastName].filter(Boolean).join(" ") || "InsightForge user";
  return (
    <>
      <PageTitle eyebrow="WORKSPACE PREFERENCES" title="Settings" subtitle="Account details for your private InsightForge workspace." />
      <div className="settings-layout">
        <Card><SectionHead title="Signed-in account" sub="Managed through Replit sign-in" /><div className="profile-edit"><span className="avatar large">{name.slice(0, 1).toUpperCase()}</span><div><b>{name}</b><small>{auth.user?.email ?? "Email not provided"}</small></div></div><button className="btn secondary" onClick={auth.logout}>Sign out</button></Card>
        <Card><SectionHead title="Privacy and storage" /><p className="body-note">Uploaded files are stored in private object storage. Dataset records, computed profiles, experiments, and reports are associated with your signed-in account.</p><p className="body-note">Use the Datasets page to permanently delete an uploaded dataset and its file.</p></Card>
      </div>
    </>
  );
}

export function HelpPage() {
  const [open, setOpen] = useState(0);
  const answers = [
    ["Where are my uploaded files stored?", "Files are uploaded directly to private object storage. Each dataset is linked to your signed-in account, and private object reads check ownership."],
    ["What does profiling calculate?", "InsightForge uses pandas to inspect column types, missing values, unique values, duplicate rows, summary measures, and sample records."],
    ["How are model scores produced?", "The ML Lab trains scikit-learn estimators with a held-out test split. Scores and permutation importance are computed from that split and saved as experiments."],
    ["What can the AI Analyst access?", "The Analyst can call the dataset profile, descriptive statistics, and a selected-column distribution. It does not receive a raw file download."],
  ];
  return (
    <>
      <PageTitle eyebrow="SUPPORT" title="Help & guidance" subtitle="How to use the live InsightForge analysis workspace." />
      <div className="help-layout">
        <Card className="guide-card"><span className="guide-icon"><CircleHelp size={20} /></span><h2>Start with a dataset.</h2><p>Upload a CSV, XLSX, or JSON file, then review its profile, explore charts, compute statistics, train a model, and save a report.</p><Link className="btn primary" href="/datasets"><Upload size={15} /> Browse datasets</Link></Card>
        <Card><SectionHead title="Frequently asked questions" />{answers.map(([question, answer], index) => <div className="faq-item" key={question}><button onClick={() => setOpen(open === index ? -1 : index)}><b>{question}</b><span>{open === index ? "−" : "+"}</span></button>{open === index && <p>{answer}</p>}</div>)}</Card>
      </div>
    </>
  );
}