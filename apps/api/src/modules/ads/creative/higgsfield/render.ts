import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AD_FORMATS, AD_OVERLAY_LAYOUTS, canonicalJson, pictureKeyPart, renderGate, ticksAsDollars, usdTicks, type AdAssetRef, type AdClipRef, type AdFormat, type AdOverlayLayout } from "@silvicom/shared";
import { settingsInForce } from "../../settings/settingsVersions.js";
import { completeGeneration, generationByKey, higgsfieldTicksThisMonth, insertGeneration, type GenerationRow } from "../../generations/generationLedger.js";
import { AD_ASSETS_BUCKET, assetKey, prepareAsset, readAdAsset } from "../brandAssets.js";
import { clipKey, prepareClip } from "../motion/motionClip.js";
import { frameStill } from "../overlay/overlay.js";
import type { HiggsfieldClient, HfRequestState } from "./higgsfieldClient.js";
import { HIGGSFIELD_IMAGE_INPUT } from "./prices.js";
import { clipImageField } from "./videoModels.js";

/**
 * One render, moved one step (ADS-AGENT-BUILD-WORKFLOW C3; plan D-AD13). Run by the `ads_render` job
 * (`KIND_CAPS` 1) as often as it takes; every run is safe to repeat.
 *
 * ── THE ROW FIRST, THEN THE CALL, AND THE ROW'S ID IS THE IDEMPOTENCY KEY ──────────────────────────
 * The purpose (`render:<creative>:<attempt>`) is the ledger's unique key, so a second job finds the first
 * one's row. The row is written `started` BEFORE Higgsfield is asked, and its id goes as `Idempotency-Key`.
 * Higgsfield's own request id cannot be written on a `started` row (AX011 allows the row one move, to its
 * outcome) — and it need not be: while the row is `started`, every run submits AGAIN under the same key,
 * which Higgsfield answers with the ORIGINAL request, charging nothing ("Retrying with the same key returns
 * the original request"). That one rule recovers a crash after the submit, an answer lost to a 500 after the
 * charge (`accepted_then_error`) and a webhook that never arrives: polling is the submit-again plus a status
 * read. No webhook receiver is built: the docs make it optional, and a poll that recovers everything needs
 * no second, public door.
 *
 * ── THE MONTH: SWITCH, PRICE, BUDGET, BEFORE THE ROW (Q-APX16 (a), 2026-11-18) ─────────────────────
 * `renderGate` (shared, pure), in US dollars. The price is ASKED, never kept in a table: Higgsfield's
 * `POST /estimate/<model>` with the request's final parameters — the reference's URL included, so the photo
 * goes up first (free: billing-and-retention.md charges generations only) — answers the amount its own page
 * calls authoritative for the account. It is written on the `started` row (`price_ticks`, hundredths of a
 * cent), so renders in flight count against the month at once (`higgsfieldTicksThisMonth`), and a price
 * change on their side cannot make the budget lie. An unset or spent budget is a `budget_exhausted` row,
 * written INSTEAD of the call, as the Claude rail does. The switch, and a month already past its budget at any
 * price, are judged BEFORE the upload and the estimate, so a refused render asks Higgsfield nothing.
 * An estimate Higgsfield refuses (or answers without an amount) is a row that fails at no cost
 * (`estimate_*`), never a render made at a guessed price — and never NO row, which would leave compose
 * waiting on a render nobody will start.
 *
 * ── THE OUTPUT IS COPIED AT ONCE; ITS URL NEVER LEAVES THIS FUNCTION ───────────────────────────────
 * Higgsfield keeps a file seven days. The moment a status reads `completed`, each image is downloaded,
 * decoded (`prepareAsset`, C1's — the bytes decide), stored at `<org>/<sha256>.<ext>` in `ad-assets`, and the
 * row completes with the asset's hash and OUR path. The row's `output` holds the asset refs only — no
 * Higgsfield URL is written anywhere, so none can reach a screen. A completed request whose file is gone
 * (404/410 on the download) completes `failed` / `output_expired`, at its price: it was charged, and the
 * month must say so. The download is the test, not `expires_at`: Higgsfield keeps files "at least" seven
 * days, so a file still served past that date is copied, not thrown away.
 *
 * ── THE KIT PHOTO GOES UP ONCE, AND ITS URL IS WRITTEN BEFORE THE SUBMIT (D-AD9, 2026-11-04) ───────
 * A render that starts from a kit photo (`reference`) uploads it to Higgsfield and names the upload's
 * public URL in the model's own image field (`HIGGSFIELD_IMAGE_INPUT`). Uploads have no Idempotency-Key,
 * and the docs say a key reused with "different URLs" is a different request (422) — so the URL must be
 * chosen once per render. It is: the upload happens only while NO row exists, after the budget gate, and
 * the `started` row records the final params; every later run submits the ROW's params, never re-derives
 * them. A crash between the upload and the row costs one orphan upload, which Higgsfield deletes within
 * seven days and does not charge for (billing-and-retention.md lists generations only). A model with no
 * documented image field is refused (`reference_unsupported`) before any row, as an unpriced one is:
 * drawing the truck from text would break D-AD9, not bend it.
 *
 * ── A CLIP IS THE SAME STEP, WITH THREE DIFFERENCES (V4e, 2026-11-17) ──────────────────────────────
 * A motion ad's moving picture (`input.clip`) is asked of an image-to-video model on this same road: same
 * row-first rule, same key, same month, same copy-at-once. What differs:
 *   · THE PICTURE IS CUT BEFORE IT GOES UP. No candidate model can be asked for 4:5 (`videoModels.ts`), so the
 *     reference is covered to the ad's frame by `frameStill` — the function that frames the still — and the
 *     model starts from exactly the pixels the approved ad is made of. A clip with no reference is refused: a
 *     moving picture drawn from words alone is not this carrier's truck.
 *   · THE ANSWER IS `video.url`, NOT `images`. It is read with ffprobe (`prepareClip`) and stored at
 *     `<org>/<sha256>.mp4`; the row's output is `{ clip }`, the frame and length the model really returned.
 *     A server without ffprobe leaves the render pending — the clip is paid for and is not thrown away.
 *   · THE MODEL'S OWN FIELD takes the URL (`clipImageField`), read from that model's page.
 * Its price is asked of `/estimate` exactly as a still's is, with the clip's own parameters (length included).
 */

