import type { AdPresetSave } from "./brandKitContract.js";

/**
 * The five starter presets (ADS-CREATIVE-QUALITY-PLAN Q-AD77, CQ5; Phase 1 step P1-6). Adoptable DATA, not
 * defaults: `POST /api/ads/presets/adopt` writes version 1 of each key the carrier does not hold yet, switched
 * OFF, into the carrier's own versioned presets — and from then on they are the carrier's, edited in the preset
 * drawer like any other. Nothing here is read by compose; a carrier that never adopts composes under nothing.
 *
 * ── FIVE CONCEPTS, NOT FIVE VARIANTS ───────────────────────────────────────────────────────────────
 * Meta's ranking folds near-duplicates into one ad (R1, Andromeda), so the five are laid out as a diagonal of
 * the Q-AD58 lists: each holds a different hook family AND a different scene family, and the layouts differ
 * where the picture allows (two bottom plates, two top bands, one centred). All five can therefore be live at
 * once without the save's distinct-pair rule refusing any of them. They derive from ADS-AGENT-PLAN §4a's
 * P1–P5, re-specified by CQ5 and the Phase 1 rulings (PM, 2026-11-10, D-AD29):
 *   · every one is a STILL in 4:5 + 1:1 (motion is C6's; 9:16 is not made until Q-AD29, Q-AD75);
 *   · P1 keeps the windshield and leads with straight talk (what the run is, what we need) — the job as seen
 *     from the seat; "life first" moves wholly to P3, so the two never read as one idea;
 *   · P2 "The number" becomes a plain plate with the figure as the picture: it needs no equipment photo, so a
 *     carrier with an empty kit can still compose two of the five (P1, P2);
 *   · P4 "Walk-around" is a still of the parked truck until C6;
 *   · P5 was a three-card carousel, which does not exist; its "straight talk" went to P1, and it becomes
 *     "proof": our real truck on the road with the brief's figures as the evidence.
 *
 * ── THE HOOK FORMULAS READ THE BRIEF ───────────────────────────────────────────────────────────────
 * The copywriter sees the formula beside the brief's facts (`copyUserMessage`). A formula that says only
 * "open with the pay" asks for a figure some briefs do not hold (`no-pay-in-brief`), and the claim check then
 * refuses what the model invents. So each formula says what to lead with WHEN the brief has it and what to do
 * when it does not, and none asks for a fact the brief must supply.
 *
 * ── THE SLOTS ──────────────────────────────────────────────────────────────────────────────────────
 * Three to five image slots each, from CQ5's list (setting, weather, viewpoint, light, season), so the art
 * director has room to make two jobs look like two jobs. The overlay headline stays under
 * `OVERLAY_HEADLINE_MAX_CHARS` (58 since L3) — the save refuses more — and its width follows the copywriter fixtures'
 * measured slots (36–42): a short line is the one that reads in a feed. Every template ends in "no text, no
 * logos, no lettering" (D-AD9: our renderer draws the words).
 *
 * ── THE LOOK AND THE SMALL LINES (ADS-AD-LOOK-PLAN Q-ADL4, D-ADL15, 2026-11-11) ──────────────────────
 * A starter that leads with a FIGURE (P2 pay first, P5 proof) takes `rail`, whose accent colour marks the figure
 * — the one thing a driver looks for is the brightest thing in the ad; the equipment starter (P4) takes it too.
 * The two that lead with a LIFE or a plain statement (P1 straight talk, P3 home) take `ribbon`, calmer and centred.
 * So the five alternate, and a retired ad's successor (D-AD23) usually changes design, not only picture.
 * Three use a small line, each where its formula already asked for a second element, so the line splits what the
 * headline used to carry rather than adding copy: P2's "who the job is for" is the kicker, P3's believable fact
 * and P5's second figure are the second line. P1 and P4 stay two-line ads. Each small line is 28 characters,
 * the overlay's measured limit (`OVERLAY_SMALL_LINE_MAX_CHARS`).
 *
 * The keys are P1–P5, the names the plans and the fixtures use. A carrier that already holds P2 keeps its own;
 * the adopt skips that key and says so.
 */

const PLATFORM = { primary_text: "primary_text", headline: "headline" } as const;
const FEED = ["4:5", "1:1"] as ("4:5" | "1:1")[];
const NO_WORDS = "no text, no logos, no lettering";

