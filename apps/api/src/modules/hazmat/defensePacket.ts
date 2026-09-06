import PDFDocument from "pdfkit";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { placardSvg, PLACARD_ART_VERSION } from "@hazmat/placards";
import type { PlacardName, Verdict } from "@hazmat/engine";
import type { QualFinding } from "@silvicom/shared";
import { INK, MUTED, NAVY } from "../../lib/pdfDraw.js";
import { labelOf, memberLabels } from "../../lib/memberLabels.js";

/**
 * M12.1 — the Roadside Defense Packet. One tap → a SELF-CONTAINED PDF a driver can hand to an
 * inspector (or a safety manager to an auditor) with no login and no app: the verdict, every
 * finding with its CFR citation, the qualification evidence, the BOL photos, the placard
 * SPECIMENS, the attestation, and the full provenance line (engine + dataset + art versions +
 * run id + input hash) that makes the verdict reproducible (M12.2).
 *
 * §11.7 discipline: the placard images are SPECIMENS — instructions about which physical placard
 * to hang — and every one is labelled so. Art is 0.1.0-provisional until M10.
 */

export type ServiceError = { error: string; code: string };
const err = (code: string, error: string): ServiceError => ({ error, code });

interface RunRow {
  id: string; load_id: string; engine_version: string; dataset_version: string;
  verdict: unknown; outcome: string; flags: string[]; advisories: unknown[];
  qualification: { evalDate?: string; usedFallback?: boolean; driver?: QualFinding[]; org?: QualFinding[] } | null;
  models: { promptVersion?: string; normalizerVersion?: string } | null;
  input_hash: string; created_at: string;
}
interface ReviewRow { action: string; attestation: string | null; reviewer_id: string; created_at: string; new_value: string | null }
interface LoadRow {
  id: string; status: string; tank_state: string; carrier_relationship: string;
  planned_pickup_at: string | null; declared_lines: unknown[]; special_permit_numbers: string[] | null;
  created_at: string;
}

export interface PacketData {
  orgName: string;
  load: LoadRow;
  run: RunRow;
  verdict: Verdict | null;
  clearedReview: ReviewRow | null;
  overrideReview: ReviewRow | null;
  reviewerEmail: string | null;
  /** BOL page images, already normalized to PNG for embedding. */
  bolImages: Buffer[];
  generatedAt: string;
}

/** Gather everything the packet renders. Separate from rendering so it is testable without pdfkit. */
export async function gatherPacketData(
  admin: SupabaseClient, orgId: string, loadId: string, runId: string | null,
): Promise<PacketData | ServiceError> {
  const { data: loadRow } = await admin.from("hazmat_loads")
    .select("id, status, tank_state, carrier_relationship, planned_pickup_at, declared_lines, special_permit_numbers, created_at")
    .eq("org_id", orgId).eq("id", loadId).maybeSingle();
  if (!loadRow) return err("not_found", "Load not found.");

  let runQuery = admin.from("hazmat_runs")
    .select("id, load_id, engine_version, dataset_version, verdict, outcome, flags, advisories, qualification, models, input_hash, created_at")
    .eq("org_id", orgId).eq("load_id", loadId);
  runQuery = runId ? runQuery.eq("id", runId) : runQuery.order("created_at", { ascending: false }).limit(1);
  const { data: runRows } = await runQuery;
  const run = ((runRows ?? []) as unknown as RunRow[])[0];
  if (!run) return err("not_found", "No analysis run exists for this load — the packet documents a verdict.");

  const { data: reviews } = await admin.from("hazmat_reviews")
    .select("action, attestation, reviewer_id, created_at, new_value")
    .eq("org_id", orgId).eq("load_id", loadId).order("created_at", { ascending: false });
  const reviewRows = (reviews ?? []) as unknown as ReviewRow[];
  const clearedReview = reviewRows.find((r) => r.action === "cleared") ?? null;
  const overrideReview = reviewRows.find((r) => r.action === "override") ?? null;

  // The reviewer as the packet names them: their name since 0301, else their email (0301's directory,
  // one call; the auth API only if they have since left the org).
  let reviewerEmail: string | null = null;
  if (clearedReview) {
    const labels = await memberLabels(admin, orgId, [clearedReview.reviewer_id]);
    reviewerEmail = labelOf(labels.get(clearedReview.reviewer_id));
  }

  const { data: org } = await admin.from("organizations").select("name").eq("id", orgId).single();

  // BOL photos — embed as PNG (pdfkit accepts png/jpeg; uploads may be webp).
  const { data: docs } = await admin.from("hazmat_documents")
    .select("storage_path, page").eq("org_id", orgId).eq("load_id", loadId).eq("kind", "bol")
    .order("page", { ascending: true });
  const bolImages: Buffer[] = [];
  for (const d of (docs ?? []) as Array<{ storage_path: string }>) {
    const { data: blob } = await admin.storage.from("hazmat").download(d.storage_path);
    if (blob) {
      const raw = Buffer.from(await blob.arrayBuffer());
      try {
        bolImages.push(await sharp(raw).resize({ width: 1000, withoutEnlargement: true }).png().toBuffer());
      } catch {
        // an unreadable image is skipped, not fatal — the packet notes the page count either way
      }
    }
  }

  const verdict = run.verdict && typeof run.verdict === "object" && "placards" in (run.verdict as object)
    ? (run.verdict as Verdict) : null;

  return {
    orgName: (org as { name: string } | null)?.name ?? "—",
    load: loadRow as unknown as LoadRow,
    run, verdict, clearedReview, overrideReview, reviewerEmail, bolImages,
    generatedAt: new Date().toISOString(),
  };
}

