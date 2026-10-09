/**
 * Which regulation a cut reads `hazSubstances` from — chosen by the date the dataset takes effect.
 *
 * 91 FR 49305 (FR doc 2026-15809, "Hazardous Materials: Remove Redundant List of U.S. EPA CERCLA
 * Hazardous Substances", final rule, effective 2026-12-02) revises "Appendix A to § 172.101—List of
 * Hazardous Substances and Reportable Quantities" to read, in full: "Refer to 40 CFR 302.4 to see the
 * list of hazardous substances and their reportable quantities (RQs) in Table 302.4. The list includes
 * an Appendix B to § 302.4 for radionuclides and their adjusted RQs." From that day the 49 CFR text has
 * no table to parse, and the RQ list the HMR enforces is EPA's Table 302.4.
 *
 * So the rule is: a dataset effective BEFORE 2026-12-02 reads Appendix A from the §172.101 capture (what
 * 2026.07.x and 2026.08.0 were cut from — they must keep re-cutting byte-for-byte); a dataset effective ON
 * OR AFTER it reads Table 302.4 from the Title 40 capture (`captureCercla.ts`). The date is the cut's
 * `effectiveDate`, else its `sourceEcfrDate`; a cut with neither is refused, because "which list was law"
 * is exactly the question it cannot then answer.
 *
 * The amendment does NOT move the mixture/solution concentration table: it stays in 49 CFR as
 * §171.8 "Hazardous substance" (3)(ii) ("RQ pounds (kilograms) … Concentration by weight … 5,000
 * (2,270) 10 100,000 …"), the same five rows as Appendix A's former paragraph. The engine reads none of
 * it today; nothing here changes that.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { HazSubstance } from "../src/schema.js";
import { parseHazSubstances } from "./parseAppendices.js";
import { parseCerclaTable, type CerclaRowWithoutRq } from "./parseCercla.js";

/** Title 40 — Protection of Environment; §302.4 is the CERCLA designation + RQ table. */
export const CERCLA_TITLE = 40;
export const CERCLA_SECTION = "302.4";
/** 91 FR 49305's effective date: the first day Appendix A to §172.101 is a pointer to 40 CFR 302.4. */
export const APPENDIX_A_REPLACED_ON = "2026-12-02";
export const APPENDIX_A_REPLACED_BY = "91 FR 49305 (FR doc 2026-15809)";

export type HazSubstancesSourceId = "49cfr172.101-appA" | "40cfr302.4";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The source a cut must read, from the day its dataset takes effect. Throws when neither date is given. */
export function hazSubstancesSourceFor(dates: { effectiveDate?: string | null; sourceEcfrDate?: string | null }): HazSubstancesSourceId {
  const day = dates.effectiveDate ?? dates.sourceEcfrDate ?? null;
  if (!day || !ISO_DAY.test(day)) {
    throw new Error(
      `hazSubstancesSourceFor: an effectiveDate or sourceEcfrDate (YYYY-MM-DD) is required — from ${APPENDIX_A_REPLACED_ON} ` +
        `the RQ list is 40 CFR 302.4, before it §172.101 Appendix A (${APPENDIX_A_REPLACED_BY}); got ${JSON.stringify(day)}.`,
    );
  }
  return day < APPENDIX_A_REPLACED_ON ? "49cfr172.101-appA" : "40cfr302.4";
}

export interface HazSubstancesLoad {
  source: HazSubstancesSourceId;
  substances: HazSubstance[];
  /** Table 302.4 rows that carry no lb+kg RQ (empty for Appendix A, whose parser has no such notion). */
  withoutRq: CerclaRowWithoutRq[];
}

export type FixtureReader = (name: string) => string | null;

export function readImportFixture(name: string): string | null {
  try {
    return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
  } catch {
    return null;
  }
}

/** Parse `hazSubstances` from the source the dates select. Missing capture → a message naming the script. */
export function loadHazSubstances(
  dates: { effectiveDate?: string | null; sourceEcfrDate?: string | null },
  read: FixtureReader = readImportFixture,
): HazSubstancesLoad {
  const source = hazSubstancesSourceFor(dates);
  if (source === "49cfr172.101-appA") {
    const xml = read("section-172-101.xml") ?? read("appendix-a-slice.xml");
    if (!xml) throw new Error("loadHazSubstances: no §172.101 capture (run captureFixtures.ts).");
    return { source, substances: parseHazSubstances(xml), withoutRq: [] };
  }
  const xml = read("section-40-302-4.xml");
  if (!xml) throw new Error("loadHazSubstances: no 40 CFR 302.4 capture — run `npx tsx import/captureCercla.ts`.");
  const table = parseCerclaTable(xml);
  return { source, substances: table.substances, withoutRq: table.withoutRq };
}

/** The provenance line a 302.4 cut appends to `sourceSecondaryRef` (Appendix A cuts append nothing). */
export function cerclaSourceNote(load: HazSubstancesLoad): string {
  if (load.source !== "40cfr302.4") return "";
  const reasons = load.withoutRq.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.reason]: (acc[r.reason] ?? 0) + 1 }), {});
  const tally = Object.entries(reasons).map(([k, v]) => `${k} ${v}`).join(", ");
  return `; hazSubstances from 40 CFR 302.4 Table 302.4 (${APPENDIX_A_REPLACED_BY}) — ${load.substances.length} rows with lb+kg RQ, ${load.withoutRq.length} without (${tally})`;
}
