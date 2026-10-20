/**
 * `pnpm --filter @silvicom/api mcleod:import-unit-papers -- --manifest <dir>/manifest.json --org <uuid>
 *   [--plan-out <file.csv>] [--limit <n>] [--apply]` — file the registration and annual-inspection papers
 * the office attached to trucks and trailers in McLeod onto the same units here (owner, 2026-10-20:
 * "pull all existing papers from Sandbox for all trucks and trailers… Registrations and Annuals for now").
 *
 * ── WHERE THE PAPERS ARE ───────────────────────────────────────────────────────────────────────────
 * McLeod keeps a unit's scans as attachments on its Comments tab: `comments.attachment`, with
 * `parent_row_type` T (tractor) or E (trailer) and `parent_row_id` the unit's McLeod id — measured on the
 * sandbox 2026-10-20, 1,691 truck and 877 trailer files. The live login is refused on that table; the
 * sandbox (a restore) can read it, so the manifest this script reads is exported from there by a
 * read-only SELECT, one file per comment, with its sha256. Papers added in McLeod after the restore are
 * not in it — a second run against a newer export files only what is new.
 *
 * ── WHOSE PAPER: THE ID McLEOD ATTACHED IT TO, NEVER A GUESS ───────────────────────────────────────
 * A person in McLeod attached each paper to a unit. That unit's McLeod id is on our row
 * (`vehicles.mcleod_tractor_id`, `trailers.mcleod_trailer_id`, written by the roster sync), so the
 * subject is a lookup, not a match. A paper whose unit we do not hold is skipped and listed.
 *
 * One check against the person: a file whose NAME starts with a different unit number than the unit it
 * hangs on is held, not filed (`filenameNamesOtherUnit`). Measured on the 2026-10-09 export, 4 of 1,315:
 * "688.pdf" on truck 687 is truck 688's 2027 cab card (VIN …9439; 687's is …9438) — attached to the wrong
 * truck in McLeod, and filing it would put another truck's registration in 687's file. The other three are
 * harmless ("513.pdf" on 754, the same VIN renumbered; "689-690 ADDITION"; "7006-26" for 700 6-26), and
 * a person files them in a minute. A hold costs a minute; a paper on the wrong truck costs a roadside stop. This is why it does not go through UF7's review queue: that queue
 * exists for papers whose subject is PROPOSED (D-UF8); here a person already chose it.
 *
 * ── WHAT IT IS: REGISTRATION OR ANNUAL, FROM WHAT THE OFFICE WROTE, ELSE SKIPPED ───────────────────
 * `classifyMcleodPaper` reads the file name and the comment text ("IRP 2027", "ANNUAL", "TEMP"). A paper
 * that says both, or neither, is skipped and listed for a person — a wrong kind is worse than a missing
 * paper. Our own annual-inspection report, which the office re-attaches in McLeod
 * (`annual-inspection-<unit>-<date>.pdf`), is already filed here and is skipped.
 *
 * ── WHAT IT DOES NOT DO ────────────────────────────────────────────────────────────────────────────
 * It files the paper (`documents`, an original, its derivatives queued). It writes NO certification: an
 * expiry date is a claim about the paper's contents, and Q-UF2 rules no date is seeded from McLeod. The
 * unit's Registration item therefore still reads "Date only" until its date is recorded against the
 * paper — now one click on a paper that is on file, rather than a hunt for it.
 *
 * ── SAFE TO RE-RUN, AND TRACEABLE ──────────────────────────────────────────────────────────────────
 * - DRY RUN BY DEFAULT: it prints the plan and writes `--plan-out`, one row per paper with its action.
 * - Each document's id is a name-based uuid of the McLeod comment (`paperDocumentId`), so a re-run
 *   lands on the same row (`fileGeneratedDocument` returns `filed: false`) — never a second copy.
 * - The same bytes already on the same unit (filed by hand, or twice in McLeod) are skipped.
 * - The bytes are hashed again before filing and must equal the manifest's sha256.
 * - Every filed paper writes `compliance.document_imported` to the audit log with its McLeod comment id,
 *   unit id, file name and the sandbox restore it came from. `documents` has no provenance column; the
 *   audit row is the record of where a paper came from.
 *
 * One organization per run: the service role bypasses RLS, so every query carries the org itself.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isRecordId, type DocumentContentType, type DocumentKind } from "@silvicom/shared";
import { loadEnv } from "../env.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { writeAudit } from "../lib/audit.js";
import { dispatchJob } from "../queue/dispatch.js";
import { registerAllHandlers } from "../queue/handlers/index.js";
import { fileGeneratedDocument } from "../modules/evidence/index.js";

// ── the manifest the read-only export writes ─────────────────────────────────────────────────────────

export interface ManifestPaper {
  commentId: string;
  companyId: string;
  /** McLeod's parent_row_type: T = tractor, E = trailer. */
  parentType: string;
  mcleodUnitId: string;
  enteredAt: string | null;
  enteredBy: string | null;
  filename: string | null;
  commentType: string | null;
  text: string;
  bytes: number;
  sha256: string;
}

