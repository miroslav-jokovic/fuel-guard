import { describe, expect, it } from "vitest";
import { jobEvidence, planFormatsFor, type AdBrief, type CampaignPlan, type EvidencePack, type PlanAngle, type PlanOffer } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { latestPlan, planById, storeAgentPlan, storePersonPlan, type PlanRow } from "./planStore.js";

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CAMPAIGN = "c-1";

const brief: Pick<AdBrief, "subject" | "claims" | "subject_matter"> = {
  subject: "Class A regional driver",
  claims: [{ kind: "money", cents: 68, per: "mile" }, { kind: "quantity", value: 14, unit: "day" }, { kind: "term", term: "401k" }],
  subject_matter: { details: ["flatbed", "Midwest lanes"], in_our_words: "A small fleet where dispatch knows your name" },
};
const evidence: EvidencePack = jobEvidence(brief);
const angle = (over: Partial<PlanAngle>): PlanAngle => ({
  hook_family: "pay_first", scene_family: "equipment_on_road", format: "still",
  idea: "Lead with the pay per mile, stated plainly.", proof: "The opening's own pay figure and its 401k.",
  why: "Pay is the first thing a driver compares between carriers.", evidence: ["job:claim_1"], ...over,
});
const sound: CampaignPlan = {
  audience: "Experienced regional drivers who want steady miles and a predictable week.",
  audience_evidence: ["job:subject"],
  angles: [
    angle({}),
    angle({ hook_family: "life_first", scene_family: "home_street", idea: "Lead with being home on a schedule you can plan.", evidence: ["job:claim_2"] }),
    angle({ hook_family: "equipment_first", scene_family: "equipment_at_rest", idea: "Lead with the flatbed work and the lanes.", evidence: ["job:detail_1"] }),
  ],
};
const stored = (over: Partial<PlanRow>): PlanRow => ({
  id: "p-1", campaign_id: CAMPAIGN, version: 1, plan: sound, evidence, author_kind: "agent", generation_id: "g-1", author_id: null, author_name: null, created_at: "2026-11-15T18:00:00+00:00", ...over,
});

const isWrite = (q: RecordedQuery) => q.write !== null;
const asksGeneration = (q: RecordedQuery) => q.filters().some((f) => f.col === "generation_id");

/** `rows` is what the table holds; an insert answers the row it was asked to write, with an id. */
function world(rows: PlanRow[], opts: { writeError?: unknown; afterWrite?: PlanRow[] } = {}) {
  let wrote = false;
  const rec = createSupabaseRecorder({
    tables: {
      ads_campaign_plans: (q) => {
        if (isWrite(q)) {
          wrote = true;
          return opts.writeError ? { data: null, writeError: opts.writeError } : [{ ...stored({}), ...(q.write!.payload as object), id: "p-new" }];
        }
        const held = wrote && opts.afterWrite ? opts.afterWrite : rows;
        if (asksGeneration(q)) return held.filter((r) => r.generation_id === q.filters().find((f) => f.col === "generation_id")!.val);
        if (q.filters().some((f) => f.col === "id")) return held.filter((r) => r.id === q.filters().find((f) => f.col === "id")!.val);
        return [...held].sort((a, b) => b.version - a.version);
      },
    },
  });
  return rec;
}
/** The carrier can make exactly the sound plan's three kinds of ad. */
const concepts = sound.angles.map((a) => ({ hook_family: a.hook_family, scene_family: a.scene_family }));
/** What the campaign is offered: those three kinds, in a still alone (no video model). */
const offer: PlanOffer = { concepts, formats: planFormatsFor({ videoModel: null }) };
const agentInput = (over: Partial<Parameters<typeof storeAgentPlan>[1]> = {}) => ({ orgId: ORG, campaignId: CAMPAIGN, generationId: "g-1", plan: sound, evidence, brief, offer, ...over });
const personInput = (over: Partial<Parameters<typeof storePersonPlan>[1]> = {}) => ({ orgId: ORG, campaignId: CAMPAIGN, basedOnVersion: 1, author: { id: "u-1", name: "Koni" }, plan: sound, brief, offer, ...over });