export interface RenderDeps {
  admin: SupabaseClient;
  client: HiggsfieldClient;
  now: () => Date;
}

export interface RenderInput {
  orgId: string;
  campaignId: string | null;
  creativeId: string | null;
  attempt: number;
  /** Which of the creative's pictures this is, from 1 (V3 "make many, show few"); absent = the first, the only one before V3. */
  picture?: number;
  /** Higgsfield's model path, e.g. "higgsfield-ai/soul/v2/standard". */
  model: string;
  /** The model's parameters — the Art director's `composeImagePrompt` result goes in here. */
  params: Record<string, unknown>;
  /** The kit photo the render starts from (D-AD9), in OUR storage; null for a text-only scene. */
  reference: Pick<AdAssetRef, "sha256" | "format"> | null;
  /**
   * Set when what is asked for is a motion ad's moving picture, not a still: the frame the reference is cut to
   * before it is sent, and the layout that decides which edge the cut keeps (`frameStill`).
   */
  clip?: { format: AdFormat; layout: AdOverlayLayout };
}

/** Where this model takes an input picture: a still model's documented field, or a video model's first frame. */
const referenceField = (input: Pick<RenderInput, "model" | "clip">) => (input.clip ? clipImageField(input.model) : HIGGSFIELD_IMAGE_INPUT[input.model]);
/** A clip always starts from a picture; a still may be drawn from text. */
const referenceRefused = (input: RenderInput) => (input.clip ? !input.reference || !referenceField(input) : Boolean(input.reference) && !referenceField(input));

/** What stops a render before any row: the renderer switched off, or a model with no documented image field. */
type StartRefusal = "agent_off" | "reference_unsupported";

export type RenderOutcome =
  /** `clip` is set, and `assets` empty, when a moving picture was asked for. */
  | { kind: "stored"; generationId: string; assets: AdAssetRef[]; clip?: AdClipRef; replayed: boolean }
  | { kind: "failed"; generationId: string; errorCode: string; replayed: boolean }
  | { kind: "budget_exhausted"; generationId: string; refusal: string; replayed: boolean }
  | { kind: "refused"; refusal: StartRefusal }
  /** Not finished: run again later (the job retries with backoff). */
  | { kind: "pending"; generationId: string; retryAfterSeconds: number | null; why: string };

export const renderKey = (creativeId: string | null, attempt: number, model: string, picture = 1) => `render:${creativeId ?? "none"}:${pictureKeyPart(picture)}${attempt}:${model}`.slice(0, 200);

