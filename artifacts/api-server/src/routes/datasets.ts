import {
  CleanDatasetBody,
  CleanDatasetResponse,
  CreateDatasetVisualizationBody,
  CreateDatasetVisualizationResponse,
  DeleteDatasetResponse,
  GetDatasetResponse,
  GetDatasetProfileResponse,
  GetDatasetStatisticsResponse,
  ListDatasetsResponse,
  RegisterDatasetBody,
  RegisterDatasetResponse,
} from "@workspace/api-zod";
import {
  and,
  desc,
  eq,
  gt,
  isNull,
} from "drizzle-orm";
import {
  db,
  datasetsTable,
  uploadTicketsTable,
} from "@workspace/db";
import { Router, type IRouter, type Request, type Response } from "express";
import path from "node:path";
import { ComputeServiceError, runCleaning, runCompute } from "../lib/computeClient";
import {
  contentTypeForFileType,
  findOwnedDataset,
  objectStorageService,
  readDatasetBytes,
  storePrivateBuffer,
  toDatasetResponse,
} from "../lib/datasets";

const router: IRouter = Router();
const MAX_FILE_SIZE = 100 * 1024 * 1024;
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

function reportAnalysisError(
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

router.post("/datasets/complete", async (req: Request, res: Response) => {
  const userId = getUserId(req, res);
  if (!userId) return;
  const parsed = RegisterDatasetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid dataset metadata." });
    return;
  }

  const { size, objectPath } = parsed.data;
  const name = path.basename(parsed.data.name).trim().slice(0, 255);
  const fileType = name.split(".").pop()?.toLowerCase() ?? "";
  if (!name || !["csv", "xlsx", "json"].includes(fileType)) {
    res.status(400).json({ error: "Supported formats are CSV, XLSX, and JSON." });
    return;
  }
  if (size < 1 || size > MAX_FILE_SIZE) {
    res.status(400).json({ error: "Files must be between 1 byte and 100 MB." });
    return;
  }
  if (!objectPath.startsWith("/objects/uploads/")) {
    res.status(400).json({ error: "Invalid uploaded object path." });
    return;
  }

  const [ticket] = await db
    .select()
    .from(uploadTicketsTable)
    .where(
      and(
        eq(uploadTicketsTable.userId, userId),
        eq(uploadTicketsTable.objectPath, objectPath),
        isNull(uploadTicketsTable.consumedAt),
        gt(uploadTicketsTable.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (
    !ticket ||
    ticket.name !== name ||
    ticket.size !== size ||
    ticket.contentType !== parsed.data.contentType
  ) {
    res.status(403).json({ error: "This upload does not belong to your account or has expired." });
    return;
  }

  let uploadedFile;
  try {
    uploadedFile = await objectStorageService.getObjectEntityFile(objectPath);
    const [metadata] = await uploadedFile.getMetadata();
    const actualSize = Number(metadata.size ?? 0);
    if (actualSize !== ticket.size || actualSize > MAX_FILE_SIZE) {
      await uploadedFile.delete({ ignoreNotFound: true }).catch(() => undefined);
      await db
        .update(uploadTicketsTable)
        .set({ consumedAt: new Date() })
        .where(eq(uploadTicketsTable.id, ticket.id))
        .catch(() => undefined);
      res.status(400).json({ error: "Uploaded file size does not match its upload request." });
      return;
    }
    const [bytes] = await uploadedFile.download();
    const profile = await runCompute<{
      rows: number;
      columns: number;
      qualityScore: number;
      targetCandidates: string[];
      profile: Record<string, unknown>;
    }>(
      "profile",
      name,
      contentTypeForFileType(fileType),
      bytes,
    );
    await objectStorageService.trySetObjectEntityAclPolicy(objectPath, {
      owner: userId,
      visibility: "private",
    });

    const dataset = await db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(uploadTicketsTable)
        .set({ consumedAt: new Date() })
        .where(
          and(
            eq(uploadTicketsTable.id, ticket.id),
            isNull(uploadTicketsTable.consumedAt),
          ),
        )
        .returning({ id: uploadTicketsTable.id });
      if (!claimed) {
        throw new Error("This upload has already been registered.");
      }
      const [created] = await tx
        .insert(datasetsTable)
        .values({
          userId,
          name,
          fileType,
          objectPath,
          fileSize: actualSize,
          rowCount: profile.rows,
          columnCount: profile.columns,
          qualityScore: profile.qualityScore,
          targetCandidates: profile.targetCandidates,
          profile: profile.profile,
        })
        .returning();
      return created;
    });
    res.status(201).json(
      RegisterDatasetResponse.parse(toDatasetResponse(dataset)),
    );
  } catch (error) {
    if (error instanceof ComputeServiceError) {
      if (error.status >= 400 && error.status < 500 && uploadedFile) {
        await uploadedFile.delete().catch(() => undefined);
        await db
          .update(uploadTicketsTable)
          .set({ consumedAt: new Date() })
          .where(eq(uploadTicketsTable.id, ticket.id))
          .catch(() => undefined);
      }
      reportAnalysisError(req, res, error, "Dataset profiling failed.");
      return;
    }
    req.log.error({ err: error }, "Error registering dataset");
    res.status(500).json({ error: "Could not register this dataset." });
  }
});

router.get("/datasets", async (req: Request, res: Response) => {
  const userId = getUserId(req, res);
  if (!userId) return;
  const rows = await db
    .select()
    .from(datasetsTable)
    .where(eq(datasetsTable.userId, userId))
    .orderBy(desc(datasetsTable.createdAt));
  res.json(
    ListDatasetsResponse.parse({
      datasets: rows.map(toDatasetResponse),
    }),
  );
});

router.get("/datasets/:datasetId", async (req: Request, res: Response) => {
  const userId = getUserId(req, res);
  if (!userId) return;
  const datasetId = pathParam(req.params.datasetId);
  if (!UUID_PATTERN.test(datasetId)) {
    res.status(400).json({ error: "Invalid dataset id." });
    return;
  }
  const dataset = await findOwnedDataset(datasetId, userId);
  if (!dataset) {
    res.status(404).json({ error: "Dataset not found." });
    return;
  }
  res.json(GetDatasetResponse.parse(toDatasetResponse(dataset)));
});

router.delete("/datasets/:datasetId", async (req: Request, res: Response) => {
  const userId = getUserId(req, res);
  if (!userId) return;
  const datasetId = pathParam(req.params.datasetId);
  if (!UUID_PATTERN.test(datasetId)) {
    res.status(400).json({ error: "Invalid dataset id." });
    return;
  }
  const dataset = await findOwnedDataset(datasetId, userId);
  if (!dataset) {
    res.status(404).json({ error: "Dataset not found." });
    return;
  }
  try {
    const file = await objectStorageService.getObjectEntityFile(dataset.objectPath);
    await file.delete({ ignoreNotFound: true });
    await db.delete(datasetsTable).where(eq(datasetsTable.id, dataset.id));
    res.json(DeleteDatasetResponse.parse({ success: true }));
  } catch (error) {
    req.log.error({ err: error }, "Error deleting dataset");
    res.status(500).json({ error: "Could not delete this dataset." });
  }
});

router.get("/datasets/:datasetId/profile", async (req: Request, res: Response) => {
  const userId = getUserId(req, res);
  if (!userId) return;
  const datasetId = pathParam(req.params.datasetId);
  if (!UUID_PATTERN.test(datasetId)) {
    res.status(400).json({ error: "Invalid dataset id." });
    return;
  }
  const dataset = await findOwnedDataset(datasetId, userId);
  if (!dataset) {
    res.status(404).json({ error: "Dataset not found." });
    return;
  }
  res.json(GetDatasetProfileResponse.parse(dataset.profile));
});

router.get("/datasets/:datasetId/statistics", async (req: Request, res: Response) => {
  const userId = getUserId(req, res);
  if (!userId) return;
  const datasetId = pathParam(req.params.datasetId);
  if (!UUID_PATTERN.test(datasetId)) {
    res.status(400).json({ error: "Invalid dataset id." });
    return;
  }
  const dataset = await findOwnedDataset(datasetId, userId);
  if (!dataset) {
    res.status(404).json({ error: "Dataset not found." });
    return;
  }
  try {
    const bytes = await readDatasetBytes(dataset, userId);
    const stats = await runCompute(
      "statistics",
      dataset.name,
      contentTypeForFileType(dataset.fileType),
      bytes,
    );
    res.json(GetDatasetStatisticsResponse.parse(stats));
  } catch (error) {
    reportAnalysisError(req, res, error, "Statistics calculation failed.");
  }
});

router.post("/datasets/:datasetId/eda", async (req: Request, res: Response) => {
  const userId = getUserId(req, res);
  if (!userId) return;
  const datasetId = pathParam(req.params.datasetId);
  if (!UUID_PATTERN.test(datasetId)) {
    res.status(400).json({ error: "Invalid dataset id." });
    return;
  }
  const parsed = CreateDatasetVisualizationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid chart options." });
    return;
  }
  const dataset = await findOwnedDataset(datasetId, userId);
  if (!dataset) {
    res.status(404).json({ error: "Dataset not found." });
    return;
  }
  try {
    const bytes = await readDatasetBytes(dataset, userId);
    const chart = await runCompute(
      "eda",
      dataset.name,
      contentTypeForFileType(dataset.fileType),
      bytes,
      parsed.data,
    );
    res.json(CreateDatasetVisualizationResponse.parse(chart));
  } catch (error) {
    reportAnalysisError(req, res, error, "Visualization generation failed.");
  }
});