export const STARTER_PRESETS: readonly AdPresetSave[] = [
  {
    key: "P1", enabled: false,
    recipe: {
      name: "From the driver's seat",
      hook_family: "straight_talk", scene_family: "cab_pov",
      hook_formula: "Say plainly what the run is, as if from the driver's seat: the lanes or the area, then the schedule or home time the brief states. If the brief states no lanes or area, say the kind of run (local, regional, over the road). Then what we need, if the brief states it (experience, licence, endorsements). No pay figure in the hook unless the brief states nothing else.",
      copy_slots: [{ name: "hook", max_chars: 42 }, { name: "cta", max_chars: 24 }, { name: "primary_text", max_chars: 300 }, { name: "headline", max_chars: 40 }],
      image_prompt_template: `View through a truck windshield from the driver's seat, {viewpoint}, an open {road} ahead through {setting}, {light}, {weather}, ${NO_WORDS}`,
      image_slots: ["viewpoint", "road", "setting", "light", "weather"],
      starts_from: "text_only", shows_equipment: false, shows_people: false, motion_template: null,
      layout: "bottom_plate", look: "ribbon", formats: FEED,
      overlay_slots: { headline: "hook", cta: "cta" }, platform_slots: PLATFORM,
    },
  },
  {
    key: "P2", enabled: false,
    recipe: {
      name: "The number",
      hook_family: "pay_first", scene_family: "abstract_plate",
      hook_formula: "Lead with the pay figure alone, exactly as the brief states it and with its unit (per mile, per week, per year). If the brief states no pay, lead with its strongest other figure (a bonus, home days, miles) — never a figure the brief does not hold. Who the job is for (the licence, the kind of run) goes in a few words on the small line above it, never in the pay line.",
      copy_slots: [{ name: "pay", max_chars: 30 }, { name: "cta", max_chars: 22 }, { name: "primary_text", max_chars: 280 }, { name: "headline", max_chars: 40 }, { name: "kicker", max_chars: 28 }],
      image_prompt_template: `A plain {surface} background, {texture}, {light}, a soft {tone} gradient, nothing in the frame, ${NO_WORDS}`,
      image_slots: ["surface", "texture", "light", "tone"],
      starts_from: "text_only", shows_equipment: false, shows_people: false, motion_template: null,
      layout: "centered", look: "rail", formats: FEED,
      overlay_slots: { headline: "pay", cta: "cta", kicker: "kicker" }, platform_slots: PLATFORM,
    },
  },
  {
    key: "P3", enabled: false,
    recipe: {
      name: "Home on time",
      hook_family: "life_first", scene_family: "home_street",
      hook_formula: "Lead with being home: the home time the brief states (every night, weekends, so many days a month), in the reader's words. If the brief states no home time, lead with the schedule or the area that keeps the driver near home. The one fact that makes it believable goes on the second line, in a few words.",
      copy_slots: [{ name: "hook", max_chars: 40 }, { name: "cta", max_chars: 24 }, { name: "primary_text", max_chars: 260 }, { name: "headline", max_chars: 40 }, { name: "second_line", max_chars: 28 }],
      image_prompt_template: `Our truck parked on a quiet {street} at {time_of_day}, a porch light on, {season}, {viewpoint}, no people, ${NO_WORDS}`,
      image_slots: ["street", "time_of_day", "season", "viewpoint"],
      starts_from: "equipment_photo", shows_equipment: true, shows_people: false, motion_template: null,
      layout: "top_band", look: "ribbon", formats: FEED,
      overlay_slots: { headline: "hook", cta: "cta", subline: "second_line" }, platform_slots: PLATFORM,
    },
  },
  {
    key: "P4", enabled: false,
    recipe: {
      name: "Walk-around",
      hook_family: "equipment_first", scene_family: "equipment_at_rest",
      hook_formula: "Point at the equipment: what the driver will actually drive or haul, as the brief describes it (the trailer type, the freight). If the brief says nothing about the equipment, lead with the freight or the kind of run. Then the strongest fact the brief states.",
      copy_slots: [{ name: "hook", max_chars: 36 }, { name: "cta", max_chars: 22 }, { name: "primary_text", max_chars: 240 }, { name: "headline", max_chars: 40 }],
      image_prompt_template: `Our tractor parked at {setting}, {viewpoint}, {light}, {weather}, ${NO_WORDS}`,
      image_slots: ["setting", "viewpoint", "light", "weather"],
      starts_from: "equipment_photo", shows_equipment: true, shows_people: false, motion_template: null,
      layout: "bottom_plate", look: "rail", formats: FEED,
      overlay_slots: { headline: "hook", cta: "cta" }, platform_slots: PLATFORM,
    },
  },
  {
    key: "P5", enabled: false,
    recipe: {
      name: "On the road, in figures",
      hook_family: "proof", scene_family: "equipment_on_road",
      hook_formula: "Lead with one of the brief's own figures as evidence rather than a promise (the pay, or the miles), and put a second on the second line (the home time, or the bonus), so the two read side by side. If the brief states only one figure, the second line is the plainest fact beside it. Never round, never add a figure.",
      copy_slots: [{ name: "hook", max_chars: 40 }, { name: "cta", max_chars: 24 }, { name: "primary_text", max_chars: 260 }, { name: "headline", max_chars: 40 }, { name: "second_line", max_chars: 28 }],
      image_prompt_template: `Our truck driving on {road} through {setting}, {viewpoint}, {light}, {season}, ${NO_WORDS}`,
      image_slots: ["road", "setting", "viewpoint", "light", "season"],
      starts_from: "equipment_photo", shows_equipment: true, shows_people: false, motion_template: null,
      layout: "top_band", look: "rail", formats: FEED,
      overlay_slots: { headline: "hook", cta: "cta", subline: "second_line" }, platform_slots: PLATFORM,
    },
  },
];
