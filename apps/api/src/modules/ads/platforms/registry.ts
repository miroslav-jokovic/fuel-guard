import { randomBytes } from "node:crypto";
import type { Env } from "../../../env.js";
import { open, secretAad, SecretBoxError } from "../../../lib/secretBox.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdPlatform } from "@silvicom/shared";
import type { PlatformAdapter } from "./adapter.js";
import { MetaGraph } from "./meta/graphClient.js";
import { metaAdapter } from "./meta/metaAdapter.js";
import { simulatorGate } from "./simulatorGate.js";
import { FakeMeta } from "./simulator/fakeMeta.js";

/**
 * Which Graph client a connection gets (B1b). The ONE place a sealed token is opened, and the one place
 * the simulator is handed out.
 *
 * ── THE SIMULATOR IS THE REAL CLIENT POINTED AT FAKEMETA (decided in 7b) ─────────────────────────
 * A `simulator` connection gets `MetaGraph`, the production client, with its base URL on an in-process
 * FakeMeta. Everything above the client — the connection test now, the publisher and monitor later —
 * runs the code production runs. A second "simulated client" would be a copy that B2 deletes, and a
 * staging walk-through on it would prove the copy.
 *
 * It is handed out only when `simulatorGate` says this host is positively not production (staging,
 * Railway `uat`, a laptop, CI). Everywhere else the answer is a refusal with the gate's reason —
 * asked at EVERY call, not once at boot, so a production host never holds a simulator.
 *
 * The fake starts on first use, listens on 127.0.0.1 only, on a random port, with a random token,
 * and lives as long as the process. A restart forgets its campaigns; FakeMeta's header says why that
 * is the honest behaviour.
 */

/** Sealed with AAD = org + platform + account kind, so a sandbox token cannot be moved into the live row. */
export const metaTokenPurpose = (sandbox: boolean): string => `meta_ads:${sandbox ? "sandbox" : "live"}`;
export const metaPageTokenPurpose = (sandbox: boolean): string => `meta_ads_page:${sandbox ? "sandbox" : "live"}`;

/** The simulator's one ad account and Page: what the Connect-the-simulator door points the connection at. */
export const SIMULATOR_ACCOUNT_ID = "990000000001";
export const SIMULATOR_PAGE_ID = "990000000101";

export interface ConnectionForGraph {
  id: string;
  org_id: string;
  provider: string;
  is_sandbox: boolean;
  token_sealed: string | null;
}

export type GraphForConnection =
  | { ok: true; graph: MetaGraph; simulated: boolean }
  | { ok: false; reason: string; error_code: "simulator_not_allowed" | "no_token" | "token_unreadable" | "not_built" };

export interface RegistryDeps {
  env: Env;
  /** The process environment the simulator gate reads; injectable so a test can be production. */
  processEnv?: NodeJS.ProcessEnv;
  now?: () => Date;
}

export async function graphForConnection(deps: RegistryDeps, c: ConnectionForGraph): Promise<GraphForConnection> {
  const throttleKey = `connection:${c.id}`;
  if (c.provider === "simulator") {
    const gate = simulatorGate(deps.processEnv ?? process.env);
    if (!gate.allowed) return { ok: false, error_code: "simulator_not_allowed", reason: `The simulator is not available on this server: ${gate.reason}.` };
    const sim = await simulatorMeta();
    return { ok: true, simulated: true, graph: new MetaGraph({ token: sim.token, throttleKey, baseUrl: sim.base, now: deps.now }) };
  }
  if (c.provider !== "meta") return { ok: false, error_code: "not_built", reason: `${c.provider} connections are not built yet.` };
  if (!c.token_sealed) return { ok: false, error_code: "no_token", reason: "This connection holds no token. Connect it again." };
  let token: string;
  try {
    token = open(deps.env, c.token_sealed, secretAad(c.org_id, metaTokenPurpose(c.is_sandbox)));
  } catch (e) {
    // The reason names the key's fault, never the token: SecretBoxError messages carry no plaintext.
    const why = e instanceof SecretBoxError ? e.code : "unknown";
    return { ok: false, error_code: "token_unreadable", reason: `The stored token could not be opened (${why}). Connect it again.` };
  }
  return { ok: true, simulated: false, graph: new MetaGraph({ token, throttleKey, now: deps.now }) };
}

/**
 * The same connection's PAGE client (B2b): Instant Forms are made with the Page's token, never the
 * system user's (Lead Ads guide). Connect derived and sealed it (B1b) under its own purpose, so the
 * user token's AAD cannot open it. The simulator hands out FakeMeta's Page token for its one Page.
 */
