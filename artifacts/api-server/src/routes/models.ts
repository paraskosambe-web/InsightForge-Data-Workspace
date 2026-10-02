import {
  GetExperimentResponse,
  ListExperimentsResponse,
  TrainModelBody,
  TrainModelResponse,
} from "@workspace/api-zod";
import {
  and,
  desc,
  eq,
} from "drizzle-orm";
import {
  db,
  datasetsTable,
  experimentsTable,
} from "@workspace/db";
import { Router, type IRouter, type Request, type Response } from "express";
import { ComputeServiceError, runCompute } from "../lib/computeClient";
import {
  contentTypeForFileType,
  findOwnedDataset,
  readDatasetBytes,
} from "../lib/datasets";

const router: IRouter = Router();
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getUserId(req: Request, res: Response): string | null {
  if (req.isAuthenticated() && req.user) return req.user.id;
  res.status(401).json({ error: "Authentication required." });
  return null;
}

function pathParam(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : Array.isArray(value) ? value[0] ?? "" : "";
}

function experimentResponse(
  row: typeof experimentsTable.$inferSelect,
  datasetName: string,
) {
  return {
    id: row.id,
    datasetId: row.datasetId,
    datasetName,
    name: row.name,
    problemType: row.problemType,
    targetColumn: row.targetColumn,
    features: row.featureColumns,
    model: row.model,
    metrics: row.metrics,
    featureImportance: row.featureImportance,
    confusionMatrix: row.confusionMatrix,
    durationSeconds: row.durationSeconds,
    createdAt: row.createdAt.toISOString(),
  };
}

function reportComputeError(
  req: Request,
  res: Response,
  error: unknown,
  fallback: string,
) {
  if (error instanceof ComputeServiceError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  req.log.error({ err: error }, fallback);
  res.status(502).json({ error: fallback });
}

router.post("/ml/train", async (req: Request, res: Response) => {
  const userId = getUserId(req, res);
  if (!userId) return;
  const parsed = TrainModelBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid model configuration." });
    return;
  }
  const dataset = await findOwnedDataset(
    parsed.data.datasetId,
    userId,
  );
  if (!dataset) {
    res.status(404).json({ error: "Dataset not found." });
    return;
  }
  try {
    const bytes = await readDatasetBytes(dataset, userId);
    const result = await runCompute<{
      problemType: string;
      metrics: Record<string, unknown>;
      featureImportance: Array<{ feature: string; importance: number }>;
      confusionMatrix: number[][] | null;
      durationSeconds: number;
    }>(
      "train",
      dataset.name,
      contentTypeForFileType(dataset.fileType),
      bytes,
      parsed.data,
    );
    const [saved] = await db
      .insert(experimentsTable)
      .values({
        userId,
        datasetId: dataset.id,
        name: `${parsed.data.model} · ${parsed.data.targetColumn}`,
        problemType: result.problemType,
        targetColumn: parsed.data.targetColumn,
        featureColumns: parsed.data.features,
        model: parsed.data.model,
        metrics: result.metrics,
        featureImportance: result.featureImportance,
        confusionMatrix: result.confusionMatrix,
        durationSeconds: result.durationSeconds,
      })
      .returning();
    res.status(201).json(
      TrainModelResponse.parse(experimentResponse(saved, dataset.name)),
    );
  } catch (error) {
    reportComputeError(req, res, error, "Model training failed.");
  }
});

router.get("/experiments", async (req: Request, res: Response) => {
  const userId = getUserId(req, res);
  if (!userId) return;
  const rows = await db
    .select({
      experiment: experimentsTable,
      datasetName: datasetsTable.name,
    })
    .from(experimentsTable)
    .innerJoin(datasetsTable, eq(experimentsTable.datasetId, datasetsTable.id))
    .where(eq(experimentsTable.userId, userId))
    .orderBy(desc(experimentsTable.createdAt));
  res.json(
    ListExperimentsResponse.parse({
      experiments: rows.map(({ experiment, datasetName }) =>
        experimentResponse(experiment, datasetName),
      ),
    }),
  );
});

router.get(
  "/experiments/:experimentId",
  async (req: Request, res: Response) => {
    const userId = getUserId(req, res);
    if (!userId) return;
    const experimentId = pathParam(req.params.experimentId);
    if (!UUID_PATTERN.test(experimentId)) {
      res.status(400).json({ error: "Invalid experiment id." });
      return;
    }
    const rows = await db
      .select({
        experiment: experimentsTable,
        datasetName: datasetsTable.name,
      })
      .from(experimentsTable)
      .innerJoin(datasetsTable, eq(experimentsTable.datasetId, datasetsTable.id))
      .where(
        and(
          eq(experimentsTable.id, experimentId),
          eq(experimentsTable.userId, userId),
        ),
      )
      .limit(1);
    if (!rows[0]) {
      res.status(404).json({ error: "Experiment not found." });
      return;
    }
    res.json(
      GetExperimentResponse.parse(
        experimentResponse(rows[0].experiment, rows[0].datasetName),
      ),
    );
  },
);

export default router;