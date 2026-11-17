import { describe, expect, it } from "vitest";
import {
  PLAN_ANGLES_MIN, PLAN_FORMATS, PLAN_FORMATS_BUILT, campaignPlanSchema, checkPlan, planFormatsFor, distinctConcepts, evidencePackSchema, jobEvidence, planDraw, planFindingWords, angleFormat, writerAngle,
  type CampaignPlan, type EvidencePack, type PlanAngle,
} from "./campaignPlan.js";
import type { AdBrief } from "./contracts.js";

// The opening: $0.68 a mile, home every 14 days, 1 year of experience, a 401k; flatbed, Midwest lanes.
/** What a campaign with no video model is offered (`planFormatsFor`'s own answer, so the tests cannot drift from it). */
const STILL = planFormatsFor({ videoModel: null });

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
const kinds = (p: CampaignPlan) => checkPlan(p, pack, brief, { formats: STILL }).map((f) => f.kind);

describe("checkPlan — a plan that rests on the job passes", () => {
  it("three angles that differ in kind, each citing a fact of the job, have no finding", () => {
    expect(campaignPlanSchema.safeParse(sound).success).toBe(true);
    expect(checkPlan(sound, pack, brief, { formats: STILL })).toEqual([]);
  });
});

describe("checkPlan — what it refuses", () => {
  it("an evidence id the pack does not hold is named, with where it was cited", () => {
    const p = plan([angle({ evidence: ["job:claim_1", "market:made_up"] }), ...sound.angles.slice(1)]);
    expect(checkPlan(p, pack, brief, { formats: STILL })).toEqual([{ kind: "unknown_evidence", where: "angle 1", id: "market:made_up" }]);
    expect(kinds(plan(sound.angles, { audience_evidence: ["job:nope"] }))).toEqual(["unknown_evidence"]);
  });

  it("an angle that cites only what others do, and nothing of the job, is refused", () => {
    const p = plan([angle({ evidence: ["swipe:rival_a", "our_result:p2_cost"] }), ...sound.angles.slice(1)]);
    expect(checkPlan(p, pack, brief, { formats: STILL })).toEqual([{ kind: "no_job_evidence", where: "angle 1" }]);
  });

  it("two angles with the same hook and scene are one concept twice", () => {
    const p = plan([...sound.angles, angle({ idea: "Lead with the pay again, worded differently." })]);
    expect(checkPlan(p, pack, brief, { formats: STILL })).toEqual([{ kind: "same_kind", where: "angle 4", other: "angle 1" }]);
  });

  it("the same hook over a different scene is a different concept", () => {
    expect(kinds(plan([...sound.angles, angle({ scene_family: "cab_pov" })]))).toEqual([]);
  });

  it("a format the campaign is not offered is refused, whichever it is", () => {
    for (const format of PLAN_FORMATS.filter((f) => f !== "still")) {
      const p = plan([angle({ format }), ...sound.angles.slice(1)]);
      expect(checkPlan(p, pack, brief, { formats: STILL })).toEqual([{ kind: "format_not_built", where: "angle 1", format }]);
    }
  });

  it("a motion angle passes where motion is offered, and a still is refused where only motion is", () => {
    const p = plan([angle({ format: "motion" }), ...sound.angles.slice(1)]);
    expect(checkPlan(p, pack, brief, { formats: ["still", "motion"] })).toEqual([]);
    expect(checkPlan(p, pack, brief, { formats: ["motion"] }).map((f) => `${f.where}:${f.kind}`)).toEqual(["angle 2:format_not_built", "angle 3:format_not_built"]);
  });

  it("a figure in the plan's own words that the opening does not state is refused", () => {
    const p = plan([angle({ idea: "Lead with $0.80 per mile, the best in the region." }), ...sound.angles.slice(1)]);
    const found = checkPlan(p, pack, brief, { formats: STILL });
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((f) => f.kind === "claim" && f.where === "angle 1 idea")).toBe(true);
  });

  it("the opening's own figure in the plan's words is allowed", () => {
    expect(kinds(plan([angle({ idea: "Lead with $0.68 per mile, stated plainly." }), ...sound.angles.slice(1)]))).toEqual([]);
  });

  it("an audience described by age is refused like copy would be", () => {
    const found = checkPlan(plan(sound.angles, { audience: "Young drivers under 30 who want steady regional miles." }), pack, brief, { formats: STILL });
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

describe("checkPlan — an angle must be a kind of ad the carrier can make", () => {
  const concepts = sound.angles.map((a) => ({ hook_family: a.hook_family, scene_family: a.scene_family }));

  it("a plan whose every angle is an available concept has no finding", () => {
    expect(checkPlan(sound, pack, brief, { formats: STILL, concepts })).toEqual([]);
  });

  it("an angle whose hook and scene no enabled preset has is refused, and said in a sentence", () => {
    const found = checkPlan(sound, pack, brief, { formats: STILL, concepts: concepts.slice(0, 2) });
    expect(found).toEqual([{ kind: "concept_not_available", where: "angle 3" }]);
    expect(planFindingWords(found[0]!)).toBe("angle 3 uses a hook and scene that is not one of the concepts on the sheet.");
  });

  it("with no concepts given the question is not asked; with an empty list every angle is refused", () => {
    expect(checkPlan(sound, pack, brief, { formats: STILL })).toEqual([]);
    expect(checkPlan(sound, pack, brief, { formats: STILL, concepts: [] }).map((f) => f.kind)).toEqual(["concept_not_available", "concept_not_available", "concept_not_available"]);
  });
});

describe("distinctConcepts", () => {
  it("gives each hook and scene pair once, in the order first met, and nothing for a preset that names no concept", () => {
    expect(distinctConcepts([
      { hook_family: "pay_first", scene_family: "cab_pov" }, { hook_family: "pay_first", scene_family: "cab_pov" },
      { hook_family: "life_first" }, { hook_family: "nonsense", scene_family: "cab_pov" }, {},
      { hook_family: "proof", scene_family: "abstract_plate" },
    ])).toEqual([{ hook_family: "pay_first", scene_family: "cab_pov" }, { hook_family: "proof", scene_family: "abstract_plate" }]);
  });
});

describe("planDraw — a planned campaign's ads are the plan's angles, in the plan's order", () => {
  const preset = (key: string, hook_family: string, scene_family: string, enabled = true) => ({ version_id: `v-${key}`, key, enabled, hook_family, scene_family });
  const presets = [
    preset("P1", "equipment_first", "equipment_at_rest"), preset("P2", "pay_first", "equipment_on_road"),
    preset("P3", "life_first", "home_street"), preset("P4", "proof", "abstract_plate"),
  ];

  it("orders the presets as the plan orders its angles, not as the presets are keyed, and names the plan as its seed", () => {
    expect(planDraw("plan-9", sound, presets, [])).toEqual({ seed: "plan:plan-9", eligible: ["v-P1", "v-P2", "v-P3"], excluded_live: [], order: ["v-P2", "v-P3", "v-P1"], exhausted: false });
  });

  it("leaves out a preset a campaign for the same brief already runs, and says which", () => {
    expect(planDraw("p", sound, presets, ["P3"])).toMatchObject({ order: ["v-P2", "v-P1"], excluded_live: ["P3"], exhausted: false });
  });

  it("an angle whose preset was disabled since the plan was approved is not drawn; with none left the draw is exhausted", () => {
    const off = presets.map((p) => (p.key === "P2" ? { ...p, enabled: false } : p));
    expect(planDraw("p", sound, off, []).order).toEqual(["v-P3", "v-P1"]);
    expect(planDraw("p", sound, [], [])).toMatchObject({ order: [], exhausted: true });
  });

  it("an idea is matched by its lead AND its picture: a preset with the same lead and another picture is not it", () => {
    // P0 sorts first and shares the first angle's lead (pay first) with a different picture.
    const sameLead = [preset("P0", "pay_first", "cab_pov"), ...presets];
    expect(planDraw("p", sound, sameLead, []).order).toEqual(["v-P2", "v-P3", "v-P1"]);
  });

  it("two presets with one concept: the first by key is taken whatever order the rows arrive in", () => {
    const twin = [preset("P9", "pay_first", "equipment_on_road"), ...presets];
    expect(planDraw("p", sound, twin, []).order[0]).toBe("v-P2");
    expect(planDraw("p", sound, [...twin].reverse(), []).order[0]).toBe("v-P2");
  });
});

describe("angleFormat — what is made from a preset's ad", () => {
  it("is the format of the plan's angle with the preset's hook and scene, and null when the plan has no such angle", () => {
    const moving = { angles: sound.angles.map((a, i) => ({ ...a, format: i === 1 ? "motion" as const : a.format })) };
    expect(moving.angles.map((a) => angleFormat(moving, a))).toEqual(moving.angles.map((a) => a.format));
    expect(angleFormat(moving, moving.angles[1]!)).toBe("motion");
    expect(angleFormat(moving, { hook_family: moving.angles[0]!.hook_family, scene_family: "no_such_scene" })).toBeNull();
    expect(angleFormat(moving, {})).toBeNull();
  });
});

describe("writerAngle — the idea a preset's ad is written from", () => {
  it("is the idea and the proof of the plan's angle with the preset's hook and scene, and nothing else of it", () => {
    for (const a of sound.angles) expect(writerAngle(sound, { hook_family: a.hook_family, scene_family: a.scene_family })).toEqual({ idea: a.idea, proof: a.proof });
    // Each angle's idea is its own: the three answers above are three different ideas.
    expect(new Set(sound.angles.map((a) => writerAngle(sound, a)!.idea)).size).toBe(sound.angles.length);
  });

  it("is every preset the plan's draw makes: a drawn preset always has an angle", () => {
    const presets = sound.angles.map((a, i) => ({ version_id: `v-${i}`, key: `P${i}`, enabled: true, hook_family: a.hook_family, scene_family: a.scene_family }));
    const drawn = planDraw("p", sound, presets, []).order.map((id) => presets.find((p) => p.version_id === id)!);
    expect(drawn).toHaveLength(sound.angles.length);
    expect(drawn.map((p) => writerAngle(sound, p)?.idea)).toEqual(sound.angles.map((a) => a.idea));
  });

  it("is null for a preset the plan has no angle for: the hook alone, the scene alone, or no concept named", () => {
    const [a, b] = sound.angles;
    // Another angle's scene under this angle's hook, when that pairing is not itself an angle of the plan.
    const crossed = { hook_family: a!.hook_family, scene_family: b!.scene_family };
    expect(sound.angles.some((x) => x.hook_family === crossed.hook_family && x.scene_family === crossed.scene_family)).toBe(false);
    expect(writerAngle(sound, crossed)).toBeNull();
    expect(writerAngle(sound, { hook_family: a!.hook_family })).toBeNull();
    expect(writerAngle(sound, { hook_family: null, scene_family: a!.scene_family })).toBeNull();
    expect(writerAngle(sound, {})).toBeNull();
  });
});

describe("planFormatsFor — built is not offered", () => {
  it("still and motion are the built formats", () => {
    expect(PLAN_FORMATS_BUILT).toEqual(["still", "motion"]);
  });

  it("a campaign with no video model is offered a still alone", () => {
    expect(planFormatsFor({ videoModel: null })).toEqual(["still"]);
  });

  it("a campaign with a video model is offered every built format", () => {
    expect(planFormatsFor({ videoModel: "simulator/video" })).toEqual([...PLAN_FORMATS_BUILT]);
  });
});