/**
 * Where a render stands, READ-ONLY (C5b2): what compose asks before queueing an `ads_render` job. A finished
 * row answers as a replay; a `started` row is `pending`; no row is `absent` — unless the render could never
 * start, which `renderStep` refuses WITHOUT writing a row (the renderer switched off, a reference the model
 * cannot take). Both are answered here by the same rules, so a caller that only queues jobs and reads rows
 * cannot wait forever for a row that will never be written. The budget is not judged here: the job's own
 * gate does that and records its answer as a row.
 */
export async function renderStatus(admin: SupabaseClient, input: RenderInput): Promise<RenderOutcome | { kind: "absent" }> {
  const prior = await generationByKey(admin, input.orgId, renderKey(input.creativeId, input.attempt, input.model, input.picture));
  if (prior && prior.status !== "started") return replayed(prior);
  if (prior) return { kind: "pending", generationId: prior.id, retryAfterSeconds: null, why: "rendering" };
  const { settings } = await settingsInForce(admin, input.orgId);
  if (switchedOff(settings)) return { kind: "refused", refusal: "agent_off" };
  if (referenceRefused(input)) return { kind: "refused", refusal: "reference_unsupported" };
  return { kind: "absent" };
}

/** The renderer's own switch (D-RA9), read by the gate it answers to. */
const switchedOff = (settings: Parameters<typeof renderGate>[0]) => {
  const g = renderGate(settings, "renderer", 0, 0);
  return !g.open && g.refusal === "agent_off";
};

/** What the row records of the money: the estimate as Higgsfield wrote it, and in ticks; or why there is none. */
type Asked = { params?: Record<string, unknown>; upload_refused?: string | null; estimate_refused?: string | null; price_ticks?: number | null; price_credits?: number | null };

/** The params with the uploaded photo in the field this model reads it from. */
function withReference(params: Record<string, unknown>, field: { field: string; shape: "list" | "single" }, url: string): Record<string, unknown> {
  return { ...params, [field.field]: field.shape === "list" ? [url] : url };
}

