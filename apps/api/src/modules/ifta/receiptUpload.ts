import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import {
  disagreeingTotals, parseDriverFuelFile, tokenizeCsv,
  type DriverFuelRow, type IftaReceiptUploadResponse, type IftaReceiptUploadRow, type IftaTruckBasis,
  type IftaTruckQuestion, type ParsedDriverFuelFile,
} from "@silvicom/shared";
import { matchTractorUnits } from "./receiptReads.js";
import { readLiveFingerprints, recordUpload } from "./uploadedReceipts.js";

/**
 * A driver-paid fuel file, previewed or landed (IFTA-PRECISION-PLAN IP8, D-IP7).
 *
 * ── HOW EACH ROW GETS ITS TRUCK ──────────────────────────────────────────────────────────────────
 * IFTA is filed per truck and per state, so a receipt with no truck cannot be counted. In order:
 *  1. The file names the unit (McLeod's export always does): matched like a McLeod receipt —
 *     `mcleod_tractor_id`, then `unit_number`, retired trucks included.
 *  2. The file names only the driver (the fuel app: all 40 rows of 2026-10-07): the driver is found by
 *     name or one of their other names, and the truck is the one Samsara had them assigned to ON THE
 *     DAY of the fill. Esteban Machado → unit 512, assigned without a break 05/06 → 10/07.
 *  3. Anything else — an unknown unit, a driver matched to nobody or to two people, a day with no
 *     assignment or with two trucks — becomes ONE question per unit or driver, answered on the
 *     preview. The evidence's best guess is offered as a suggestion and never applied by itself:
 *     guessing the truck moves fuel between trucks' MPG and between states' credit.
 * A commit with an open question is refused, so every landed receipt has a truck and says how.
 */

export class ReceiptUploadError extends Error {
  constructor(readonly status: 400 | 422, message: string) {
    super(message);
  }
}

/** The grid of a .csv or .xlsx — the first worksheet the parser recognises, for a workbook. */
async function fileGrid(fileName: string, buf: Buffer): Promise<string[][][]> {
  const name = fileName.toLowerCase();
  if (name.endsWith(".csv")) return [tokenizeCsv(buf.toString("utf8").replace(/^\uFEFF/, ""))];
  if (!name.endsWith(".xlsx")) throw new ReceiptUploadError(400, "Upload a .csv or .xlsx file.");
  if (!(buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b)) {
    throw new ReceiptUploadError(400, "This is not a valid .xlsx file. Save it from Excel as .xlsx or .csv and try again.");
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb.worksheets.map((ws) => {
    const grid: string[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const cells: string[] = [];
      for (let c = 1; c <= ws.columnCount; c++) cells.push(cellText(row.getCell(c).value));
      grid[n - 1] = cells;
    });
    return Array.from(grid, (r) => r ?? []);
  });
}

/** An Excel cell as text. A date cell becomes its ISO string, which `fileDayAndTime` reads as the day. */
function cellText(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v !== "object") return String(v);
  const o = v as { richText?: Array<{ text?: string }>; result?: unknown; text?: unknown };
  if (Array.isArray(o.richText)) return o.richText.map((t) => t.text ?? "").join("");
  if (o.result != null) return cellText(o.result);
  if (o.text != null) return String(o.text);
  return "";
}

const personKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

interface Resolution {
  vehicleId: string | null;
  basis: IftaTruckBasis | null;
  key: string | null;
}

/** Drivers by any of their names → id and Samsara id, for the names this file uses. */
async function matchDrivers(admin: SupabaseClient, orgId: string, names: string[]) {
  const wanted = new Set(names.map(personKey));
  const found = new Map<string, Array<{ id: string; samsaraId: string | null }>>();
  if (wanted.size === 0) return found;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("drivers")
      .select("id, full_name, other_names, samsara_driver_id")
      .eq("org_id", orgId)
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(`drivers read failed: ${error.message}`);
    const page = (data ?? []) as Array<{ id: string; full_name: string | null; other_names: string[] | null; samsara_driver_id: string | null }>;
    for (const d of page) {
      for (const n of new Set([d.full_name ?? "", ...(d.other_names ?? [])].map(personKey))) {
        if (!wanted.has(n)) continue;
        found.set(n, [...(found.get(n) ?? []), { id: d.id, samsaraId: d.samsara_driver_id }]);
      }
    }
    if (page.length < 1000) break;
  }
  return found;
}

