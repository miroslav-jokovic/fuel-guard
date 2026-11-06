import type { MetaGraph } from "../platforms/meta/graphClient.js";
import { simulatorGate } from "../platforms/simulatorGate.js";

/**
 * D-AD8, "Staging spends nothing", enforced (Q-AD42, ruled by the orchestrator 2026-11-06: (a) AND (b)). On a host that
 * is not production, a Meta ad account is accepted only when BOTH hold:
 *
 *   (b) its id is in that host's allowlist, `META_SANDBOX_AD_ACCOUNT_IDS`, read from its deploy settings (Parameter
 *       Store), comma-separated, `act_` optional. Empty or unset = every Meta account is refused there. The
 *       engineer's word, kept where only a deploy can change it. Read from the process environment, the same place
 *       and the same way `simulatorGate` reads the host's name: both are facts about the HOST, so they come from one
 *       source. (Not in `env.ts`, which sits at its 500-line budget: that file's split is its own change.);
 *   (a) Meta's own read of the account shows NO payment method. The Ad Account reference, `funding_source` (read
 *       2026-11-06, https://developers.facebook.com/docs/marketing-api/reference/ad-account/): "If the account does not
 *       have a payment method it will still be possible to create ads but these ads will get no delivery." So this
 *       half checks the property that matters, that the account cannot be billed, from Meta, not from a box an admin
 *       ticks. **OUR reading, for L4 to confirm:** that a sandbox ad account reports no `funding_source` (absent,
 *       empty or "0"), and that the system user's token may read it (the page names no permission for
 *       `funding_source`; `funding_source_details` needs MANAGE). If L4 shows otherwise, Q-AD42's fallback is (b) alone.
 *
 * ── WHAT "NOT PRODUCTION" MEANS ──────────────────────────────────────────────────────────────────
 * `simulatorGate`'s answer, the one source: a host it would let run the simulator is a non-production host. So a
 * built server with no deployment name, which the gate treats as production, keeps production's behaviour here.
 *
 * ── WHERE IT IS ASKED ────────────────────────────────────────────────────────────────────────────
 * Connect (`connections/connections.ts`, before anything is sealed) and the launch door (`campaigns/campaignDoors.ts`,
 * before the launch certification and before any approval is read), so an account connected before this rule cannot
 * launch on staging either. Production is unchanged: on production this answers yes without reading anything.
 * The simulator is not a Meta account: its own gate decides it.
 */

export const SANDBOX_ONLY_MESSAGE = "Staging may only use a Meta sandbox ad account.";

export type SandboxOnlyRefusal = "sandbox_not_listed" | "account_can_pay" | "account_unreadable";

export type SandboxOnlyVerdict =
  | { ok: true; checked: boolean }
  | { ok: false; refusal: SandboxOnlyRefusal; message: string };

export interface SandboxOnlyDeps {
  /** The host's environment: its name (`simulatorGate`) and its sandbox allowlist. Defaults to this process's. */
  processEnv?: NodeJS.ProcessEnv;
}

const bare = (id: string): string => id.trim().replace(/^act_/, "");

/** The host's allowlist, `act_` stripped. Unset or empty = nothing is allowed. */
export function sandboxAllowlist(processEnv: NodeJS.ProcessEnv): string[] {
  return (processEnv.META_SANDBOX_AD_ACCOUNT_IDS ?? "").split(",").map(bare).filter((x) => x !== "");
}

/** A `funding_source` that names a payment method: anything but absent, empty or "0". */
const hasPaymentMethod = (v: unknown): boolean => v !== undefined && v !== null && String(v).trim() !== "" && String(v).trim() !== "0";

/**
 * `openGraph` is asked only when a read is needed, so production opens nothing; a graph that cannot be opened (a token
 * this deploy cannot unseal) is `null`, and an account nobody can ask about is not used.
 */
export async function sandboxOnlyVerdict(
  deps: SandboxOnlyDeps, provider: string, accountId: string, openGraph: () => Promise<Pick<MetaGraph, "get"> | null>,
): Promise<SandboxOnlyVerdict> {
  const host = deps.processEnv ?? process.env;
  if (provider !== "meta") return { ok: true, checked: false };
  if (!simulatorGate(host).allowed) return { ok: true, checked: false };
  const id = bare(accountId);
  if (!sandboxAllowlist(host).includes(id)) {
    return { ok: false, refusal: "sandbox_not_listed", message: `${SANDBOX_ONLY_MESSAGE} Ad account ${id} is not one of this server's sandbox accounts.` };
  }
  const graph = await openGraph();
  const r = graph ? await graph.get<{ funding_source?: unknown }>(`act_${id}`, { fields: "funding_source" }) : null;
  if (!r || !r.ok) {
    return { ok: false, refusal: "account_unreadable", message: `${SANDBOX_ONLY_MESSAGE} Meta could not be asked whether ad account ${id} can be billed, so it is not used.` };
  }
  if (hasPaymentMethod(r.data.funding_source)) {
    return { ok: false, refusal: "account_can_pay", message: `${SANDBOX_ONLY_MESSAGE} Meta says ad account ${id} has a payment method, so it could spend real money.` };
  }
  return { ok: true, checked: true };
}
