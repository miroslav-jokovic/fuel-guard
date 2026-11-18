import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_STATES_AWAITING_PERSON, foldNeedsYou, ledgerCursor, ledgerEntry, parseLedgerCursor, pausedReading,
  type NeedsYouInput, type TransitionRow,
} from "./adsOverview.js";
import type { AdsHealthConnection } from "./adsHealth.js";

const T = "2026-11-18T15:00:00.123456+00:00";
const row = (event: string, actor_kind = "agent", actor_name = "Orchestrator", cause: string | null = null, started_at = T): TransitionRow =>
  ({ event, actor_kind, actor_name, cause, started_at });

const BASE: NeedsYouInput = {
  kill_switch: { on: false, reason: null }, caps: [], connections: [], campaigns: [], ready_ads: new Map(), paused: new Map(),
};
const conn = (over: Partial<AdsHealthConnection>): AdsHealthConnection => ({
  id: "c1", provider: "meta", is_sandbox: false, status: "connected", last_test_at: T, last_error: null,
  token: { expiry: null, days_left: 30, tone: "ok", words: "Expires in 30 days." }, ...over,
});

describe("CAMPAIGN_STATES_AWAITING_PERSON", () => {
  it("the states that wait on a person are the machine's", () => {
    // plan_review (approve or replan), review (approve or regenerate), paused (only an approver launches), failed
    // (leaving a failure is a person's act). `approved` is not: the agent may create it paused.
    expect(CAMPAIGN_STATES_AWAITING_PERSON).toEqual(["failed", "paused", "plan_review", "review"]);
  });
});

describe("pausedReading", () => {
  it("a campaign created paused and never launched waits for an approver", () => {
    expect(pausedReading([row("created"), row("create_paused")])).toMatchObject({ waits: true, kind: "ready_to_launch" });
  });

  it("a person's pause is a decision already made: not listed", () => {
    expect(pausedReading([row("paused"), row("pause", "person", "Dana")])).toEqual({ waits: false });
    expect(pausedReading([row("paused"), row("kill", "person", "Dana")])).toEqual({ waits: false });
  });

  it("a rule's pause, the platform's pause or rejection, and a failed launch wait on a person, with the row's reason", () => {
    expect(pausedReading([row("paused"), row("pause", "agent", "Monitor", "cost per lead over the cap")]))
      .toMatchObject({ waits: true, kind: "paused_not_by_person", detail: "Paused by Monitor: cost per lead over the cap" });
    expect(pausedReading([row("platform_rejected", "platform", "Meta", "policy")])).toMatchObject({ waits: true, detail: "The platform rejected it: policy" });
    expect(pausedReading([row("platform_paused", "platform", "Meta")])).toMatchObject({ waits: true });
    expect(pausedReading([row("launch_failed", "agent", "Orchestrator", "OAuthException")])).toMatchObject({ waits: true, detail: "The launch failed: OAuthException" });
  });

  it("no transition row at all is listed, never hidden", () => {
    expect(pausedReading([])).toMatchObject({ waits: true, since: null });
  });
});

describe("foldNeedsYou", () => {
  it("lists what stops spend first, then decisions oldest first", () => {
    const items = foldNeedsYou({
      ...BASE,
      kill_switch: { on: true, reason: "Owner stopped everything" },
      caps: [{ platform: "meta", cap_cents: null }, { platform: "simulator", cap_cents: 10_000 }],
      connections: [conn({ id: "ok" }), conn({ id: "warn", token: { expiry: null, days_left: 5, tone: "warn", words: "Expires in 5 days." } }), conn({ id: "bad", status: "failing", last_error: "token_invalid" })],
      campaigns: [
        { id: "k1", name: "Review newer", state: "review", state_changed_at: "2026-11-17T00:00:00Z" },
        { id: "k2", name: "Plan older", state: "plan_review", state_changed_at: "2026-11-10T00:00:00Z" },
        { id: "k3", name: "Live one", state: "live", state_changed_at: "2026-11-01T00:00:00Z" },
        { id: "k4", name: "Stopped", state: "failed", state_changed_at: "2026-11-16T00:00:00Z" },
        { id: "k5", name: "Paused by Dana", state: "paused", state_changed_at: "2026-11-02T00:00:00Z" },
      ],
      ready_ads: new Map([["k1", 3]]),
      paused: new Map([["k5", { waits: false } as const]]),
    });
    expect(items.map((i) => [i.kind, i.tone, i.campaign_id ?? i.connection_id])).toEqual([
      // Undated items (the switch, a missing cap) lead their tone: they have no "since" to wait behind.
      ["kill_switch_on", "bad", null],
      ["failed", "bad", "k4"],
      ["connection", "bad", "bad"],
      ["no_monthly_cap", "warn", null],
      ["plan_review", "warn", "k2"],
      ["ads_review", "warn", "k1"],
      ["connection", "warn", "warn"],
    ]);
    expect(items.find((i) => i.kind === "ads_review")!.detail).toBe("3 ads ready for your review.");
    expect(items[0]!.detail).toBe("Owner stopped everything");
  });

  it("a paused campaign with no reading yet is listed", () => {
    const items = foldNeedsYou({ ...BASE, campaigns: [{ id: "p", name: "P", state: "paused", state_changed_at: T }] });
    expect(items.map((i) => i.kind)).toEqual(["paused_not_by_person"]);
  });
});

describe("the ledger", () => {
  it("a transition carries its move from the row's own request; a campaign is named from the map", () => {
    const e = ledgerEntry({
      id: "a1", kind: "transition", status: "succeeded", actor_kind: "person", actor_name: "Dana", campaign_id: "k1", cause: null,
      error_code: null, request: { from: "plan_review", event: "plan_approved" }, started_at: T, finished_at: T,
    }, new Map([["k1", "CDL-A Dallas"]]));
    expect(e).toMatchObject({ campaign_name: "CDL-A Dallas", from_state: "plan_review", event: "plan_approved" });
    const other = ledgerEntry({ ...e, kind: "pause", request: { from: "x", event: "y" } } as never, new Map());
    expect([other.from_state, other.event, other.campaign_name]).toEqual([null, null, null]);
  });

  it("the cursor round-trips the timestamp exactly as Postgres wrote it, microseconds included", () => {
    const id = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
    expect(parseLedgerCursor(ledgerCursor({ started_at: T, id }))).toEqual({ started_at: T, id });
  });

  it("the cursor refuses anything that could reach the filter as more than a timestamp and an id", () => {
    const id = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
    for (const bad of [
      "", "x", `${T}`, `${T}|not-a-uuid`, `${T}|${id}|extra`,
      `2026-11-18T15:00:00Z",id.gt.0|${id}`, `2026-11-18|${id}`, `${T}|${id}),or(org_id.neq.x`,
    ]) expect(parseLedgerCursor(bad), bad).toBeNull();
  });
});
