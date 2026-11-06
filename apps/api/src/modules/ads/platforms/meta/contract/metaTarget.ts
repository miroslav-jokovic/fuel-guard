import { randomBytes } from "node:crypto";
import { FakeMeta } from "../../simulator/fakeMeta.js";
import { META_GRAPH_BASE, MetaGraph } from "../graphClient.js";
import { FaultProxy } from "./faultProxy.js";

/**
 * The ONE switch between FakeMeta and Meta's sandbox for the Meta contract suite (ADS-AGENT-BUILD-WORKFLOW
 * §4R: L3 "contract suite green on the fake", L4 "the SAME suite re-run with ADS_TARGET=sandbox").
 *
 *   ADS_TARGET unset or `fake` → a fresh FakeMeta per test, with its own random token, one ad account and
 *                                one Page.
 *   ADS_TARGET=sandbox         → Meta's real Graph host, with the sandbox ad account and Page the owner
 *                                connects in Stage 2, read from the four `META_SANDBOX_*` variables below.
 *                                A missing one REFUSES the run, naming it: a suite that quietly fell back to
 *                                the fake would certify nothing while saying L4.
 *   anything else              → refused, so a typo is not a quiet fake run either.
 *
 * Either way the client talks to a `FaultProxy` in front of the target, and the suite reads everything
 * through Graph — what was made, what it reads back as — never through the fake's own maps. That is what
 * lets the sandbox run be the same file: nothing in it knows which target answered.
 *
 * A token is revoked the way it would be on either target: the suite's tokens are swapped for ones the
 * platform refuses (Meta answers 190, which `graphClient.ts` files as `token_invalid`). We cannot revoke a
 * real sandbox grant from a test; a refused token is the answer the code meets either way.
 *
 * Afterwards every campaign the run made is DELETED through Graph (Meta deletes its ad sets and ads with
 * it). Instant Forms cannot be deleted, only archived; a sandbox Page keeps the forms each run made.
 */

export type TargetName = "fake" | "sandbox";

export const SANDBOX_VARIABLES = ["META_SANDBOX_TOKEN", "META_SANDBOX_PAGE_TOKEN", "META_SANDBOX_AD_ACCOUNT_ID", "META_SANDBOX_PAGE_ID"] as const;
/**
 * The Conversions API's sandbox half (the Outcome feed's L4): a dataset, the Events Manager "Test events" code,
 * and a lead Meta knows (one the Lead Ads Testing Tool made). Optional for the Publisher's suite; the events
 * readings refuse without them (`readings.ts`).
 */
export const EVENTS_SANDBOX_VARIABLES = ["META_SANDBOX_DATASET_ID", "META_SANDBOX_TEST_EVENT_CODE", "META_SANDBOX_LEAD_ID"] as const;

export interface MetaTarget {
  name: TargetName;
  /** The base the Graph client is pointed at: the proxy, never the target itself. */
  base: string;
  accountId: string;
  pageId: string;
  /** The Conversions API dataset, its test code and a lead it can match; null on a sandbox not given them. */
  datasetId: string | null;
  testEventCode: string | null;
  leadId: string | null;
  /** The client's timeout: short on the in-process fake, a real network's on the sandbox. */
  timeoutMs: number;
  proxy: FaultProxy;
  /** The system user's token, and the Page's, as of now (a revoke changes both). */
  token(): string;
  pageToken(): string;
  revoke(): void;
  close(): Promise<void>;
}

/** Which target this run is against; throws on a value that is neither. */
export function targetName(env: NodeJS.ProcessEnv): TargetName {
  const v = env.ADS_TARGET ?? "fake";
  if (v === "fake" || v === "sandbox") return v;
  throw new Error(`ADS_TARGET=${v} is not a target: use fake (the default) or sandbox`);
}

export async function openMetaTarget(env: NodeJS.ProcessEnv = process.env): Promise<MetaTarget> {
  const name = targetName(env);
  let upstream: string;
  let tokens: { user: string; page: string };
  let ids: { account: string; page: string };
  let events: { dataset: string | null; code: string | null; lead: string | null };
  let fake: FakeMeta | null = null;
  if (name === "sandbox") {
    const missing = SANDBOX_VARIABLES.filter((k) => !env[k]);
    if (missing.length > 0) throw new Error(`ADS_TARGET=sandbox needs ${missing.join(", ")} — the sandbox account Stage 2 connects; refusing rather than running on the fake`);
    upstream = META_GRAPH_BASE;
    tokens = { user: env.META_SANDBOX_TOKEN!, page: env.META_SANDBOX_PAGE_TOKEN! };
    ids = { account: env.META_SANDBOX_AD_ACCOUNT_ID!.replace(/^act_/, ""), page: env.META_SANDBOX_PAGE_ID! };
    events = { dataset: env.META_SANDBOX_DATASET_ID || null, code: env.META_SANDBOX_TEST_EVENT_CODE || null, lead: env.META_SANDBOX_LEAD_ID || null };
  } else {
    tokens = { user: `contract-${randomBytes(12).toString("hex")}`, page: `contract-page-${randomBytes(12).toString("hex")}` };
    ids = { account: "2001", page: "3001" };
    fake = new FakeMeta({
      token: tokens.user,
      accounts: [{ id: ids.account, spend_cap_cents: 300_000, amount_spent_cents: 0, account_status: 1, currency: "USD" }],
      pages: [{ id: ids.page, name: "Contract Page", access_token: tokens.page, tasks: ["ADVERTISE"] }],
    });
    fake.datasets.create("4001");
    // The fake's stand-in for the Lead Ads Testing Tool: one form on the Page and one lead submitted on it, as the
    // owner makes on the sandbox Page (META_SANDBOX_LEAD_ID). The suites read its form from Graph, as on the sandbox.
    const form = (fake.forms.create(ids.page, {
      name: "Contract form", locale: "EN_US", questions: JSON.stringify([{ type: "FULL_NAME", key: "full_name" }, { type: "PHONE", key: "phone_number" }]),
      privacy_policy: JSON.stringify({ url: "https://app.silvicom360.com/privacy" }),
    }).body as { id: string }).id;
    const lead = fake.leads.submit(form, { full_name: "Test Lead", phone_number: "+13125550100" }, new Date(Date.now() - 60_000));
    events = { dataset: "4001", code: "TEST-CONTRACT", lead: lead.id };
    upstream = await fake.start();
  }

  const proxy = new FaultProxy(upstream);
  const base = await proxy.start();
  const original = { ...tokens };
  return {
    name, base, proxy, accountId: ids.account, pageId: ids.page,
    datasetId: events.dataset, testEventCode: events.code, leadId: events.lead,
    timeoutMs: name === "fake" ? 300 : 20_000,
    token: () => tokens.user,
    pageToken: () => tokens.page,
    revoke: () => {
      tokens = { user: `revoked-${tokens.user}`, page: `revoked-${tokens.page}` };
    },
    close: async () => {
      // Straight to the target, past the proxy: cleaning up must not meet a booked fault.
      const graph = new MetaGraph({ token: original.user, throttleKey: "contract-cleanup", baseUrl: upstream, timeoutMs: 20_000, sleep: async () => {} });
      for (const c of proxy.made(/^act_\d+\/campaigns$/)) {
        const id = (c.upstream?.body as { id?: unknown } | null)?.id;
        if (typeof id === "string") await graph.post(id, { status: "DELETED" }, { idempotent: true });
      }
      await proxy.stop();
      await fake?.stop();
    },
  };
}