router.post("/datasets/:datasetId/clean", async (req: Request, res: Response) => {
  const userId = getUserId(req, res);
  if (!userId) return;
  const datasetId = pathParam(req.params.datasetId);
  if (!UUID_PATTERN.test(datasetId)) {
    res.status(400).json({ error: "Invalid dataset id." });
    return;
  }
  const parsed = CleanDatasetBody.safeParse(req.body);
  if (!parsed.success || parsed.data.operations.length === 0) {
    res.status(400).json({ error: "Choose at least one cleaning operation." });
    return;
  }
  const dataset = await findOwnedDataset(datasetId, userId);
  if (!dataset) {
    res.status(404).json({ error: "Dataset not found." });
    return;
  }
  try {
    const originalBytes = await readDatasetBytes(dataset, userId);
    const cleanedBytes = await runCleaning(
      dataset.name,
      contentTypeForFileType(dataset.fileType),
      originalBytes,
      parsed.data.operations,
    );
    const profile = await runCompute<{
      rows: number;
      columns: number;
      qualityScore: number;
      targetCandidates: string[];
      profile: Record<string, unknown>;
    }>("profile", `${dataset.name.replace(/\.[^.]+$/, "")}_cleaned.csv`, "text/csv", cleanedBytes);
    const cleanedName = `${dataset.name.replace(/\.[^.]+$/, "")}_cleaned.csv`.slice(0, 255);
    const objectPath = await storePrivateBuffer(
      cleanedBytes,
      userId,
      "text/csv",
    );
    const [created] = await db
      .insert(datasetsTable)
      .values({
        userId,
        name: cleanedName,
        fileType: "csv",
        objectPath,
        fileSize: cleanedBytes.length,
        rowCount: profile.rows,
        columnCount: profile.columns,
        qualityScore: profile.qualityScore,
        targetCandidates: profile.targetCandidates,
        profile: profile.profile,
      })
      .returning();
    res.status(201).json(
      CleanDatasetResponse.parse(toDatasetResponse(created)),
    );
  } catch (error) {
    reportAnalysisError(req, res, error, "Dataset cleaning failed.");
  }
});

export default router;