describe("storeAgentPlan", () => {
  it("writes the Strategist's plan as version 1 with its evidence and its generation, naming the org", async () => {
    const rec = world([]);
    const out = await storeAgentPlan(rec.client, agentInput());
    expect(out).toMatchObject({ kind: "stored", replayed: false, plan: { id: "p-new", version: 1 } });
    expect(rec.writtenRows("ads_campaign_plans")).toEqual([{ org_id: ORG, campaign_id: CAMPAIGN, version: 1, plan: sound, evidence, author_kind: "agent", generation_id: "g-1" }]);
    expectOrgScoped(rec, ORG);
  });

  it("after a replan the agent's plan is the next version, not a second version 1", async () => {
    const rec = world([stored({}), stored({ id: "p-2", version: 2, author_kind: "person", generation_id: null, author_id: "u-1", author_name: "Koni" })]);
    await storeAgentPlan(rec.client, agentInput({ generationId: "g-2" }));
    expect(rec.writtenRows("ads_campaign_plans")[0]).toMatchObject({ version: 3, generation_id: "g-2" });
  });

  it("the step's second run finds the first run's row and writes nothing", async () => {
    const rec = world([stored({})]);
    expect(await storeAgentPlan(rec.client, agentInput())).toEqual({ kind: "stored", plan: stored({}), replayed: true });
    expect(rec.writes()).toEqual([]);
    // The generation is looked for inside this campaign: an id is never trusted across campaigns.
    expect(rec.forTable("ads_campaign_plans")[0]!.filters()).toEqual(expect.arrayContaining([{ col: "campaign_id", val: CAMPAIGN }, { col: "generation_id", val: "g-1" }]));
  });

  it("losing the race for the version to its own other run answers with the winner's row", async () => {
    const rec = world([], { writeError: { code: "23505", message: "duplicate key" }, afterWrite: [stored({})] });
    expect(await storeAgentPlan(rec.client, agentInput())).toEqual({ kind: "stored", plan: stored({}), replayed: true });
  });

  it("losing the race to a different writer throws, so the step runs again", async () => {
    const rec = world([], { writeError: { code: "23505", message: "duplicate key" }, afterWrite: [stored({ generation_id: "g-other" })] });
    await expect(storeAgentPlan(rec.client, agentInput())).rejects.toThrow(/taken by another writer/);
  });

  it("any other write error throws with the table's name", async () => {
    const rec = world([], { writeError: { code: "23503", message: "no such generation" } });
    await expect(storeAgentPlan(rec.client, agentInput())).rejects.toThrow("ads_campaign_plans insert: no such generation");
  });

  it("a plan with a finding is refused whole and nothing is read or written", async () => {
    const rec = world([]);
    const twice = { ...sound, angles: [sound.angles[0]!, sound.angles[0]!, sound.angles[2]!] };
    expect(await storeAgentPlan(rec.client, agentInput({ plan: twice }))).toEqual({ kind: "refused", off_schema: null, findings: [{ kind: "same_kind", where: "angle 2", other: "angle 1" }] });
    const invented = { ...sound, angles: [angle({ evidence: ["job:claim_1", "market:made_up"] }), ...sound.angles.slice(1)] };
    expect(await storeAgentPlan(rec.client, agentInput({ plan: invented }))).toMatchObject({ kind: "refused", findings: [{ kind: "unknown_evidence", id: "market:made_up" }] });
    expect(rec.queries).toEqual([]);
  });

  it("an answer that is not a plan, or a pack that is not a pack, is refused as off schema", async () => {
    const rec = world([]);
    expect(await storeAgentPlan(rec.client, agentInput({ plan: { ...sound, angles: sound.angles.slice(0, 2) } }))).toMatchObject({ kind: "refused", findings: [], off_schema: expect.stringMatching(/^plan: /) });
    expect(await storeAgentPlan(rec.client, agentInput({ evidence: [...evidence, evidence[0]] }))).toMatchObject({ kind: "refused", findings: [], off_schema: "evidence: evidence ids are unique" });
    expect(rec.queries).toEqual([]);
  });
});

