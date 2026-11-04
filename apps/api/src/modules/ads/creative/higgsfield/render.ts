import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalJson, creditGate, type AdAssetRef, type CreditGateRefusal } from "@silvicom/shared";
import { settingsInForce } from "../../settings/settingsVersions.js";
import { completeGeneration, generationByKey, higgsfieldCreditsThisMonth, insertGeneration, type GenerationRow } from "../../generations/generationLedger.js";
import { AD_ASSETS_BUCKET, assetKey, prepareAsset } from "../brandAssets.js";
import type { HiggsfieldClient, HfRequestState } from "./higgsfieldClient.js";

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
}

export type RenderOutcome =
  | { kind: "stored"; generationId: string; assets: AdAssetRef[]; replayed: boolean }
  | { kind: "failed"; generationId: string; errorCode: string; replayed: boolean }
  | { kind: "budget_exhausted"; generationId: string; refusal: string; replayed: boolean }
  | { kind: "refused"; refusal: Extract<CreditGateRefusal, "agent_off" | "price_unknown"> }
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
  return { kind: "absent" };
}

export async function renderStep(deps: RenderDeps, input: RenderInput): Promise<RenderOutcome> {
  const { admin, orgId } = { admin: deps.admin, orgId: input.orgId };
  const key = renderKey(input.creativeId, input.attempt, input.model);
  const prior = await generationByKey(admin, orgId, key);
  if (prior && prior.status !== "started") return replayed(prior);

  let generationId = prior?.id;
  if (!generationId) {
    const price = deps.prices[input.model] ?? null;
    const { settings } = await settingsInForce(admin, orgId);
    const now = deps.now();
    const gate = creditGate(settings, "renderer", await higgsfieldCreditsThisMonth(admin, orgId, now), price);
    if (!gate.open && (gate.refusal === "agent_off" || gate.refusal === "price_unknown")) return { kind: "refused", refusal: gate.refusal };
    const request = { model: input.model, params: input.params, price_credits: price };
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

  const sub = await deps.client.submit(input.model, input.params, generationId);
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
