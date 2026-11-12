/**
 * `node --import tsx src/scripts/adsStarterCopyFixtures.ts` — writes the copywriter's starter fixtures: each of the
 * twelve `opening-*` briefs below under each of the five starter presets (`STARTER_PRESETS`), 60 sets, 20 of them on
 * briefs written in Spanish.
 *
 * Why (ADS-CREATIVE-QUALITY-PLAN §8, 2026-11-12): the owner's copy rating (Copywriter L3, craft judge L3, Q-AD57) must
 * rate copy written for the presets a carrier adopts. The older fixtures carry ADS-AGENT-PLAN §4a's P1–P5 ("Windshield
 * sunrise", the carousel), which #2211 re-specified; their formulas and slots are not the starters'. The briefs are the
 * `opening-*` ones because those were made through `openingBrief` from fields an opening holds (CQ2), so they are what a
 * real campaign hands the copywriter. The recipe is read from `STARTER_PRESETS`, never restated, so a starter edited
 * later makes a stale fixture visible as a diff when this is re-run.
 *
 * A new fixture holds a placeholder recording (output null) until `pnpm ads:eval copywriter --record --only starter-`
 * replaces it with the live answer; an existing one keeps its recording when its input is unchanged.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { STARTER_PRESETS } from "@silvicom/shared";

const DIR = new URL("../modules/ads/workers/copywriter/fixtures/", import.meta.url);

/** Eight English and four Spanish openings: every freight, schedule and pay unit the opening fixtures hold. */
export const STARTER_BRIEFS = [
  "opening-dry-van-regional-age-floor", "opening-flatbed-per-load-southeast", "opening-intermodal-local-nights",
  "opening-local-dry-van-hourly", "opening-reefer-otr-two-years", "opening-regional-reefer-weekly",
  "opening-tanker-regional-pets", "opening-team-otr-dedicated-annual",
  "opening-es-local-hourly", "opening-es-otr-bonus", "opening-es-regional-reefer", "opening-es-tanker-weekends",
] as const;

const read = (name: string) => JSON.parse(readFileSync(new URL(`${name}.json`, DIR), "utf8"));

let written = 0;
for (const preset of STARTER_PRESETS) {
  for (const briefName of STARTER_BRIEFS) {
    const source = read(briefName);
    const name = `starter-${preset.key.toLowerCase()}-${briefName.replace(/^opening-/, "")}`;
    const input = { brief: source.input.brief, recipe: preset.recipe, company_name: source.input.company_name, candidates: 3 };
    const file = new URL(`${name}.json`, DIR);
    const prior = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
    if (prior && JSON.stringify(prior.input) === JSON.stringify(input)) continue;
    const fixture = {
      name,
      about: `Starter ${preset.key} "${preset.recipe.name}" on the ${briefName} brief (the owner's copy rating, 2026-11-12).`,
      input,
      expect: "ready",
      recorded: { source: "model", prompt_version: "unrecorded", model: "unrecorded", recorded_at: new Date().toISOString(), output: null },
    };
    writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`);
    written += 1;
  }
}
console.log(`${written} starter fixtures written`);
