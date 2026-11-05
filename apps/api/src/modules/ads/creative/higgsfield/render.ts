import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalJson, creditGate, type AdAssetRef, type CreditGateRefusal } from "@silvicom/shared";
import { settingsInForce } from "../../settings/settingsVersions.js";
import { completeGeneration, generationByKey, higgsfieldCreditsThisMonth, insertGeneration, type GenerationRow } from "../../generations/generationLedger.js";
import { AD_ASSETS_BUCKET, assetKey, prepareAsset, readAdAsset } from "../brandAssets.js";
import type { HiggsfieldClient, HfRequestState } from "./higgsfieldClient.js";
import { HIGGSFIELD_IMAGE_INPUT } from "./prices.js";

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
 * ── THE MONTH: SWITCH, PRICE, BUDGET, BEFORE THE ROW ───────────────────────────────────────────────
 * `creditGate` (shared, pure). A model with no price (`HIGGSFIELD_CREDIT_PRICES`, empty until V4 measures
 * one) is refused, not guessed. The price is written on the `started` row, so renders in flight count
 * against the month at once (`higgsfieldCreditsThisMonth`). An unset or spent budget is a
 * `budget_exhausted` row, written INSTEAD of the call, as the Claude rail does.
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
 */

export interface RenderDeps {
  admin: SupabaseClient;
  client: HiggsfieldClient;
  now: () => Date;
  /** Credits per model path; a model missing here cannot be rendered (see `prices.ts`). */
  prices: Readonly<Record<string, number>>;
}

export interface RenderInput {
  orgId: string;
  campaignId: string | null;
  creativeId: string | null;
  attempt: number;
  /** Higgsfield's model path, e.g. "higgsfield-ai/soul/v2/standard". */
  model: string;
  /** The model's parameters — the Art director's `composeImagePrompt` result goes in here. */
  params: Record<string, unknown>;
  /** The kit photo the render starts from (D-AD9), in OUR storage; null for a text-only scene. */
  reference: Pick<AdAssetRef, "sha256" | "format"> | null;
}

type StartRefusal = Extract<CreditGateRefusal, "agent_off" | "price_unknown"> | "reference_unsupported";

export type RenderOutcome =
  | { kind: "stored"; generationId: string; assets: AdAssetRef[]; replayed: boolean }
  | { kind: "failed"; generationId: string; errorCode: string; replayed: boolean }
  | { kind: "budget_exhausted"; generationId: string; refusal: string; replayed: boolean }
  | { kind: "refused"; refusal: StartRefusal }
  /** Not finished: run again later (the job retries with backoff). */
  | { kind: "pending"; generationId: string; retryAfterSeconds: number | null; why: string };

export const renderKey = (creativeId: string | null, attempt: number, model: string) => `render:${creativeId ?? "none"}:${attempt}:${model}`.slice(0, 200);

/**
 * Where a render stands, READ-ONLY (C5b2): what compose asks before queueing an `ads_render` job. A finished
 * row answers as a replay; a `started` row is `pending`; no row is `absent` — unless the render could never
 * start, which `renderStep` refuses WITHOUT writing a row (a model nobody priced, the renderer switched off).
 * Those two are answered here from the same `creditGate`, so a caller that only queues jobs and reads rows
 * cannot wait forever for a row that will never be written. The budget is not judged here: the job's own
 * gate does that and records its answer as a row.
 */
export async function renderStatus(admin: SupabaseClient, prices: Readonly<Record<string, number>>, input: RenderInput): Promise<RenderOutcome | { kind: "absent" }> {
  const prior = await generationByKey(admin, input.orgId, renderKey(input.creativeId, input.attempt, input.model));
  if (prior && prior.status !== "started") return replayed(prior);
  if (prior) return { kind: "pending", generationId: prior.id, retryAfterSeconds: null, why: "rendering" };
  const { settings } = await settingsInForce(admin, input.orgId);
  const gate = creditGate(settings, "renderer", 0, prices[input.model] ?? null);
  if (!gate.open && (gate.refusal === "agent_off" || gate.refusal === "price_unknown")) return { kind: "refused", refusal: gate.refusal };
  if (input.reference && !HIGGSFIELD_IMAGE_INPUT[input.model]) return { kind: "refused", refusal: "reference_unsupported" };
  return { kind: "absent" };
}

/** The params with the uploaded photo in the field this model reads it from. */
function withReference(params: Record<string, unknown>, field: { field: string; shape: "list" | "single" }, url: string): Record<string, unknown> {
  return { ...params, [field.field]: field.shape === "list" ? [url] : url };
}