/**
 * The trucks a Samsara driver was assigned to on each day asked about. A station-local day runs from
 * 04:00 UTC (Atlantic) to 11:00 UTC the next day (Hawaii), so an assignment overlapping that window
 * is one that could have covered the fill; two different trucks in it is a question, not a guess.
 */
async function assignedTrucks(admin: SupabaseClient, orgId: string, samsaraDriverId: string, days: string[]) {
  const sorted = [...days].sort();
  const first = `${sorted[0]}T04:00:00Z`;
  const lastEnd = new Date(Date.parse(`${sorted[sorted.length - 1]}T11:00:00Z`) + 86_400_000).toISOString();
  const { data, error } = await admin
    .from("driver_vehicle_assignments")
    .select("vehicle_samsara_id, start_at, end_at")
    .eq("org_id", orgId)
    .eq("driver_samsara_id", samsaraDriverId)
    .lte("start_at", lastEnd)
    .or(`end_at.is.null,end_at.gte.${first}`)
    .order("start_at")
    .limit(5000);
  if (error) throw new Error(`driver_vehicle_assignments read failed: ${error.message}`);
  const spans = (data ?? []) as Array<{ vehicle_samsara_id: string; start_at: string; end_at: string | null }>;
  const samsaraIds = [...new Set(spans.map((s) => s.vehicle_samsara_id))];
  const vehicleOf = new Map<string, string>();
  if (samsaraIds.length) {
    const { data: vs, error: vErr } = await admin
      .from("vehicles").select("id, samsara_vehicle_id").eq("org_id", orgId).in("samsara_vehicle_id", samsaraIds);
    if (vErr) throw new Error(`vehicles read failed: ${vErr.message}`);
    for (const v of (vs ?? []) as Array<{ id: string; samsara_vehicle_id: string }>) vehicleOf.set(v.samsara_vehicle_id, v.id);
  }
  const byDay = new Map<string, Set<string>>();
  for (const day of days) {
    const lo = Date.parse(`${day}T04:00:00Z`);
    const hi = lo + 31 * 3_600_000;
    const trucks = new Set<string>();
    for (const s of spans) {
      const start = Date.parse(s.start_at);
      const end = s.end_at ? Date.parse(s.end_at) : Infinity;
      const v = vehicleOf.get(s.vehicle_samsara_id);
      if (v && start < hi && end > lo) trucks.add(v);
    }
    byDay.set(day, trucks);
  }
  return byDay;
}

