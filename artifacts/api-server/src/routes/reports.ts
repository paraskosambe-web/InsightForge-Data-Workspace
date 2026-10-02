import {
  GenerateReportBody,
  GenerateReportResponse,
  GetReportResponse,
  ListReportsResponse,
} from "@workspace/api-zod";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  datasetsTable,
  experimentsTable,
  reportsTable,
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

function reportResponse(row: typeof reportsTable.$inferSelect) {
  return {
    id: row.id,
    datasetId: row.datasetId,
    title: row.title,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  };
}

router.get("/reports", async (req: Request, res: Response) => {
  const userId = getUserId(req, res);
  if (!userId) return;
  const rows = await db
    .select()
    .from(reportsTable)
    .where(eq(reportsTable.userId, userId))
    .orderBy(desc(reportsTable.createdAt));
  res.json(
    ListReportsResponse.parse({ reports: rows.map(reportResponse) }),
  );
});

router.post("/reports/generate", async (req: Request, res: Response) => {
  const userId = getUserId(req, res);
  if (!userId) return;
  const parsed = GenerateReportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a valid dataset for the report." });
    return;
  }
  const dataset = await findOwnedDataset(parsed.data.datasetId, userId);
  if (!dataset) {
    res.status(404).json({ error: "Dataset not found." });
    return;
  }
  try {
    const bytes = await readDatasetBytes(dataset, userId);
    const statistics = await runCompute(
      "statistics",
      dataset.name,
      contentTypeForFileType(dataset.fileType),
      bytes,
    );
    let experiment: Record<string, unknown> | null = null;
    if (parsed.data.experimentId) {
      const [result] = await db
        .select()
        .from(experimentsTable)
        .where(
          and(
            eq(experimentsTable.id, parsed.data.experimentId),
            eq(experimentsTable.datasetId, dataset.id),
            eq(experimentsTable.userId, userId),
          ),
        )
        .limit(1);
      if (!result) {
        res.status(404).json({ error: "Experiment not found for this dataset." });
        return;
      }
      experiment = {
        id: result.id,
        name: result.name,
        model: result.model,
        problemType: result.problemType,
        targetColumn: result.targetColumn,
        metrics: result.metrics,
        featureImportance: result.featureImportance,
      };
    }
    const [saved] = await db
      .insert(reportsTable)
      .values({
        userId,
        datasetId: dataset.id,
        title: `${dataset.name} · analysis report`,
        content: {
          dataset: {
            name: dataset.name,
            rows: dataset.rowCount,
            columns: dataset.columnCount,
            qualityScore: dataset.qualityScore,
            createdAt: dataset.createdAt.toISOString(),
          },
          profile: dataset.profile,
          statistics,
          experiment,
        },
      })
      .returning();
    res.status(201).json(
      GenerateReportResponse.parse(reportResponse(saved)),
    );
  } catch (error) {
    if (error instanceof ComputeServiceError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    req.log.error({ err: error }, "Error generating report");
    res.status(502).json({ error: "Report generation failed." });
  }
});

router.get("/reports/:reportId", async (req: Request, res: Response) => {
  const userId = getUserId(req, res);
  if (!userId) return;
  const reportId = pathParam(req.params.reportId);
  if (!UUID_PATTERN.test(reportId)) {
    res.status(400).json({ error: "Invalid report id." });
    return;
  }
  const [report] = await db
    .select()
    .from(reportsTable)
    .where(
      and(
        eq(reportsTable.id, reportId),
        eq(reportsTable.userId, userId),
      ),
    )
    .limit(1);
  if (!report) {
    res.status(404).json({ error: "Report not found." });
    return;
  }
  res.json(GetReportResponse.parse(reportResponse(report)));
});

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

router.get(
  "/reports/:reportId/download",
  async (req: Request, res: Response) => {
    const userId = getUserId(req, res);
    if (!userId) return;
    const reportId = pathParam(req.params.reportId);
    if (!UUID_PATTERN.test(reportId)) {
      res.status(400).json({ error: "Invalid report id." });
      return;
    }
    const [report] = await db
      .select()
      .from(reportsTable)
      .where(
        and(
          eq(reportsTable.id, reportId),
          eq(reportsTable.userId, userId),
        ),
      )
      .limit(1);
    if (!report) {
      res.status(404).json({ error: "Report not found." });
      return;
    }
    const content = JSON.stringify(report.content, null, 2);
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(report.title)}</title><style>body{margin:0;background:#101519;color:#e9eff0;font:15px/1.6 system-ui,sans-serif}.page{max-width:980px;margin:48px auto;padding:0 24px}h1{color:#67d9b7}h2{margin-top:36px;color:#acdcca}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#171f23;border:1px solid #29383a;border-radius:12px;padding:22px;color:#d8e2e2}.meta{color:#9eabad}</style></head><body><main class="page"><p class="meta">INSIGHTFORGE · DATA ANALYSIS</p><h1>${escapeHtml(report.title)}</h1><p class="meta">Generated ${escapeHtml(report.createdAt.toISOString())}</p><pre>${escapeHtml(content)}</pre></main></body></html>`;
    res
      .status(200)
      .type("html")
      .setHeader(
        "Content-Disposition",
        `attachment; filename="${report.id}-report.html"`,
      )
      .send(html);
  },
);

export default router;