export async function renderStep(deps: RenderDeps, input: RenderInput): Promise<RenderOutcome> {
  const { admin, orgId } = { admin: deps.admin, orgId: input.orgId };
  const key = renderKey(input.creativeId, input.attempt, input.model, input.picture);
  const prior = await generationByKey(admin, orgId, key);
  if (prior && prior.status !== "started") return replayed(prior);

  let generationId = prior?.id;
  let asked: Asked = (prior?.request ?? {}) as Asked;
  let params = asked.params ?? input.params;
  if (!generationId) {
    const { settings } = await settingsInForce(admin, orgId);
    const now = deps.now();
    const used = await higgsfieldTicksThisMonth(admin, orgId, now);
    // Before anything goes to Higgsfield: the switch, and a month already past its budget at any price.
    let gate = renderGate(settings, "renderer", used, 0);
    if (!gate.open && gate.refusal === "agent_off") return { kind: "refused", refusal: "agent_off" };
    const field = input.reference ? referenceField(input) : undefined;
    if (referenceRefused(input)) return { kind: "refused", refusal: "reference_unsupported" };
    let uploadRefused: string | null = null;
    let estimateRefused: string | null = null;
    let estimate: { usd: string; ticks: number } | null = null;
    if (gate.open) {
      if (input.reference && field) {
        const photo = await readAdAsset(admin, orgId, input.reference);
        const up = input.clip
          ? await deps.client.upload(await frameStill(photo, input.clip.format, input.clip.layout), "image/png")
          : await deps.client.upload(photo, `image/${input.reference.format}`);
        if (!up.ok && up.kind === "temporary") return { kind: "pending", generationId: "", retryAfterSeconds: up.retryAfterSeconds, why: `upload: ${up.detail}` };
        if (up.ok) params = withReference(input.params, field, up.value.public_url);
        else uploadRefused = up.kind === "balance" ? "upload_balance" : `upload_${up.status}`;
      }
      if (!uploadRefused) {
        const est = await deps.client.estimate(input.model, params);
        if (!est.ok && est.kind === "temporary") return { kind: "pending", generationId: "", retryAfterSeconds: est.retryAfterSeconds, why: `estimate: ${est.detail}` };
        const ticks = est.ok ? usdTicks(est.value.usd) : null;
        if (est.ok && ticks !== null) estimate = { usd: est.value.usd, ticks };
        else estimateRefused = est.ok ? "estimate_unreadable" : est.kind === "balance" ? "estimate_balance" : `estimate_${est.status}`;
      }
      if (estimate) gate = renderGate(settings, "renderer", used, estimate.ticks);
    }
    // A refused upload or estimate is written on the row too, so a replay after a crash fails the same way
    // rather than submitting without the photo, or at no price.
    asked = { params, upload_refused: uploadRefused, estimate_refused: estimateRefused, price_ticks: estimate?.ticks ?? null };
    const request = { model: input.model, params, reference: input.reference?.sha256 ?? null, ...(input.clip ? { clip: input.clip } : {}), upload_refused: uploadRefused, estimate_refused: estimateRefused, price_usd: estimate?.usd ?? null, price_ticks: estimate?.ticks ?? null };
    const row = {
      org_id: orgId, campaign_id: input.campaignId, creative_id: input.creativeId, agent: "renderer", provider: "higgsfield" as const,
      model: input.model, prompt_version: null, input_hash: createHash("sha256").update(canonicalJson(request)).digest("hex"),
      idempotency_key: key, request, started_at: now.toISOString(),
    };
    if (!gate.open) {
      const ins = await insertGeneration(admin, { ...row, status: "budget_exhausted", error_code: gate.refusal, finished_at: now.toISOString() });
      if (ins === "duplicate") return renderStep(deps, input);
      return { kind: "budget_exhausted", generationId: ins.id, refusal: gate.refusal, replayed: false };
    }
    const ins = await insertGeneration(admin, { ...row, status: "started", error_code: null, finished_at: null });
    if (ins === "duplicate") return renderStep(deps, input);
    generationId = ins.id;
  }
  const cost = costOf(asked);
  const finish = (status: "succeeded" | "failed", f: { errorCode?: string; requestId?: string | null; charged: boolean; assets?: AdAssetRef[]; clip?: AdClipRef }) =>
    completeGeneration(admin, orgId, generationId!, {
      status, output: f.clip ? { clip: f.clip } : f.assets ? { assets: f.assets } : null, provider_request_id: f.requestId ?? null,
      cost_units: f.charged ? cost.charged : cost.free, cost_unit: cost.unit, error_code: f.errorCode ?? null, finished_at: deps.now().toISOString(),
      asset_sha256: f.clip?.sha256 ?? f.assets?.[0]?.sha256 ?? null,
      asset_path: f.clip ? clipKey(orgId, f.clip) : f.assets?.[0] ? assetKey(orgId, f.assets[0]) : null,
    });
  const fail = async (errorCode: string, charged: boolean, requestId: string | null = null): Promise<RenderOutcome> => {
    await finish("failed", { errorCode, charged, requestId });
    return { kind: "failed", generationId: generationId!, errorCode, replayed: false };
  };
  const pending = (why: string, after: number | null = null): RenderOutcome => ({ kind: "pending", generationId: generationId!, retryAfterSeconds: after, why });

  // Refused, not lost: nothing was submitted or charged, and asking again would be refused again.
  if (asked.upload_refused) return fail(asked.upload_refused, false);
  if (asked.estimate_refused) return fail(asked.estimate_refused, false);
  const sub = await deps.client.submit(input.model, params, generationId);
  if (!sub.ok) {
    if (sub.kind === "temporary") return pending(`submit: ${sub.detail}`, sub.retryAfterSeconds);
    return fail(sub.kind === "balance" ? "provider_balance" : `provider_${sub.status}`, false);
  }
  const requestId = sub.value.request_id;
  const st = await deps.client.status(requestId);
  if (!st.ok) return st.kind === "temporary" ? pending(`status: ${st.detail}`, st.retryAfterSeconds) : fail(`status_${st.kind}`, false, requestId);
  const s: HfRequestState = st.value;
  if (s.status === "queued" || s.status === "in_progress") return pending(s.status);
  if (s.status !== "completed") return fail(s.status === "nsfw" ? "nsfw" : s.status === "canceled" ? "canceled" : "provider_failed", false, requestId);
  const stored = (error: { message: string; statusCode?: unknown } | null) => !error || /already exists|409/.test(`${error.message} ${error.statusCode ?? ""}`);

  if (input.clip) {
    // A still where a clip was asked is as wrong as the reverse; both were made and charged.
    if (!s.video?.url) return fail("no_video", true, requestId);
    const file = await deps.client.download(s.video.url);
    if (!file.ok) return file.kind === "temporary" ? pending(`download: ${file.detail}`) : fail("output_expired", true, requestId);
    const prepared = await prepareClip(file.value);
    if (prepared.kind === "unavailable") return pending(`probe: ${prepared.detail}`);
    if (prepared.kind !== "ready") return fail(`output_${prepared.code}`, true, requestId);
    const { error } = await admin.storage.from(AD_ASSETS_BUCKET).upload(clipKey(orgId, prepared.ref), prepared.bytes, { contentType: "video/mp4", upsert: false });
    if (!stored(error)) return pending(`store: ${error!.message}`);
    await finish("succeeded", { requestId, charged: true, clip: prepared.ref });
    return { kind: "stored", generationId, assets: [], clip: prepared.ref, replayed: false };
  }
  if (!s.images?.length) return fail("no_image", true, requestId);

  const assets: AdAssetRef[] = [];
  for (const image of s.images) {
    const file = await deps.client.download(image.url);
    if (!file.ok) return file.kind === "temporary" ? pending(`download: ${file.detail}`) : fail("output_expired", true, requestId);
    const prepared = await prepareAsset(file.value);
    if (prepared.kind !== "ready") return fail(`output_${prepared.code}`, true, requestId);
    const { error } = await admin.storage.from(AD_ASSETS_BUCKET).upload(assetKey(orgId, prepared.ref), prepared.bytes, { contentType: `image/${prepared.ref.format}`, upsert: false });
    if (!stored(error)) return pending(`store: ${error!.message}`);
    assets.push(prepared.ref);
  }
  await finish("succeeded", { requestId, charged: true, assets });
  return { kind: "stored", generationId, assets, replayed: false };
}

