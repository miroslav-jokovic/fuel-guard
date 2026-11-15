import { describe, expect, it } from "vitest";
import {
  PLAN_ANGLES_MIN, PLAN_FORMATS, PLAN_FORMATS_BUILT, campaignPlanSchema, checkPlan, evidencePackSchema, jobEvidence,
  type CampaignPlan, type EvidencePack, type PlanAngle,
} from "./campaignPlan.js";
import type { AdBrief } from "./contracts.js";

// The opening: $0.68 a mile, home every 14 days, 1 year of experience, a 401k; flatbed, Midwest lanes.
const brief: Pick<AdBrief, "subject" | "claims" | "subject_matter"> = {
  subject: "Class A regional driver",
  claims: [
    { kind: "money", cents: 68, per: "mile" },
    { kind: "quantity", value: 14, unit: "day" },
    { kind: "quantity", value: 1, unit: "year" },
    { kind: "term", term: "401k" },
  ],
  subject_matter: { details: ["flatbed", "Midwest lanes"], in_our_words: "A small fleet where dispatch knows your name" },
};
const pack: EvidencePack = [
  ...jobEvidence(brief),
  { id: "our_result:p2_cost", kind: "our_result", text: "The pay-first ad brought leads at the lowest cost last month.", source: null },
  { id: "swipe:rival_a", kind: "swipe", text: "A rival's ad leads with a sign-on bonus over a parked truck.", source: "https://example.com/ad" },
];

const angle = (over: Partial<PlanAngle>): PlanAngle => ({
  hook_family: "pay_first", scene_family: "equipment_on_road", format: "still",
  idea: "Lead with the pay per mile, stated plainly.",
  proof: "The opening's own pay figure and its 401k.",
  why: "Pay is the first thing a driver compares between carriers.",
  evidence: ["job:claim_1"],
  ...over,
});
const plan = (angles: PlanAngle[], over: Partial<CampaignPlan> = {}): CampaignPlan => ({
  audience: "Experienced regional drivers who want steady miles and a predictable week.",
  audience_evidence: ["job:subject"],
  angles,
  ...over,
});
const sound = plan([
  angle({}),
  angle({ hook_family: "life_first", scene_family: "home_street", idea: "Lead with being home on a schedule you can plan.", evidence: ["job:claim_2"] }),
  angle({ hook_family: "equipment_first", scene_family: "equipment_at_rest", idea: "Lead with the flatbed work and the lanes.", evidence: ["job:detail_1", "swipe:rival_a"] }),
]);
const kinds = (p: CampaignPlan) => checkPlan(p, pack, brief).map((f) => f.kind);

describe("checkPlan — a plan that rests on the job passes", () => {
  it("three angles that differ in kind, each citing a fact of the job, have no finding", () => {
    expect(campaignPlanSchema.safeParse(sound).success).toBe(true);
    expect(checkPlan(sound, pack, brief)).toEqual([]);
  });
});

describe("checkPlan — what it refuses", () => {
  it("an evidence id the pack does not hold is named, with where it was cited", () => {
    const p = plan([angle({ evidence: ["job:claim_1", "market:made_up"] }), ...sound.angles.slice(1)]);
    expect(checkPlan(p, pack, brief)).toEqual([{ kind: "unknown_evidence", where: "angle 1", id: "market:made_up" }]);
    expect(kinds(plan(sound.angles, { audience_evidence: ["job:nope"] }))).toEqual(["unknown_evidence"]);
  });

  it("an angle that cites only what others do, and nothing of the job, is refused", () => {
    const p = plan([angle({ evidence: ["swipe:rival_a", "our_result:p2_cost"] }), ...sound.angles.slice(1)]);
    expect(checkPlan(p, pack, brief)).toEqual([{ kind: "no_job_evidence", where: "angle 1" }]);
  });

  it("two angles with the same hook and scene are one concept twice", () => {
    const p = plan([...sound.angles, angle({ idea: "Lead with the pay again, worded differently." })]);
    expect(checkPlan(p, pack, brief)).toEqual([{ kind: "same_kind", where: "angle 4", other: "angle 1" }]);
  });

  it("the same hook over a different scene is a different concept", () => {
    expect(kinds(plan([...sound.angles, angle({ scene_family: "cab_pov" })]))).toEqual([]);
  });

  it("a format no worker can make yet is refused, and still is the only one built", () => {
    expect(PLAN_FORMATS_BUILT).toEqual(["still"]);
    for (const format of PLAN_FORMATS.filter((f) => f !== "still")) {
      const p = plan([angle({ format }), ...sound.angles.slice(1)]);
      expect(checkPlan(p, pack, brief)).toEqual([{ kind: "format_not_built", where: "angle 1", format }]);
    }
  });

  it("a figure in the plan's own words that the opening does not state is refused", () => {
    const p = plan([angle({ idea: "Lead with $0.80 per mile, the best in the region." }), ...sound.angles.slice(1)]);
    const found = checkPlan(p, pack, brief);
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((f) => f.kind === "claim" && f.where === "angle 1 idea")).toBe(true);
  });

  it("the opening's own figure in the plan's words is allowed", () => {
    expect(kinds(plan([angle({ idea: "Lead with $0.68 per mile, stated plainly." }), ...sound.angles.slice(1)]))).toEqual([]);
  });

  it("an audience described by age is refused like copy would be", () => {
    const found = checkPlan(plan(sound.angles, { audience: "Young drivers under 30 who want steady regional miles." }), pack, brief);
    expect(found.some((f) => f.kind === "claim" && f.where === "audience")).toBe(true);
  });
});

describe("the plan's shape", () => {
  it(`fewer than ${PLAN_ANGLES_MIN} angles is not a plan`, () => {
    expect(campaignPlanSchema.safeParse(plan(sound.angles.slice(0, PLAN_ANGLES_MIN - 1))).success).toBe(false);
  });

  it("an angle must cite at least one piece of evidence", () => {
    expect(campaignPlanSchema.safeParse(plan([angle({ evidence: [] }), ...sound.angles.slice(1)])).success).toBe(false);
  });
});

describe("the evidence pack", () => {
  it("the job's facts become one item per claim and per detail, with stable ids", () => {
    const items = jobEvidence(brief);
    expect(items.map((e) => e.id)).toEqual(["job:subject", "job:claim_1", "job:claim_2", "job:claim_3", "job:claim_4", "job:detail_1", "job:detail_2", "job:in_our_words"]);
    expect(items[1]!.text).toBe("The opening pays $0.68 per mile.");
    expect(items[2]!.text).toBe("The opening states 14 days.");
    expect(items[3]!.text).toBe("The opening states 1 year.");
    expect(items[4]!.text).toBe("The opening offers: 401k.");
    expect(evidencePackSchema.safeParse(items).success).toBe(true);
    expect(jobEvidence(brief)).toEqual(items);
  });

  it("an id must start with its item's kind, and ids are unique", () => {
    expect(evidencePackSchema.safeParse([{ id: "job:x", kind: "swipe", text: "An ad.", source: null }]).success).toBe(false);
    expect(evidencePackSchema.safeParse([pack[0], pack[0]]).success).toBe(false);
  });

  it("a source is an https address or nothing", () => {
    expect(evidencePackSchema.safeParse([{ id: "market:pay", kind: "market", text: "A pay figure.", source: "http://example.com" }]).success).toBe(false);
  });
});