/** Decides each row's truck, and asks once per unit or driver it cannot decide. */
async function resolveTrucks(
  admin: SupabaseClient,
  orgId: string,
  rows: DriverFuelRow[],
  choices: Record<string, string>,
): Promise<{ resolutions: Resolution[]; questions: IftaTruckQuestion[] }> {
  const units = [...new Set(rows.flatMap((r) => (r.unitAsFiled ? [r.unitAsFiled] : [])))];
  const unitVehicle = units.length ? await matchTractorUnits(admin, orgId, units) : new Map<string, string>();
  const drivers = await matchDrivers(admin, orgId, rows.flatMap((r) => (!r.unitAsFiled && r.driverAsFiled ? [r.driverAsFiled] : [])));

  const daysByDriver = new Map<string, string[]>();
  for (const r of rows) {
    if (r.unitAsFiled || !r.driverAsFiled) continue;
    const k = personKey(r.driverAsFiled);
    daysByDriver.set(k, [...(daysByDriver.get(k) ?? []), r.fueledOn]);
  }
  const trucksByDriver = new Map<string, Map<string, Set<string>>>();
  for (const [k, days] of daysByDriver) {
    const match = drivers.get(k) ?? [];
    if (match.length === 1 && match[0]!.samsaraId) {
      trucksByDriver.set(k, await assignedTrucks(admin, orgId, match[0]!.samsaraId, days));
    }
  }

  const asks = new Map<string, { label: string; rows: number; why: string; seen: Map<string, number> }>();
  const ask = (key: string, label: string, why: string, hint: Set<string> | null) => {
    const a = asks.get(key) ?? { label, rows: 0, why, seen: new Map<string, number>() };
    a.rows += 1;
    for (const v of hint ?? []) a.seen.set(v, (a.seen.get(v) ?? 0) + 1);
    asks.set(key, a);
    return key;
  };

  const resolutions = rows.map((r): Resolution => {
    if (r.unitAsFiled) {
      const v = unitVehicle.get(r.unitAsFiled);
      if (v) return { vehicleId: v, basis: "unit_in_file", key: null };
      const key = ask(`unit:${r.unitAsFiled}`, `unit ${r.unitAsFiled}`, "No truck here has this unit number.", null);
      return { vehicleId: null, basis: null, key };
    }
    if (!r.driverAsFiled) {
      const key = ask("file:no-truck", "rows with no truck or driver", "The file names neither a truck nor a driver.", null);
      return { vehicleId: null, basis: null, key };
    }
    const k = personKey(r.driverAsFiled);
    const match = drivers.get(k) ?? [];
    const key = `driver:${k}`;
    if (match.length !== 1) {
      ask(key, r.driverAsFiled, match.length === 0 ? "No driver here has this name." : "More than one driver has this name.", null);
      return { vehicleId: null, basis: null, key };
    }
    const trucks = trucksByDriver.get(k)?.get(r.fueledOn) ?? new Set<string>();
    if (trucks.size === 1) return { vehicleId: [...trucks][0]!, basis: "driver_assignment", key: null };
    ask(
      key,
      r.driverAsFiled,
      trucks.size === 0 ? "Samsara has no truck assigned to this driver on some of these days." : "Samsara had this driver in two trucks on some of these days.",
      trucks,
    );
    return { vehicleId: null, basis: null, key };
  });

  // A choice applies to the rows its question covers, and nothing else.
  for (const res of resolutions) {
    if (res.vehicleId || !res.key) continue;
    const chosen = choices[res.key];
    if (chosen) Object.assign(res, { vehicleId: chosen, basis: "chosen_at_upload" as const });
  }

  // Suggestion: the truck the same driver's decided rows used most, else the one the ambiguous days saw most.
  const decidedBy = new Map<string, Map<string, number>>();
  rows.forEach((r, i) => {
    const res = resolutions[i]!;
    if (res.basis !== "driver_assignment" || !r.driverAsFiled) return;
    const m = decidedBy.get(`driver:${personKey(r.driverAsFiled)}`) ?? new Map<string, number>();
    m.set(res.vehicleId!, (m.get(res.vehicleId!) ?? 0) + 1);
    decidedBy.set(`driver:${personKey(r.driverAsFiled)}`, m);
  });
  const top = (m: Map<string, number> | undefined) =>
    m && m.size ? [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0] : null;
  const open = new Set(resolutions.filter((r) => !r.vehicleId && r.key).map((r) => r.key!));
  const questions = [...asks.entries()]
    .filter(([key]) => open.has(key))
    .map(([key, a]) => {
      const v = top(decidedBy.get(key)) ?? top(a.seen);
      return { key, label: a.label, rows: a.rows, why: a.why, suggestion: v ? { vehicleId: v, unitNumber: null } : null };
    });
  return { resolutions, questions };
}

/** Unit numbers for the trucks a preview names. */
async function unitNumbers(admin: SupabaseClient, orgId: string, ids: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await admin.from("vehicles").select("id, unit_number").eq("org_id", orgId).in("id", ids.slice(i, i + 200));
    if (error) throw new Error(`vehicles read failed: ${error.message}`);
    for (const v of (data ?? []) as Array<{ id: string; unit_number: string | null }>) out.set(v.id, v.unit_number?.trim() || null);
  }
  return out;
}

export interface ReceiptUploadInput {
  fileName: string;
  contentBase64: string;
  commit: boolean;
  truckChoices: Record<string, string>;
  actorId: string | null;
}