/**
 * What a finished render cost, in the unit its row was priced in. A row priced by `/estimate` completes in
 * dollars (`usd`, four places, 0634). A row written before Q-APX16 still in flight carries `price_credits`
 * and completes in credits, as it was begun: the ledger records what a row said, and the dollar month does
 * not count it, because a credit was never a dollar.
 */
function costOf(asked: Asked): { unit: "usd" | "credits"; charged: string | number; free: string | number } {
  if (typeof asked.price_ticks === "number") return { unit: "usd", charged: ticksAsDollars(asked.price_ticks), free: ticksAsDollars(0) };
  if (typeof asked.price_credits === "number") return { unit: "credits", charged: asked.price_credits, free: 0 };
  return { unit: "usd", charged: ticksAsDollars(0), free: ticksAsDollars(0) };
}

function replayed(row: GenerationRow): RenderOutcome {
  if (row.status === "budget_exhausted") return { kind: "budget_exhausted", generationId: row.id, refusal: row.error_code ?? "budget_spent", replayed: true };
  if (row.status === "failed") return { kind: "failed", generationId: row.id, errorCode: row.error_code ?? "failed", replayed: true };
  const output = row.output as { assets?: AdAssetRef[]; clip?: AdClipRef } | null;
  return { kind: "stored", generationId: row.id, assets: output?.assets ?? [], ...(output?.clip ? { clip: output.clip } : {}), replayed: true };
}

/**
 * The `ads_render` job's payload back into the input `queuedRender` queued (it enqueues `{ ...input }`), the
 * org taken from the job row, never the payload. A payload that is not one is a bug of ours: it throws, and
 * the job's failure says why. The reference is the kit photo (D-AD9), or null for a text-only scene.
 */
export function renderInputFromPayload(orgId: string, payload: unknown): RenderInput {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (typeof p.model !== "string" || !p.params || typeof p.params !== "object" || typeof p.attempt !== "number") {
    throw new Error("ads_render: payload needs model, params and attempt");
  }
  const r = p.reference as { sha256?: unknown; format?: unknown } | null | undefined;
  const format = r?.format === "png" || r?.format === "jpeg" || r?.format === "webp" ? r.format : null;
  if (r && (typeof r.sha256 !== "string" || !format)) throw new Error("ads_render: payload reference needs sha256 and format");
  const c = p.clip as { format?: unknown; layout?: unknown } | null | undefined;
  const cut = c && AD_FORMATS.find((f) => f === c.format) && AD_OVERLAY_LAYOUTS.find((l) => l === c.layout);
  if (c && !cut) throw new Error("ads_render: payload clip needs a format and a layout we draw");
  return {
    orgId, campaignId: typeof p.campaignId === "string" ? p.campaignId : null, creativeId: typeof p.creativeId === "string" ? p.creativeId : null,
    attempt: p.attempt, ...(typeof p.picture === "number" ? { picture: p.picture } : {}), model: p.model, params: p.params as Record<string, unknown>,
    reference: r ? { sha256: r.sha256 as string, format: format! } : null,
    ...(c ? { clip: { format: c.format as AdFormat, layout: c.layout as AdOverlayLayout } } : {}),
  };
}