export interface Manifest {
  source: string;
  restoredAt: string | null;
  papers: ManifestPaper[];
}

// ── what a paper is ──────────────────────────────────────────────────────────────────────────────────

export type PaperClass =
  | { kind: Extract<DocumentKind, "registration" | "irp" | "annual_inspection"> }
  | { skip: "ours" | "both" | "neither" | "cancelled" };

/** Our own annual-inspection report's file name (`maintenance/inspections/reportDelivery.ts`). */
const OUR_ANNUAL_REPORT = /^annual-inspection-.+-\d{4}-\d{2}-\d{2}\.pdf$/i;

/**
 * Registration or annual inspection, from the file name and the office's comment — or skipped.
 *
 * "Annual" needs the word ANNUAL (or the FHWA periodic form): a bare "INSPECTION" is just as often a
 * roadside inspection report, which is not this item. A registration says IRP, REGISTRATION, REG, CAB
 * CARD or PLATE; "TEMP" counts only on a truck, where it is the temporary IRP permit the office files
 * while the cab card is in the mail ("812 TEMP.pdf", "TEMP IRP 2027"). On a trailer TEMP is as likely the
 * reefer's temperature record, so there it does not count on its own — and on a truck only as a short
 * label ("TEMP", "VP TEMP"): a long note that mentions TEMP is a repair note about a sensor (measured on
 * the 2026-10-09 export: "…NEED TO REPLACE DOC OUTLET TEMP SE…").
 *
 * A plate CANCELLED or REVOKED is the opposite of a registration ("PLATE CANCELED", "PLATES REVOKED",
 * 9 on that export): skipped, never filed as the unit's registration.
 */
export function classifyMcleodPaper(p: Pick<ManifestPaper, "filename" | "text" | "parentType">): PaperClass {
  if (p.filename && OUR_ANNUAL_REPORT.test(p.filename.trim())) return { skip: "ours" };
  const said = `${p.filename ?? ""} ${p.text ?? ""}`.toUpperCase();
  const label = (p.text ?? "").trim().toUpperCase();
  if (/\bCANCEL|\bREVOK/.test(said)) return { skip: "cancelled" };
  const shortTemp = p.parentType === "T" && /\bTEMP\b/.test(label) && label.split(/\s+/).length <= 4;
  // ANNUALS and REGISTARATION are the office's own spellings, measured on the 2026-10-09 export.
  const annual = /\bANNUALS?\b|\bFHWA\b|\bPERIODIC\b/.test(said);
  const irp = /\bIRP\b|\bCAB ?CARD\b|\bAPPORTION/.test(said) || shortTemp;
  const registration = irp || /\bREGIS|\bREG\b|\bPLATES?\b/.test(said);
  if (annual && registration) return { skip: "both" };
  if (annual) return { kind: "annual_inspection" };
  if (registration) return { kind: irp ? "irp" : "registration" };
  return { skip: "neither" };
}

