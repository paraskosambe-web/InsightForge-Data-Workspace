export class ComputeServiceError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ComputeServiceError";
  }
}

const computeBaseUrl =
  process.env.PYTHON_SERVICE_URL ?? "http://127.0.0.1:8008";

async function postCompute(
  operation: string,
  filename: string,
  contentType: string,
  bytes: Buffer,
  args?: Record<string, unknown>,
): Promise<Response> {
  const serviceToken = process.env.SESSION_SECRET;
  if (!serviceToken) {
    throw new ComputeServiceError("Compute service is not configured.", 503);
  }

  const form = new FormData();
  const blob = new Blob([new Uint8Array(bytes)], { type: contentType });
  form.append("file", blob, filename);
  if (args) form.append("args", JSON.stringify(args));

  try {
    return await fetch(`${computeBaseUrl}/${operation}`, {
      method: "POST",
      headers: { "x-service-token": serviceToken },
      body: form,
      signal: AbortSignal.timeout(operation === "train" ? 300_000 : 120_000),
    });
  } catch (error) {
    throw new ComputeServiceError(
      error instanceof Error && error.name === "TimeoutError"
        ? "The analysis took too long. Try a smaller dataset."
        : "The Python analysis service is unavailable.",
      503,
    );
  }
}

async function readError(response: Response): Promise<string> {
  const body = await response.text();
  if (!body) return `Analysis failed (${response.status}).`;
  try {
    const parsed = JSON.parse(body) as { detail?: unknown; error?: unknown };
    if (typeof parsed.detail === "string") return parsed.detail;
    if (typeof parsed.error === "string") return parsed.error;
  } catch {
    // FastAPI may return plain text for internal service authentication errors.
  }
  return body.slice(0, 400);
}

export async function runCompute<T>(
  operation: "profile" | "statistics" | "eda" | "train",
  filename: string,
  contentType: string,
  bytes: Buffer,
  args?: Record<string, unknown>,
): Promise<T> {
  const response = await postCompute(
    operation,
    filename,
    contentType,
    bytes,
    args,
  );
  if (!response.ok) {
    throw new ComputeServiceError(await readError(response), response.status);
  }
  return (await response.json()) as T;
}

export async function runCleaning(
  filename: string,
  contentType: string,
  bytes: Buffer,
  operations: unknown[],
): Promise<Buffer> {
  const response = await postCompute(
    "clean",
    filename,
    contentType,
    bytes,
    { operations },
  );
  if (!response.ok) {
    throw new ComputeServiceError(await readError(response), response.status);
  }
  const cleaned = Buffer.from(await response.arrayBuffer());
  if (cleaned.length > 100 * 1024 * 1024) {
    throw new ComputeServiceError(
      "The cleaned dataset exceeds the 100 MB limit.",
      413,
    );
  }
  return cleaned;
}