export async function pageGraphForConnection(deps: RegistryDeps, c: ConnectionForGraph & { page_token_sealed: string | null }): Promise<GraphForConnection> {
  const throttleKey = `connection:${c.id}`;
  if (c.provider === "simulator") {
    const gate = simulatorGate(deps.processEnv ?? process.env);
    if (!gate.allowed) return { ok: false, error_code: "simulator_not_allowed", reason: `The simulator is not available on this server: ${gate.reason}.` };
    const sim = await simulatorMeta();
    const page = sim.fake.pages.find((p) => p.id === SIMULATOR_PAGE_ID)!;
    return { ok: true, simulated: true, graph: new MetaGraph({ token: page.access_token, throttleKey, baseUrl: sim.base, now: deps.now }) };
  }
  if (c.provider !== "meta") return { ok: false, error_code: "not_built", reason: `${c.provider} connections are not built yet.` };
  if (!c.page_token_sealed) return { ok: false, error_code: "no_token", reason: "This connection holds no Page token. Run the connection test or connect it again." };
  try {
    const token = open(deps.env, c.page_token_sealed, secretAad(c.org_id, metaPageTokenPurpose(c.is_sandbox)));
    return { ok: true, simulated: false, graph: new MetaGraph({ token, throttleKey, now: deps.now }) };
  } catch (e) {
    const why = e instanceof SecretBoxError ? e.code : "unknown";
    return { ok: false, error_code: "token_unreadable", reason: `The stored Page token could not be opened (${why}). Connect it again.` };
  }
}

/**
 * The adapter for one of this org's connections (B3) — what the orchestrator's `platform` worker binds
 * to the guard. Null when the connection is missing, another org's, disconnected, or its client cannot
 * be opened: the runner then records `no_platform` on the step instead of guessing. Org-scoped on
 * purpose — the service role bypasses RLS (root CLAUDE.md).
 */
export async function adapterForConnection(
  deps: RegistryDeps & { admin: SupabaseClient },
  orgId: string,
  connectionId: string,
): Promise<{ platform: AdPlatform; adapter: PlatformAdapter } | null> {
  const { data, error } = await deps.admin
    .from("ads_platform_connections")
    .select("id, org_id, provider, is_sandbox, token_sealed, account_ref, status")
    .eq("org_id", orgId).eq("id", connectionId).maybeSingle();
  if (error) throw new Error(`ads_platform_connections: ${error.message}`);
  const row = data as (ConnectionForGraph & { account_ref: string | null; status: string }) | null;
  if (!row || row.status === "disconnected" || !row.account_ref) return null;
  const opened = await graphForConnection(deps, row);
  if (!opened.ok) return null;
  const platform: AdPlatform = row.provider === "simulator" ? "simulator" : "meta";
  return { platform, adapter: metaAdapter({ graph: opened.graph, accountId: row.account_ref }) };
}

// ── the in-process simulator ─────────────────────────────────────────────────────────────────────

let simulator: Promise<{ token: string; base: string; fake: FakeMeta }> | null = null;

function simulatorMeta(): Promise<{ token: string; base: string; fake: FakeMeta }> {
  simulator ??= (async () => {
    const token = `sim-${randomBytes(24).toString("hex")}`;
    const fake = new FakeMeta({
      token,
      // A $3,000 account limit, as the click-path asks the owner to set one (workflow §6 G1).
      accounts: [{ id: SIMULATOR_ACCOUNT_ID, spend_cap_cents: 300_000, amount_spent_cents: 0, account_status: 1, currency: "USD" }],
      user: { id: "990000000900", name: "Simulator system user" },
      pages: [{ id: SIMULATOR_PAGE_ID, name: "Simulator Page", access_token: `simpage-${randomBytes(24).toString("hex")}`, tasks: ["ADVERTISE", "ANALYZE", "CREATE_CONTENT", "MODERATE"] }],
    });
    return { token, base: await fake.start(), fake };
  })();
  return simulator;
}

/** For tests only: the simulator's FakeMeta, to seed objects and read what the adapter did. */
export async function simulatorFakeForTests(): Promise<FakeMeta> {
  return (await simulatorMeta()).fake;
}

/** For tests only: stop and forget the in-process simulator. */
export async function stopSimulatorForTests(): Promise<void> {
  const s = simulator;
  simulator = null;
  if (s) await (await s).fake.stop();
}