describe("storePersonPlan", () => {
  const edited: CampaignPlan = { ...sound, audience: "Regional flatbed drivers who are tired of unpredictable weeks away." };

  it("writes a person's edit as the next version, on the evidence of the version they edited", async () => {
    const rec = world([stored({})]);
    const out = await storePersonPlan(rec.client, personInput({ plan: edited }));
    expect(out).toMatchObject({ kind: "stored", replayed: false, plan: { version: 2 } });
    expect(rec.writtenRows("ads_campaign_plans")).toEqual([{ org_id: ORG, campaign_id: CAMPAIGN, version: 2, plan: edited, evidence, author_kind: "person", author_id: "u-1", author_name: "Koni" }]);
    expectOrgScoped(rec, ORG);
  });

  it("an edit of a version that is no longer the newest is stale, and so is an edit of a campaign never planned", async () => {
    const moved = world([stored({}), stored({ id: "p-2", version: 2 })]);
    expect(await storePersonPlan(moved.client, personInput())).toEqual({ kind: "stale", latest: 2 });
    expect(await storePersonPlan(world([]).client, personInput())).toEqual({ kind: "stale", latest: null });
    expect(moved.writes()).toEqual([]);
  });

  it("two people saving at once: the second is told the plan moved", async () => {
    const rec = world([stored({})], { writeError: { code: "23505", message: "duplicate key" }, afterWrite: [stored({}), stored({ id: "p-2", version: 2 })] });
    expect(await storePersonPlan(rec.client, personInput({ plan: edited }))).toEqual({ kind: "stale", latest: 2 });
  });

  it("a person's edit is held to the same check as the model's: a figure the opening does not hold is refused", async () => {
    const rec = world([stored({})]);
    const out = await storePersonPlan(rec.client, personInput({ plan: { ...sound, audience: "Drivers who want $0.80 a mile and a predictable week at home." } }));
    expect(out).toMatchObject({ kind: "refused", findings: [{ kind: "claim", where: "audience" }] });
    expect(rec.writes()).toEqual([]);
  });

  it("a person's edit cannot cite evidence the edited version's pack does not hold", async () => {
    const rec = world([stored({})]);
    const out = await storePersonPlan(rec.client, personInput({ plan: { ...sound, audience_evidence: ["swipe:mine"] } }));
    expect(out).toMatchObject({ kind: "refused", findings: [{ kind: "unknown_evidence", where: "audience", id: "swipe:mine" }] });
  });
});

describe("the store holds a plan to the kinds of ad the carrier can make", () => {
  it("the agent's and a person's plan are both refused for an angle no enabled preset can make", async () => {
    const fewer = concepts.slice(0, 2);
    expect(await storeAgentPlan(world([]).client, agentInput({ offer: { ...offer, concepts: fewer } }))).toMatchObject({ kind: "refused", findings: [{ kind: "concept_not_available", where: "angle 3" }] });
    const rec = world([stored({})]);
    expect(await storePersonPlan(rec.client, personInput({ offer: { ...offer, concepts: fewer } }))).toMatchObject({ kind: "refused", findings: [{ kind: "concept_not_available", where: "angle 3" }] });
    expect(rec.writes()).toEqual([]);
  });
});

describe("reading a plan", () => {
  it("latestPlan asks for the highest version of this org's campaign", async () => {
    const rec = world([stored({}), stored({ id: "p-2", version: 2 })]);
    expect((await latestPlan(rec.client, ORG, CAMPAIGN))!.version).toBe(2);
    expect(rec.forTable("ads_campaign_plans")[0]!.ops).toContainEqual({ method: "order", args: ["version", { ascending: false }] });
    expect(await latestPlan(world([]).client, ORG, CAMPAIGN)).toBeNull();
    expectOrgScoped(rec, ORG);
  });

  it("planById names the campaign as well as the plan, so another campaign's plan id finds nothing", async () => {
    const rec = world([stored({})]);
    expect((await planById(rec.client, ORG, CAMPAIGN, "p-1"))!.id).toBe("p-1");
    expect(rec.forTable("ads_campaign_plans")[0]!.filters()).toEqual(expect.arrayContaining([{ col: "org_id", val: ORG }, { col: "campaign_id", val: CAMPAIGN }, { col: "id", val: "p-1" }]));
    expect(await planById(rec.client, ORG, CAMPAIGN, "p-none")).toBeNull();
  });
});

describe("the store holds a plan to the formats its campaign can be made in", () => {
  const moving: CampaignPlan = { ...sound, angles: [angle({ format: "motion" }), ...sound.angles.slice(1)] };
  const withVideo: PlanOffer = { ...offer, formats: planFormatsFor({ videoModel: "simulator/video" }) };

  it("the agent's and a person's motion angle are both refused for a campaign with no video model", async () => {
    expect(await storeAgentPlan(world([]).client, agentInput({ plan: moving }))).toMatchObject({ kind: "refused", findings: [{ kind: "format_not_built", where: "angle 1", format: "motion" }] });
    const rec = world([stored({})]);
    expect(await storePersonPlan(rec.client, personInput({ plan: moving }))).toMatchObject({ kind: "refused", findings: [{ kind: "format_not_built", where: "angle 1", format: "motion" }] });
    expect(rec.writes()).toEqual([]);
  });

  it("the same plan is stored for a campaign that has one", async () => {
    expect(await storeAgentPlan(world([]).client, agentInput({ plan: moving, offer: withVideo }))).toMatchObject({ kind: "stored" });
    expect(await storePersonPlan(world([stored({})]).client, personInput({ plan: moving, offer: withVideo }))).toMatchObject({ kind: "stored", plan: { version: 2 } });
  });
});