/** What the bytes are, read from their first bytes — never from the file name McLeod kept. */
export function sniffContentType(bytes: Uint8Array): DocumentContentType | null {
  const b = bytes;
  if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  return null;
}

// ── a stable id per McLeod comment ───────────────────────────────────────────────────────────────────

/** RFC 4122 name-based (v5, SHA-1) uuid. */
export function uuidV5(name: string, namespace: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const hash = createHash("sha1").update(Buffer.concat([ns, Buffer.from(name, "utf8")])).digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const h = hash.subarray(0, 16).toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** This import's namespace. Fixed forever: changing it would re-file every paper under new ids. */
const MCLEOD_PAPER_NAMESPACE = "6f1d2c4e-8a3b-4c5d-9e7f-0a1b2c3d4e5f";

export const paperDocumentId = (orgId: string, p: Pick<ManifestPaper, "companyId" | "commentId">): string =>
  uuidV5(`mcleod-comment:${orgId}:${p.companyId}:${p.commentId}`, MCLEOD_PAPER_NAMESPACE);

// ── the plan ─────────────────────────────────────────────────────────────────────────────────────────

export interface OurUnit {
  subjectType: "tractor" | "trailer";
  id: string;
  unitNumber: string;
  mcleodId: string;
}

export interface ExistingOriginal {
  id: string;
  subjectType: string;
  subjectId: string;
  sha256: string;
}

/** The unit number a file name starts with, if any: "805.pdf", "R537390 REG.pdf", "0654-irp.pdf". */
const leadingUnit = (filename: string | null): string | null => {
  const m = /^\s*R?0*(\d{3,7})(?!\d)/i.exec(filename ?? "");
  return m ? m[1]! : null;
};
const foldUnit = (u: string): string => u.trim().toUpperCase().replace(/^R/, "").replace(/^0+(?=\d)/, "");

/** True when the file's name says it is ANOTHER unit's paper. A name with no leading number says nothing. */
export function filenameNamesOtherUnit(filename: string | null, unitNumber: string): boolean {
  const named = leadingUnit(filename);
  return named !== null && named !== foldUnit(unitNumber);
}

export type PlanAction =
  | { action: "file"; documentId: string; unit: OurUnit; kind: DocumentKind }
  | { action: "already_imported"; documentId: string; unit: OurUnit }
  | { action: "skip"; reason: "ours" | "both" | "neither" | "cancelled" | "no_unit" | "name_says_other_unit" | "same_paper_on_unit" | "duplicate_in_mcleod" | "unknown_parent"; unit: OurUnit | null };

export interface PlannedPaper {
  paper: ManifestPaper;
  plan: PlanAction;
}

/**
 * Every paper's fate, decided before anything is written. Pure: the units, the papers already filed and
 * the manifest in, one action per paper out — the dry run prints exactly this, and `--apply` performs it.
 */
export function planImport(
  orgId: string,
  papers: readonly ManifestPaper[],
  units: readonly OurUnit[],
  existing: readonly ExistingOriginal[],
): PlannedPaper[] {
  const byMcleod = new Map(units.map((u) => [`${u.subjectType}:${u.mcleodId.trim().toUpperCase()}`, u]));
  const existingIds = new Set(existing.map((e) => e.id));
  const onUnit = new Set(existing.map((e) => `${e.subjectType}:${e.subjectId}:${e.sha256}`));
  const seen = new Set<string>();
  return papers.map((paper) => {
    const subjectType = paper.parentType === "T" ? "tractor" : paper.parentType === "E" ? "trailer" : null;
    if (!subjectType) return { paper, plan: { action: "skip", reason: "unknown_parent", unit: null } };
    const unit = byMcleod.get(`${subjectType}:${paper.mcleodUnitId.trim().toUpperCase()}`) ?? null;
    const cls = classifyMcleodPaper(paper);
    if ("skip" in cls) return { paper, plan: { action: "skip", reason: cls.skip, unit } };
    if (!unit) return { paper, plan: { action: "skip", reason: "no_unit", unit: null } };
    if (filenameNamesOtherUnit(paper.filename, unit.unitNumber)) return { paper, plan: { action: "skip", reason: "name_says_other_unit", unit } };
    const documentId = paperDocumentId(orgId, paper);
    if (existingIds.has(documentId)) return { paper, plan: { action: "already_imported", documentId, unit } };
    const key = `${unit.subjectType}:${unit.id}:${paper.sha256}`;
    if (onUnit.has(key)) return { paper, plan: { action: "skip", reason: "same_paper_on_unit", unit } };
    if (seen.has(key)) return { paper, plan: { action: "skip", reason: "duplicate_in_mcleod", unit } };
    seen.add(key);
    return { paper, plan: { action: "file", documentId, unit, kind: cls.kind } };
  });
}

const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function planCsv(rows: readonly PlannedPaper[]): string {
  const head = ["action", "reason_or_kind", "unit_type", "unit_number", "mcleod_unit_id", "entered", "filename", "comment", "kb", "document_id", "mcleod_comment_id"];
  const lines = rows.map(({ paper, plan }) =>
    [
      plan.action,
      plan.action === "file" ? plan.kind : plan.action === "skip" ? plan.reason : "",
      plan.unit?.subjectType ?? (paper.parentType === "T" ? "tractor" : "trailer"),
      plan.unit?.unitNumber ?? "",
      paper.mcleodUnitId,
      paper.enteredAt?.slice(0, 10) ?? "",
      paper.filename ?? "",
      paper.text.slice(0, 120),
      Math.round(paper.bytes / 1024),
      plan.action === "skip" ? "" : plan.documentId,
      paper.commentId,
    ].map(csvCell).join(","),
  );
  return [head.join(","), ...lines].join("\n") + "\n";
}

// ── I/O ──────────────────────────────────────────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const PAGE = 1000; // PostgREST's response cap — every read below pages past it.
async function readAll<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

export async function readOurUnits(admin: SupabaseAdmin, orgId: string): Promise<OurUnit[]> {
  const trucks = await readAll<{ id: string; unit_number: string; mcleod_tractor_id: string | null }>((from, to) =>
    admin.from("vehicles").select("id, unit_number, mcleod_tractor_id").eq("org_id", orgId).not("mcleod_tractor_id", "is", null).order("id").range(from, to));
  const trailers = await readAll<{ id: string; unit_number: string; mcleod_trailer_id: string | null }>((from, to) =>
    admin.from("trailers").select("id, unit_number, mcleod_trailer_id").eq("org_id", orgId).not("mcleod_trailer_id", "is", null).order("id").range(from, to));
  return [
    ...trucks.map((t) => ({ subjectType: "tractor" as const, id: t.id, unitNumber: t.unit_number, mcleodId: t.mcleod_tractor_id! })),
    ...trailers.map((t) => ({ subjectType: "trailer" as const, id: t.id, unitNumber: t.unit_number, mcleodId: t.mcleod_trailer_id! })),
  ];
}

export async function readExistingOriginals(admin: SupabaseAdmin, orgId: string): Promise<ExistingOriginal[]> {
  const rows = await readAll<{ id: string; subject_type: string; subject_id: string; sha256: string }>((from, to) =>
    admin.from("documents").select("id, subject_type, subject_id, sha256").eq("org_id", orgId).eq("variant", "original")
      .in("subject_type", ["tractor", "trailer"]).order("id").range(from, to));
  return rows.map((r) => ({ id: r.id, subjectType: r.subject_type, subjectId: r.subject_id, sha256: r.sha256 }));
}

/** File one planned paper: verify the bytes, file the original, record where it came from, queue its thumb. */
export async function fileOne(
  admin: SupabaseAdmin,
  env: ReturnType<typeof loadEnv>,
  orgId: string,
  manifest: Pick<Manifest, "source" | "restoredAt">,
  paper: ManifestPaper,
  plan: Extract<PlanAction, { action: "file" }>,
  bytes: Buffer,
): Promise<"filed" | "replayed" | string> {
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== paper.sha256) return "bytes do not match the manifest";
  const contentType = sniffContentType(bytes);
  if (!contentType) return "not a PDF, JPEG or PNG";
  const filed = await fileGeneratedDocument(admin, orgId, {
    id: plan.documentId,
    subjectType: plan.unit.subjectType,
    subjectId: plan.unit.id,
    kind: plan.kind,
    uploadedBy: null,
    capturedAt: paper.enteredAt,
    contentType,
  }, bytes);
  if ("error" in filed) return `${filed.code}: ${filed.error}`;
  if (!filed.filed) return "replayed";
  await writeAudit(admin, {
    orgId,
    actorId: null,
    action: "compliance.document_imported",
    entity: "document",
    entityId: plan.documentId,
    meta: {
      source: "mcleod_comments",
      database: manifest.source,
      restoredAt: manifest.restoredAt,
      mcleodCommentId: paper.commentId,
      mcleodUnitId: paper.mcleodUnitId,
      subjectType: plan.unit.subjectType,
      unitNumber: plan.unit.unitNumber,
      kind: plan.kind,
      filename: paper.filename,
      comment: paper.text.slice(0, 200),
      enteredInMcleod: paper.enteredAt,
    },
  });
  await dispatchJob(admin, env, "document_derive", {
    orgId,
    payload: { documentId: plan.documentId },
    dedupKey: `document_derive:${plan.documentId}`,
  });
  return "filed";
}

