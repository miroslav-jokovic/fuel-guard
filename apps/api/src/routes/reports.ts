import { Router } from "express";
import PDFDocument from "pdfkit";
import { toCsv, aggregateDashboard, type FuelTransaction, type Anomaly } from "@fuelguard/shared";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth.js";
import { asyncHandler } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { writeAudit } from "../lib/audit.js";
import type { SupabaseClient } from "@supabase/supabase-js";

const qstr = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

function defaultRange(from?: string, to?: string): { from: string; to: string } {
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(end.getTime() - 30 * 86400_000);
  return { from: start.toISOString(), to: end.toISOString() };
}

interface TxnExport {
  fueled_at: string;
  gallons: number;
  odometer: number | null;
  price_per_gal: number | null;
  total_cost: number | null;
  computed_mpg: number | null;
  source: string;
  location_text: string | null;
  max_severity: string | null;
  vehicles: { unit_number: string } | null;
  drivers: { full_name: string } | null;
}

async function loadTxnExport(admin: SupabaseClient, orgId: string, from: string, to: string): Promise<TxnExport[]> {
  const { data } = await admin
    .from("fuel_transactions")
    .select("fueled_at, gallons, odometer, price_per_gal, total_cost, computed_mpg, source, location_text, max_severity, vehicles(unit_number), drivers(full_name)")
    .eq("org_id", orgId)
    .gte("fueled_at", from)
    .lte("fueled_at", to)
    .order("fueled_at", { ascending: false });
  return (data ?? []) as unknown as TxnExport[];
}

export function reportsRouter(): Router {
  const router = Router();
  router.use(requireAuth, requireOrg, requireRole("admin", "fleet_manager", "auditor"));

  // transactions.csv
  router.get(
    "/transactions.csv",
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const { from, to } = defaultRange(qstr(req.query.from), qstr(req.query.to));
      const rows = (await loadTxnExport(admin, orgId, from, to)).map((t) => ({
        fueled_at: t.fueled_at,
        unit: t.vehicles?.unit_number ?? "",
        driver: t.drivers?.full_name ?? "",
        odometer: t.odometer ?? "",
        gallons: t.gallons,
        price_per_gal: t.price_per_gal ?? "",
        total_cost: t.total_cost ?? "",
        computed_mpg: t.computed_mpg ?? "",
        source: t.source,
        location: t.location_text ?? "",
        flag: t.max_severity ?? "",
      }));
      const csv = toCsv(rows, [
        { key: "fueled_at", header: "Fueled At" },
        { key: "unit", header: "Unit" },
        { key: "driver", header: "Driver" },
        { key: "odometer", header: "Odometer" },
        { key: "gallons", header: "Gallons" },
        { key: "price_per_gal", header: "$/gal" },
        { key: "total_cost", header: "Total" },
        { key: "computed_mpg", header: "MPG" },
        { key: "source", header: "Source" },
        { key: "location", header: "Location" },
        { key: "flag", header: "Flag" },
      ]);
      await writeAudit(admin, { orgId, actorId: req.auth!.userId, action: "export.generated", meta: { report: "transactions.csv", rows: rows.length } });
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="fuelguard-transactions.csv"');
      res.send(csv);
    }),
  );

  // anomalies.csv
  router.get(
    "/anomalies.csv",
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const { from, to } = defaultRange(qstr(req.query.from), qstr(req.query.to));
      const { data } = await admin
        .from("anomalies")
        .select("created_at, rule_id, severity, status, message, vehicles(unit_number)")
        .eq("org_id", orgId)
        .neq("status", "superseded")
        .gte("created_at", from)
        .lte("created_at", to)
        .order("created_at", { ascending: false });
      const rows = ((data ?? []) as unknown as { created_at: string; rule_id: string; severity: string; status: string; message: string; vehicles: { unit_number: string } | null }[]).map((a) => ({
        created_at: a.created_at,
        unit: a.vehicles?.unit_number ?? "",
        rule: a.rule_id,
        severity: a.severity,
        status: a.status,
        message: a.message,
      }));
      const csv = toCsv(rows, [
        { key: "created_at", header: "Detected At" },
        { key: "unit", header: "Unit" },
        { key: "rule", header: "Rule" },
        { key: "severity", header: "Severity" },
        { key: "status", header: "Status" },
        { key: "message", header: "Detail" },
      ]);
      await writeAudit(admin, { orgId, actorId: req.auth!.userId, action: "export.generated", meta: { report: "anomalies.csv", rows: rows.length } });
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="fuelguard-anomalies.csv"');
      res.send(csv);
    }),
  );

  // summary.pdf
  router.get(
    "/summary.pdf",
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const { from, to } = defaultRange(qstr(req.query.from), qstr(req.query.to));

      const [{ data: txns }, { data: anomalies }, { data: vehicles }, { data: drivers }] = await Promise.all([
        admin.from("fuel_transactions").select("id, gallons, total_cost, computed_mpg, fueled_at, vehicle_id, driver_id").eq("org_id", orgId).gte("fueled_at", from).lte("fueled_at", to),
        admin.from("anomalies").select("id, transaction_id, vehicle_id, severity, status").eq("org_id", orgId),
        admin.from("vehicles").select("id, unit_number").eq("org_id", orgId),
        admin.from("drivers").select("id, full_name").eq("org_id", orgId),
      ]);
      const summary = aggregateDashboard(
        (txns ?? []) as unknown as FuelTransaction[],
        (anomalies ?? []) as unknown as Anomaly[],
        (vehicles ?? []) as { id: string; unit_number: string }[],
        (drivers ?? []) as { id: string; full_name: string }[],
      );

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", 'attachment; filename="fuelguard-summary.pdf"');
      const doc = new PDFDocument({ margin: 50 });
      doc.pipe(res);
      doc.fontSize(20).text("FuelGuard — Fuel Summary", { continued: false });
      doc.moveDown(0.3).fontSize(10).fillColor("#666").text(`Period: ${from.slice(0, 10)} to ${to.slice(0, 10)}`);
      doc.moveDown().fillColor("#000").fontSize(12);
      doc.text(`Total fuel spend:  $${summary.totalSpend.toLocaleString()}`);
      doc.text(`Total gallons:     ${summary.totalGallons.toLocaleString()}`);
      doc.text(`Fleet avg MPG:     ${summary.fleetMpg ?? "—"}`);
      doc.text(`Open anomalies:    ${summary.openAnomalies}`);
      doc.moveDown().fontSize(13).text("Open anomalies by severity");
      doc.fontSize(11).fillColor("#333");
      for (const sev of ["critical", "high", "medium", "low"] as const) {
        doc.text(`  ${sev}: ${summary.anomaliesBySeverity[sev]}`);
      }
      doc.moveDown().fillColor("#000").fontSize(13).text("Top vehicles by risk");
      doc.fontSize(11).fillColor("#333");
      if (summary.topVehiclesByRisk.length === 0) doc.text("  none");
      for (const v of summary.topVehiclesByRisk) {
        doc.text(`  ${v.label}: ${v.anomalyCount} open (${v.criticalCount} critical)`);
      }
      doc.end();

      await writeAudit(admin, { orgId, actorId: req.auth!.userId, action: "export.generated", meta: { report: "summary.pdf" } });
    }),
  );

  return router;
}
