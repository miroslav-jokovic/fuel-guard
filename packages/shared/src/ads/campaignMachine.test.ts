import { describe, expect, it } from "vitest";
import { CAMPAIGN_STATES, type CampaignState } from "./contracts.js";
import {
  CAMPAIGN_EVENTS,
  CAMPAIGN_TRANSITIONS,
  campaignEventsFrom,
  isTerminalCampaignState,
  stepCampaign,
  type CampaignActor,
} from "./campaignMachine.js";

/**
 * The machine is finite, so it is enumerated, not sampled (workflow §4R: no fast-check, and none
 * needed): every (state, event, actor) triple is asked, and each answer is held to the RULES the
 * table must keep — not compared with a second copy of the table, which would prove nothing.
 */
const ACTORS: CampaignActor[] = ["agent", "person", "approver", "platform"];
const ALL = CAMPAIGN_STATES.flatMap((s) => CAMPAIGN_EVENTS.flatMap((e) => ACTORS.map((a) => [s, e, a] as const)));

describe("campaignMachine — the table is well formed", () => {
  it("every row names known states and events, and no (state, event) pair appears twice", () => {
    const seen = new Set<string>();
    for (const t of CAMPAIGN_TRANSITIONS) {
      expect(CAMPAIGN_STATES).toContain(t.from);
      expect(CAMPAIGN_STATES).toContain(t.to);
      expect(CAMPAIGN_EVENTS).toContain(t.event);
      expect(t.by.length).toBeGreaterThan(0);
      const key = `${t.from}|${t.event}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
  });

  it("every event is used by at least one row, and every state is reachable from draft", () => {
    for (const e of CAMPAIGN_EVENTS) expect(CAMPAIGN_TRANSITIONS.some((t) => t.event === e), e).toBe(true);
    const reached = new Set<CampaignState>(["draft"]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const t of CAMPAIGN_TRANSITIONS) {
        if (reached.has(t.from) && !reached.has(t.to)) { reached.add(t.to); grew = true; }
      }
    }
    expect([...reached].sort()).toEqual([...CAMPAIGN_STATES].sort());
  });

  it("archived is the only end, and every other state can still reach it", () => {
    const terminal = CAMPAIGN_STATES.filter(isTerminalCampaignState);
    expect(terminal).toEqual(["archived"]);
    for (const start of CAMPAIGN_STATES) {
      const reach = new Set<CampaignState>([start]);
      for (let grew = true; grew; ) {
        grew = false;
        for (const t of CAMPAIGN_TRANSITIONS) if (reach.has(t.from) && !reach.has(t.to)) { reach.add(t.to); grew = true; }
      }
      expect(reach.has("archived"), `${start} can reach archived`).toBe(true);
    }
  });
});

describe("campaignMachine — every (state, event, actor) answered", () => {
  it(`all ${CAMPAIGN_STATES.length * CAMPAIGN_EVENTS.length * ACTORS.length} triples: a row and its actor advance, anything else refuses with the reason`, () => {
    for (const [s, e, a] of ALL) {
      const row = CAMPAIGN_TRANSITIONS.find((t) => t.from === s && t.event === e);
      const step = stepCampaign(s, e, a);
      if (!row) expect(step, `${s} ${e} ${a}`).toEqual({ ok: false, reason: "illegal_transition", from: s, event: e });
      else if (!row.by.includes(a)) expect(step, `${s} ${e} ${a}`).toEqual({ ok: false, reason: "actor_not_allowed", from: s, event: e });
      else expect(step, `${s} ${e} ${a}`).toEqual({ ok: true, transition: row });
    }
  });

  it("delivery starts only by an approver's launch from paused — the one move marked as spending", () => {
    const spending = CAMPAIGN_TRANSITIONS.filter((t) => t.spend);
    expect(spending.map((t) => `${t.from}|${t.event}|${t.by.join("+")}`)).toEqual(["paused|launch|approver"]);
    for (const [s, , a] of ALL) {
      if (a === "approver") continue;
      expect(stepCampaign(s, "launch", a).ok, `${s} launch by ${a}`).toBe(false);
    }
  });

  it("nothing an agent or a person does moves a campaign into launching or live except through launch", () => {
    for (const t of CAMPAIGN_TRANSITIONS) {
      if (t.to !== "launching" && t.to !== "live") continue;
      const legit = (t.event === "launch") || (t.event === "launched" && t.from === "launching")
        || (t.event === "platform_activated" && t.by.every((b) => b === "platform"));
      expect(legit, `${t.from} -${t.event}-> ${t.to}`).toBe(true);
    }
  });

  it("the kill switch is legal in every state, and never leaves a campaign delivering", () => {
    for (const s of CAMPAIGN_STATES) {
      const step = stepCampaign(s, "kill", "person");
      expect(step.ok, s).toBe(true);
      if (step.ok) expect(["launching", "live"]).not.toContain(step.transition.to);
    }
    expect(stepCampaign("live", "kill", "agent")).toMatchObject({ ok: true, transition: { to: "pausing" } });
    expect(stepCampaign("launching", "kill", "person")).toMatchObject({ ok: true, transition: { to: "pausing" } });
  });

  it("pausing is open to the agent and a person wherever delivery can happen", () => {
    for (const s of ["launching", "live"] as const) {
      for (const a of ["agent", "person"] as const) expect(stepCampaign(s, "pause", a).ok, `${s} ${a}`).toBe(true);
    }
  });

  it("a creative set is approved, and a failure is left, only by a person", () => {
    expect(stepCampaign("review", "creatives_approved", "agent")).toMatchObject({ ok: false, reason: "actor_not_allowed" });
    expect(stepCampaign("review", "creatives_approved", "person").ok).toBe(true);
    expect(stepCampaign("failed", "resume_create", "agent")).toMatchObject({ ok: false, reason: "actor_not_allowed" });
    expect(stepCampaign("failed", "resume_create", "person")).toMatchObject({ ok: true, transition: { to: "creating" } });
  });

  it("a live campaign cannot be archived until it is paused — nothing is torn down while it delivers", () => {
    expect(stepCampaign("live", "archive", "person")).toMatchObject({ ok: false, reason: "illegal_transition" });
    expect(stepCampaign("paused", "archive", "agent")).toMatchObject({ ok: true, transition: { to: "archived" } });
  });

  it("campaignEventsFrom lists exactly the rows leaving a state", () => {
    for (const s of CAMPAIGN_STATES) {
      expect(campaignEventsFrom(s)).toEqual(CAMPAIGN_TRANSITIONS.filter((t) => t.from === s));
    }
  });
});
