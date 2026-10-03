import {
  ChatWithAnalystBody,
  ChatWithAnalystResponse,
  CleanDatasetBody,
  CleanDatasetResponse,
  CreateDatasetVisualizationBody,
  CreateDatasetVisualizationResponse,
  GenerateReportBody,
  GenerateReportResponse,
  GetDatasetProfileResponse,
  GetDatasetStatisticsResponse,
  GetExperimentResponse,
  GetReportResponse,
  ListDatasetsResponse,
  ListExperimentsResponse,
  ListReportsResponse,
  RegisterDatasetBody,
  RegisterDatasetResponse,
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
  TrainModelBody,
  TrainModelResponse,
} from "@workspace/api-zod";

type ParseSchema<T> = { parse(value: unknown): T };

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiRequest<T>(
  path: string,
  schema: ParseSchema<T>,
  init: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      credentials: "include",
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError("The InsightForge API is unavailable.", 503);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      payload && typeof payload.error === "string"
        ? payload.error
        : `Request failed (${response.status}).`;
    throw new ApiError(message, response.status);
  }
  try {
    return schema.parse(payload);
  } catch {
    throw new ApiError("The server returned an unexpected response.", 502);
  }
}

function postJson<T>(path: string, schema: ParseSchema<T>, body: unknown) {
  return apiRequest(path, schema, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export const listDatasets = () =>
  apiRequest("/datasets", ListDatasetsResponse);

export const getDatasetProfile = (datasetId: string) =>
  apiRequest(
    `/datasets/${encodeURIComponent(datasetId)}/profile`,
    GetDatasetProfileResponse,
  );

export const getDatasetStatistics = (datasetId: string) =>
  apiRequest(
    `/datasets/${encodeURIComponent(datasetId)}/statistics`,
    GetDatasetStatisticsResponse,
  );

export const createVisualization = (
  datasetId: string,
  body: unknown,
) => {
  const request = CreateDatasetVisualizationBody.parse(body);
  return postJson(
    `/datasets/${encodeURIComponent(datasetId)}/eda`,
    CreateDatasetVisualizationResponse,
    request,
  );
};

export const cleanDataset = (datasetId: string, body: unknown) => {
  const request = CleanDatasetBody.parse(body);
  return postJson(
    `/datasets/${encodeURIComponent(datasetId)}/clean`,
    CleanDatasetResponse,
    request,
  );
};

export const trainModel = (body: unknown) => {
  const request = TrainModelBody.parse(body);
  return postJson("/ml/train", TrainModelResponse, request);
};

export const listExperiments = () =>
  apiRequest("/experiments", ListExperimentsResponse);

export const getExperiment = (experimentId: string) =>
  apiRequest(
    `/experiments/${encodeURIComponent(experimentId)}`,
    GetExperimentResponse,
  );

export const chatWithAnalyst = (body: unknown) => {
  const request = ChatWithAnalystBody.parse(body);
  return postJson("/ai-analyst/chat", ChatWithAnalystResponse, request);
};

export const listReports = () =>
  apiRequest("/reports", ListReportsResponse);

export const generateReport = (body: unknown) => {
  const request = GenerateReportBody.parse(body);
  return postJson("/reports/generate", GenerateReportResponse, request);
};

export const getReport = (reportId: string) =>
  apiRequest(`/reports/${encodeURIComponent(reportId)}`, GetReportResponse);

export async function uploadDataset(file: File) {
  const contentType =
    file.type ||
    (file.name.toLowerCase().endsWith(".csv")
      ? "text/csv"
      : file.name.toLowerCase().endsWith(".json")
        ? "application/json"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const metadata = RequestUploadUrlBody.parse({
    name: file.name,
    size: file.size,
    contentType,
  });
  const ticket = await postJson(
    "/storage/uploads/request-url",
    RequestUploadUrlResponse,
    metadata,
  );
  const upload = await fetch(ticket.uploadURL, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: file,
  });
  if (!upload.ok) {
    throw new ApiError(`File upload failed (${upload.status}).`, upload.status);
  }
  return postJson("/datasets/complete", RegisterDatasetResponse, {
    ...metadata,
    objectPath: ticket.objectPath,
  });
}