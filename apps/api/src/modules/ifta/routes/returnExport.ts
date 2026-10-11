import type { Router } from "express";
import { z } from "zod";
import { requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { readIftaReturn } from "../returnReads.js";
import { iftaReturnWorkbook } from "../returnWorkbook.js";
import { iftaReturnPdf } from "../returnPdf.js";

const querySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  quarter: z.coerce.number().int().min(1).max(4),
});

/**
 * `GET /api/ifta/return.xlsx` and `/return.pdf`: one quarter's IFTA return as a file
 * (IFTA-PRECISION-PLAN IP9).
 *
 * The fuel section's VIEW set, the gate of `/period` itself: the file is that read, broken down by
 * truck, and the accountant who files the return is exactly who needs it. Audited as
 * `export.generated`, as the fuel reports are, because a figure in a filed return is quoted back
 * months later and somebody will ask which export it came from.
 */
export function registerReturnExportRoutes(router: Router): void {
  for (const format of ["xlsx", "pdf"] as const) {
    router.get(
      `/return.${format}`,
      requireOrg,
      requireSection("fuel", "view"),
      asyncHandler(async (req, res) => {
        const parsed = querySchema.safeParse(req.query);
        if (!parsed.success) {
          res.status(400).json(apiError("bad_request", "Provide ?year=YYYY&quarter=1..4."));
          return;
        }
        const { year, quarter } = parsed.data;
        const orgId = req.auth!.orgId!;
        const admin = getSupabaseAdmin(getAppLocals(req).env);
        const { report, orgName } = await readIftaReturn(admin, orgId, year, quarter);
        const meta = { orgName, generatedAt: new Date().toISOString() };
        const file = format === "xlsx"
          ? { bytes: await iftaReturnWorkbook(report, meta), pages: null }
          : await iftaReturnPdf(report, meta).then((r) => ({ bytes: r.pdf, pages: r.pages }));
        await writeAudit(admin, {
          orgId, actorId: req.auth!.userId, action: "export.generated",
          entity: "ifta_return",
          meta: {
            report: `return.${format}`, year, quarter, pages: file.pages,
            trucks: report.trucks.length, fills: report.fills.length, issues: report.issues.length,
          },
        });
        res.setHeader("Content-Type", format === "xlsx"
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="ifta-return-${year}-Q${quarter}.${format}"`);
        res.send(file.bytes);
      }),
    );
  }
}