export async function renderStep(deps: RenderDeps, input: RenderInput): Promise<RenderOutcome> {
  const { admin, orgId } = { admin: deps.admin, orgId: input.orgId };
  const key = renderKey(input.creativeId, input.attempt, input.model);
  const prior = await generationByKey(admin, orgId, key);
  if (prior && prior.status !== "started") return replayed(prior);

  let generationId = prior?.id;
  const asked = prior?.request as { params?: Record<string, unknown>; upload_refused?: string | null } | null | undefined;
  let params = asked?.params ?? input.params;
  let uploadRefused = asked?.upload_refused ?? null;
  if (!generationId) {
    const price = deps.prices[input.model] ?? null;
    const { settings } = await settingsInForce(admin, orgId);
    const now = deps.now();
    const gate = creditGate(settings, "renderer", await higgsfieldCreditsThisMonth(admin, orgId, now), price);
    if (!gate.open && (gate.refusal === "agent_off" || gate.refusal === "price_unknown")) return { kind: "refused", refusal: gate.refusal };
    const field = input.reference ? HIGGSFIELD_IMAGE_INPUT[input.model] : undefined;
    if (input.reference && !field) return { kind: "refused", refusal: "reference_unsupported" };
    if (gate.open && input.reference && field) {
      const up = await deps.client.upload(await readAdAsset(admin, orgId, input.reference), `image/${input.reference.format}`);
      if (!up.ok && up.kind === "temporary") return { kind: "pending", generationId: "", retryAfterSeconds: up.retryAfterSeconds, why: `upload: ${up.detail}` };
      if (up.ok) params = withReference(input.params, field, up.value.public_url);
      else uploadRefused = up.kind === "balance" ? "upload_balance" : `upload_${up.status}`;
    }
    // A refused upload is written on the row too, so a replay after a crash fails the same way rather than
    // submitting the params without the photo.
    const request = { model: input.model, params, reference: input.reference?.sha256 ?? null, upload_refused: uploadRefused, price_credits: price };
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
  const price = deps.prices[input.model] ?? 0;
  const finish = (status: "succeeded" | "failed", f: { errorCode?: string; requestId?: string | null; charged: boolean; assets?: AdAssetRef[] }) =>
    completeGeneration(admin, orgId, generationId!, {
      status, output: f.assets ? { assets: f.assets } : null, provider_request_id: f.requestId ?? null,
      cost_units: f.charged ? price : 0, cost_unit: "credits", error_code: f.errorCode ?? null, finished_at: deps.now().toISOString(),
      asset_sha256: f.assets?.[0]?.sha256 ?? null, asset_path: f.assets?.[0] ? assetKey(orgId, f.assets[0]) : null,
    });
  const fail = async (errorCode: string, charged: boolean, requestId: string | null = null): Promise<RenderOutcome> => {
    await finish("failed", { errorCode, charged, requestId });
    return { kind: "failed", generationId: generationId!, errorCode, replayed: false };
  };
  const pending = (why: string, after: number | null = null): RenderOutcome => ({ kind: "pending", generationId: generationId!, retryAfterSeconds: after, why });

  // Refused, not lost: nothing was submitted or charged, and asking again would be refused again.
  if (uploadRefused) return fail(uploadRefused, false);
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
  if (!s.images?.length) return fail("no_image", true, requestId);

  const assets: AdAssetRef[] = [];
  for (const image of s.images) {
    const file = await deps.client.download(image.url);
    if (!file.ok) return file.kind === "temporary" ? pending(`download: ${file.detail}`) : fail("output_expired", true, requestId);
    const prepared = await prepareAsset(file.value);
    if (prepared.kind !== "ready") return fail(`output_${prepared.code}`, true, requestId);
    const { error } = await admin.storage.from(AD_ASSETS_BUCKET).upload(assetKey(orgId, prepared.ref), prepared.bytes, { contentType: `image/${prepared.ref.format}`, upsert: false });
    if (error && !/already exists|409/.test(`${error.message} ${(error as { statusCode?: unknown }).statusCode ?? ""}`)) return pending(`store: ${error.message}`);
    assets.push(prepared.ref);
  }
  await finish("succeeded", { requestId, charged: true, assets });
  return { kind: "stored", generationId, assets, replayed: false };
}

function replayed(row: GenerationRow): RenderOutcome {
  if (row.status === "budget_exhausted") return { kind: "budget_exhausted", generationId: row.id, refusal: row.error_code ?? "budget_spent", replayed: true };
  if (row.status === "failed") return { kind: "failed", generationId: row.id, errorCode: row.error_code ?? "failed", replayed: true };
  const assets = (row.output as { assets?: AdAssetRef[] } | null)?.assets ?? [];
  return { kind: "stored", generationId: row.id, assets, replayed: true };
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
  return {
    orgId, campaignId: typeof p.campaignId === "string" ? p.campaignId : null, creativeId: typeof p.creativeId === "string" ? p.creativeId : null,
    attempt: p.attempt, model: p.model, params: p.params as Record<string, unknown>,
    reference: r ? { sha256: r.sha256 as string, format: format! } : null,
  };
}
