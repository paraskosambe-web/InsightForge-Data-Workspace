import { and, eq } from "drizzle-orm";
import { db, datasetsTable, type Dataset } from "@workspace/db";
import { ObjectPermission } from "./objectAcl";
import { ObjectStorageService } from "./objectStorage";

export const objectStorageService = new ObjectStorageService();

export function toDatasetResponse(dataset: Dataset) {
  return {
    id: dataset.id,
    name: dataset.name,
    fileType: dataset.fileType,
    fileSize: dataset.fileSize,
    rows: dataset.rowCount,
    columns: dataset.columnCount,
    qualityScore: dataset.qualityScore,
    targetCandidates: dataset.targetCandidates,
    profile: dataset.profile,
    createdAt: dataset.createdAt.toISOString(),
  };
}

export async function findOwnedDataset(
  datasetId: string,
  userId: string,
): Promise<Dataset | null> {
  const [dataset] = await db
    .select()
    .from(datasetsTable)
    .where(and(eq(datasetsTable.id, datasetId), eq(datasetsTable.userId, userId)))
    .limit(1);
  return dataset ?? null;
}

export async function readDatasetBytes(dataset: Dataset, userId: string) {
  const file = await objectStorageService.getObjectEntityFile(dataset.objectPath);
  const canRead = await objectStorageService.canAccessObjectEntity({
    userId,
    objectFile: file,
    requestedPermission: ObjectPermission.READ,
  });
  if (!canRead) {
    throw new Error("The stored file is not accessible to its owner.");
  }
  const [bytes] = await file.download();
  return bytes;
}

export function contentTypeForFileType(fileType: string): string {
  switch (fileType.toLowerCase()) {
    case "csv":
      return "text/csv";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "json":
      return "application/json";
    default:
      return "application/octet-stream";
  }
}

export async function storePrivateBuffer(
  bytes: Buffer,
  userId: string,
  contentType: string,
): Promise<string> {
  const uploadUrl = await objectStorageService.getObjectEntityUploadURL();
  const objectPath = objectStorageService.normalizeObjectEntityPath(uploadUrl);
  const uploaded = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: new Uint8Array(bytes),
    signal: AbortSignal.timeout(120_000),
  });
  if (!uploaded.ok) {
    throw new Error(`Private object upload failed (${uploaded.status}).`);
  }
  await objectStorageService.trySetObjectEntityAclPolicy(objectPath, {
    owner: userId,
    visibility: "private",
  });
  return objectPath;
}