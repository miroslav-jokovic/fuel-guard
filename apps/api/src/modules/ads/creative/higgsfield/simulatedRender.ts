import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import type { Env } from "../../../../env.js";
import { simulatorGate } from "../../platforms/simulatorGate.js";
import { FakeHiggsfield } from "./fakeHiggsfield.js";
import { HiggsfieldClient } from "./higgsfieldClient.js";
import { higgsfieldKeyFor } from "./higgsfieldKey.js";
import { HIGGSFIELD_CREDIT_PRICES, HIGGSFIELD_STILL_MODEL, SIMULATED_STILL_MODEL } from "./prices.js";

/**
 * The render half of the simulator (ADS-AGENT-BUILD-WORKFLOW.md §4R, "Simulator platform"; found by the
 * 2026-11-05 audit). Stage 1 ends with the owner walking the whole flow on staging with no credential, but only
 * Meta had a simulator: with `HIGGSFIELD_STILL_MODEL` null until V4, every compose stopped at the render, so no ad
 * reached review and nothing after it could be walked.
 *
 * ── THE SAME RULE AS THE META SIMULATOR ───────────────────────────────────────────────────────────
 * It is the REAL client, the real `renderStep`, the real ledger and credit budget, pointed at an in-process
 * FakeHiggsfield. Only the bytes are not a model's. `simulatorGate` is asked at every call, so a production host
 * never holds this fake, and the choice follows the campaign's connection: a campaign on a real Meta connection
 * still stops at "no still model chosen yet (V4)", on staging too. That refusal stays true for real campaigns.
 *
 * ── WHAT IT DRAWS, AND WHY NOT A PLACEHOLDER ──────────────────────────────────────────────────────
 * The Claude checks stay real, so the picture must be able to pass them honestly. A scene with equipment gets the
 * kit photo back, which is the one image certain to match its own reference; a kit photo with writing on it fails
 * `no_glyphs`, as it should. A scene without equipment gets a drawn empty road. Neither carries a "SIMULATED" mark,
 * because that would be writing on the image and fail the check it is here to exercise. The ledger is where a
 * simulated render says what it is: its row's model is `simulator/still`.
 *
 * What this does NOT prove: anything about Higgsfield. That is L4's. FakeHiggsfield holds its requests and uploads
 * in memory until the process restarts, which is fine for a staging walk and is why it is never a production path.
 */

/** One credit, not zero, so a simulated render meets the same month budget a real one does. */
export const SIMULATED_RENDER_PRICES: Readonly<Record<string, number>> = { [SIMULATED_STILL_MODEL]: 1 };

const ROAD = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="2000">
  <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3f76a8"/><stop offset="1" stop-color="#d9c7a3"/></linearGradient></defs>
  <rect width="1600" height="1100" fill="url(#sky)"/>
  <rect y="1100" width="1600" height="900" fill="#6d7a4f"/>
  <polygon points="760,1100 840,1100 1500,2000 100,2000" fill="#3b3e42"/>
  <polygon points="794,1100 806,1100 830,2000 770,2000" fill="#c9b458"/>
</svg>`;

/** The kit photo the render started from, or the empty road. PNG either way, as the fake's file says it is. */
export async function drawSimulatedStill(inputs: Buffer[]): Promise<Buffer> {
  return sharp(inputs[0] ?? Buffer.from(ROAD)).png().toBuffer();
}

export interface RenderChoice {
  /** Null = no model yet, which compose reports as a stop. */
  model: string | null;
  prices: Readonly<Record<string, number>>;
}

const REAL_CHOICE: RenderChoice = { model: HIGGSFIELD_STILL_MODEL, prices: HIGGSFIELD_CREDIT_PRICES };

/** Which model draws this campaign's stills: the simulator's only for a simulator connection on a host that allows it. */
export async function renderChoiceFor(admin: SupabaseClient, orgId: string, connectionId: string, processEnv: NodeJS.ProcessEnv = process.env): Promise<RenderChoice> {
  if (!simulatorGate(processEnv).allowed) return REAL_CHOICE;
  const { data, error } = await admin.from("ads_platform_connections").select("provider").eq("org_id", orgId).eq("id", connectionId).maybeSingle();
  if (error) throw new Error(`ads_platform_connections: ${error.message}`);
  return (data as { provider: string } | null)?.provider === "simulator"
    ? { model: SIMULATED_STILL_MODEL, prices: SIMULATED_RENDER_PRICES }
    : REAL_CHOICE;
}

export type RenderClient =
  | { ok: true; client: HiggsfieldClient; prices: Readonly<Record<string, number>> }
  | { ok: false; reason: string };

/** The client an `ads_render` job uses for this model: the carrier's key, or the fake, which the gate must allow again. */
export async function renderClientFor(admin: SupabaseClient, env: Env, orgId: string, model: string, processEnv: NodeJS.ProcessEnv = process.env): Promise<RenderClient> {
  if (model === SIMULATED_STILL_MODEL) {
    const gate = simulatorGate(processEnv);
    if (!gate.allowed) return { ok: false, reason: `simulator_not_allowed: ${gate.reason}` };
    const sim = await simulatedHiggsfield();
    return { ok: true, client: new HiggsfieldClient(sim.key, { baseUrl: sim.base }), prices: SIMULATED_RENDER_PRICES };
  }
  const key = await higgsfieldKeyFor(admin, env, orgId);
  return key.ok ? { ok: true, client: new HiggsfieldClient(key.key), prices: HIGGSFIELD_CREDIT_PRICES } : { ok: false, reason: key.reason };
}

// ── the in-process fake ──────────────────────────────────────────────────────────────────────────

type Simulated = { key: { id: string; secret: string }; base: string; fake: FakeHiggsfield };
let simulated: Promise<Simulated> | null = null;

function simulatedHiggsfield(): Promise<Simulated> {
  simulated ??= (async () => {
    const key = { id: "sim", secret: randomBytes(24).toString("hex") };
    const fake = new FakeHiggsfield({
      keyId: key.id, keySecret: key.secret, webhookSecret: `whsec_${randomBytes(32).toString("base64")}`,
      // The budget that matters is the carrier's own, in Settings; the fake's balance must never be what stops a walk.
      balanceCents: Number.MAX_SAFE_INTEGER, prices: { [SIMULATED_STILL_MODEL]: 0 }, draw: drawSimulatedStill,
    });
    return { key, base: await fake.start(), fake };
  })();
  return simulated;
}

/** For tests only: stop and forget the in-process fake. */
export async function stopSimulatedRenderForTests(): Promise<void> {
  const s = simulated;
  simulated = null;
  if (s) await (await s).fake.stop();
}