/** Parse → resolve trucks → mark what is already live → preview, or land it. */
export async function runReceiptUpload(admin: SupabaseClient, orgId: string, input: ReceiptUploadInput): Promise<IftaReceiptUploadResponse> {
  const buf = Buffer.from(input.contentBase64, "base64");
  if (buf.length === 0) throw new ReceiptUploadError(400, "The file is empty.");
  const fileSha256 = createHash("sha256").update(buf).digest("hex");

  let parsed: ParsedDriverFuelFile | null = null;
  let reason = "This file has no rows we can read.";
  for (const grid of await fileGrid(input.fileName, buf)) {
    const r = parseDriverFuelFile(grid);
    if (r.ok) { parsed = r; break; }
    reason = r.reason;
  }
  if (!parsed) throw new ReceiptUploadError(422, reason);

  // A choice must name one of this org's trucks — the id travels from the browser.
  const chosen = [...new Set(Object.values(input.truckChoices))];
  const chosenUnits = await unitNumbers(admin, orgId, chosen);
  const foreign = chosen.filter((id) => !chosenUnits.has(id));
  if (foreign.length) throw new ReceiptUploadError(400, "A chosen truck is not one of this organization's trucks.");

  const { resolutions, questions } = await resolveTrucks(admin, orgId, parsed.rows, input.truckChoices);
  const live = await readLiveFingerprints(admin, orgId, parsed.rows.map((r) => r.fingerprint));
  const named = [...new Set([
    ...resolutions.flatMap((r) => (r.vehicleId ? [r.vehicleId] : [])),
    ...questions.flatMap((q) => (q.suggestion ? [q.suggestion.vehicleId] : [])),
  ])];
  const units = await unitNumbers(admin, orgId, named);

  const rows: IftaReceiptUploadRow[] = parsed.rows.map((r, i) => {
    const res = resolutions[i]!;
    return {
      line: r.line,
      status: live.has(r.fingerprint) ? "already_present" : res.vehicleId ? "new" : "needs_truck",
      jurisdiction: r.jurisdiction,
      fueledOn: r.fueledOn,
      gallons: r.gallons,
      station: r.station ?? r.city,
      unitAsFiled: r.unitAsFiled,
      driverAsFiled: r.driverAsFiled,
      vehicleId: res.vehicleId,
      unitNumber: res.vehicleId ? (units.get(res.vehicleId) ?? null) : null,
      truckBasis: res.basis,
      truckKey: res.vehicleId ? null : res.key,
    };
  });
  const disagree = new Set(disagreeingTotals(parsed));
  const response: IftaReceiptUploadResponse = {
    format: parsed.format,
    fileName: input.fileName,
    fileSha256,
    rows,
    refused: parsed.refused,
    voidedInSource: parsed.voidedInSource,
    statedTotals: parsed.statedTotals.map((t) => ({ ...t, agrees: !disagree.has(t) })),
    truckQuestions: questions.map((q) => ({
      ...q,
      suggestion: q.suggestion ? { ...q.suggestion, unitNumber: units.get(q.suggestion.vehicleId) ?? null } : null,
    })),
    committed: null,
  };
  if (!input.commit) return response;

  const waiting = rows.filter((r) => r.status === "needs_truck");
  if (waiting.length) {
    throw new ReceiptUploadError(422, `Choose a truck for ${waiting.length} row${waiting.length === 1 ? "" : "s"} before importing.`);
  }
  const toLand = parsed.rows.flatMap((row, i) =>
    rows[i]!.status === "new" ? [{ row, vehicleId: resolutions[i]!.vehicleId!, truckBasis: resolutions[i]!.basis! }] : [],
  );
  const alreadyPresent = rows.filter((r) => r.status === "already_present").length;
  const uploadId = await recordUpload(admin, orgId, {
    fileName: input.fileName,
    fileSha256,
    format: parsed.format,
    rowsInFile: parsed.rows.length + parsed.refused.length + parsed.voidedInSource,
    rowsAlreadyPresent: alreadyPresent,
    rowsRefused: parsed.refused.length,
    uploadedBy: input.actorId,
    receipts: toLand,
  });
  return { ...response, committed: { uploadId, imported: toLand.length, alreadyPresent } };
}