async function main(): Promise<void> {
  const manifestPath = arg("manifest");
  const org = arg("org");
  if (!manifestPath) throw new Error("--manifest <manifest.json> is required");
  if (!org || !isRecordId(org)) throw new Error("--org <organization uuid> is required");
  const apply = process.argv.includes("--apply");
  const limitArg = arg("limit");
  const limit = limitArg === undefined ? Infinity : Number(limitArg);
  if (!(limit > 0) || (limit !== Infinity && !Number.isInteger(limit))) throw new Error("--limit must be a positive whole number");

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  const filesDir = path.join(path.dirname(manifestPath), "files");
  const env = loadEnv();
  const admin = getSupabaseAdmin(env);

  const units = await readOurUnits(admin, org);
  if (units.length === 0) throw new Error("this organization has no unit carrying a McLeod id — wrong --org, or the roster sync has not run");
  const existing = await readExistingOriginals(admin, org);
  const planned = planImport(org, manifest.papers, units, existing);

  const tally = new Map<string, number>();
  for (const { plan } of planned) {
    const k = plan.action === "file" ? `file ${plan.unit.subjectType} ${plan.kind}` : plan.action === "skip" ? `skip ${plan.reason}` : plan.action;
    tally.set(k, (tally.get(k) ?? 0) + 1);
  }
  process.stderr.write(`${manifest.source} restored ${manifest.restoredAt}: ${manifest.papers.length} papers, ${units.length} linked units, ${existing.length} unit papers already filed\n`);
  for (const [k, n] of [...tally].sort()) process.stderr.write(`  ${k}: ${n}\n`);
  const planOut = arg("plan-out");
  if (planOut) writeFileSync(planOut, planCsv(planned));

  const toFile = planned.filter((p): p is PlannedPaper & { plan: Extract<PlanAction, { action: "file" }> } => p.plan.action === "file").slice(0, limit);
  const results = new Map<string, number>();
  if (apply) {
    // In-process derive (no JOB_EXECUTION_MODE=queue) needs the handler registered here — see
    // backfillDocumentDerivatives.ts.
    registerAllHandlers();
    for (const { paper, plan } of toFile) {
      const bytes = readFileSync(path.join(filesDir, `${paper.commentId}.bin`));
      const r = await fileOne(admin, env, org, manifest, paper, plan, bytes);
      results.set(r, (results.get(r) ?? 0) + 1);
      if (r !== "filed" && r !== "replayed") process.stderr.write(`  ! ${paper.commentId} (${plan.unit.unitNumber}): ${r}\n`);
    }
  }
  process.stdout.write(JSON.stringify({ org, apply, planned: toFile.length, results: Object.fromEntries(results) }) + "\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    process.stderr.write(`mcleod:import-unit-papers failed: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