const MARGIN = 54;

/** Render the packet to a Buffer. Pure given PacketData (plus placard art from @hazmat/placards). */
export async function renderPacketPdf(data: PacketData): Promise<Buffer> {
  const doc = new PDFDocument({ size: "LETTER", margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN }, info: { Title: `HazmatGuard Roadside Defense Packet — load ${data.load.id}` } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const h1 = (t: string) => doc.moveDown(0.6).fillColor(NAVY).font("Helvetica-Bold").fontSize(13).text(t).moveDown(0.2);
  const body = (t: string, opts: object = {}) => doc.fillColor(INK).font("Helvetica").fontSize(9.5).text(t, opts);
  const muted = (t: string) => doc.fillColor(MUTED).font("Helvetica").fontSize(8.5).text(t);

  // ── header ──
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(19).text("Roadside Defense Packet");
  doc.fillColor(MUTED).font("Helvetica").fontSize(9)
    .text(`${data.orgName} · load ${data.load.id} · generated ${data.generatedAt.slice(0, 19).replace("T", " ")} UTC`)
    .text("Produced by HazmatGuard. Self-contained: every statement below carries its regulatory citation, and the verdict is reproducible from the provenance line on the last page.");

  // ── verdict ──
  h1("Verdict");
  const outcome = data.run.outcome === "green" ? "GREEN — no findings; cleared by analysis" : `FLAGGED — ${data.run.flags.length} finding(s); disposition: ${data.load.status.toUpperCase()}`;
  doc.font("Helvetica-Bold").fontSize(11).fillColor(data.run.outcome === "green" ? "#1a7a3a" : "#a05a00").text(outcome);
  body(`Analyzed ${data.run.created_at.slice(0, 19).replace("T", " ")} UTC · engine ${data.run.engine_version} · dataset ${data.run.dataset_version}`);
  if (data.verdict) body(`Eligibility: ${data.verdict.eligibility.status}`);

  // ── placards (specimens) ──
  if (data.verdict && data.verdict.placards.required.length > 0) {
    h1("Placards required — §172.504");
    muted("SPECIMENS ONLY (49 CFR §172.519 governs physical placards): these images tell the crew WHICH placard to hang; they are not placards. Art " + PLACARD_ART_VERSION + ".");
    doc.moveDown(0.3);
    const startX = doc.x; let x = startX; const y = doc.y; const SIZE = 86;
    for (const req of data.verdict.placards.required) {
      try {
        const png = await sharp(Buffer.from(placardSvg(req.placard as PlacardName))).resize(SIZE, SIZE).png().toBuffer();
        if (x + SIZE > doc.page.width - MARGIN) { x = startX; doc.y = y + SIZE + 24; }
        doc.image(png, x, doc.y, { width: SIZE });
        doc.fillColor(MUTED).fontSize(7.5).text(req.placard, x, doc.y + SIZE + 2, { width: SIZE, align: "center" });
        doc.y -= 12; // text() advanced y; keep the row baseline
        x += SIZE + 18;
      } catch { /* a missing art entry renders as text below */ }
    }
    doc.y += SIZE + 18; doc.x = startX;
    body("Required: " + data.verdict.placards.required.map((r) => `${r.placard} (${r.because.map((c) => c.cfr).join("; ")})`).join(" · "));
    if (data.verdict.placards.idDisplays.length > 0) {
      body("ID displays: " + data.verdict.placards.idDisplays.map((d) => `${d.idNumber} — ${d.format}`).join(" · "));
    }
    if (data.verdict.placards.ergGuides.length > 0) {
      body("ERG guides: " + data.verdict.placards.ergGuides.map((g) => `${g.idNumber} → guide ${g.guide}`).join(" · "));
    }
  } else if (data.verdict) {
    h1("Placards required — §172.504");
    body("None required for this load as analyzed.");
  }

  // ── findings ──
  h1("Findings — every one with its citation");
  if (data.run.flags.length === 0) {
    body("No blocking findings.");
  } else {
    for (const f of data.run.flags) body(`• ${f}`);
  }
  const advisories = (data.run.advisories ?? []) as Array<{ ruleId?: string; message?: string; citations?: Array<{ cfr: string }> }>;
  if (advisories.length > 0) {
    doc.moveDown(0.3);
    muted("Advisories (non-blocking):");
    for (const a of advisories.slice(0, 20)) {
      body(`• ${a.ruleId ?? "advisory"}${a.citations?.length ? ` [${a.citations.map((c) => c.cfr).join("; ")}]` : ""}${a.message ? ` — ${a.message}` : ""}`);
    }
  }

  // ── qualification evidence (M3) ──
  if (data.run.qualification) {
    h1("Driver & carrier qualification — §391 / Part 107 / §172.704");
    const q = data.run.qualification;
    body(`Evaluated at: ${q.evalDate?.slice(0, 10) ?? "—"}${q.usedFallback ? " (analysis time — no planned pickup date on the load)" : " (planned pickup date)"}`);
    const all = [...(q.driver ?? []), ...(q.org ?? [])];
    if (all.length === 0) body("All qualification checks passed at the evaluation date.");
    else for (const f of all) body(`• ${f.code} — ${f.message} [${f.citation}]`);
  }

  // ── attestation ──
  h1("Review & attestation");
  if (data.clearedReview) {
    body(`Cleared ${data.clearedReview.created_at.slice(0, 19).replace("T", " ")} UTC by ${data.reviewerEmail ?? data.clearedReview.reviewer_id}`);
    if (data.clearedReview.attestation) doc.font("Helvetica-Oblique").fontSize(9.5).fillColor(INK).text(`"${data.clearedReview.attestation}"`);
    if (data.overrideReview?.new_value) body(`Override reason on record: "${data.overrideReview.new_value}"`);
    muted("The attestation text is composed by the server from the verified clearing gate — it is never client-supplied.");
  } else if (data.run.outcome === "green") {
    body("Cleared automatically: the analysis produced zero findings (every check green, every provided input evaluated, qualification current). Any finding at all routes a load to a human reviewer.");
  } else {
    body("Not cleared. This packet documents the flagged analysis as it stands.");
  }

  // ── BOL photos ──
  if (data.bolImages.length > 0) {
    for (let i = 0; i < data.bolImages.length; i++) {
      doc.addPage();
      doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(12).text(`Shipping paper — page ${i + 1} of ${data.bolImages.length} (as analyzed)`);
      doc.moveDown(0.4);
      doc.image(data.bolImages[i]!, { fit: [doc.page.width - MARGIN * 2, doc.page.height - doc.y - MARGIN - 20], align: "center" });
    }
  }

  // ── provenance ──
  doc.addPage();
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(12).text("Provenance — reproduce this verdict");
  doc.moveDown(0.3);
  body(`Run id: ${data.run.id}`);
  body(`Input hash: ${data.run.input_hash}`);
  body(`Engine version: ${data.run.engine_version}`);
  body(`Regulatory dataset version: ${data.run.dataset_version}`);
  body(`Placard art version: ${PLACARD_ART_VERSION}`);
  if (data.run.models?.promptVersion) body(`Extraction prompt version: ${data.run.models.promptVersion} · normalizer ${data.run.models.normalizerVersion ?? "—"}`);
  doc.moveDown(0.4);
  muted("The verdict above is a deterministic function of the load, the engine version, and the dataset version. HazmatGuard can re-run this exact analysis under the dataset that was current on the analysis date and reproduce the verdict — and can show what a newer dataset release would change. Run records are append-only and immutable (database-enforced).");

  doc.end();
  return done;
}
