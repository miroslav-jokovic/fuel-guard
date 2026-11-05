import {
  CMV_WINDOW_YEARS,
  EMPLOYMENT_WINDOW_YEARS,
  type PspEmploymentSuggestions,
  type UnlistedCarrier,
} from "@silvicom/shared";
import type { EmployerFields } from "./employerRow";

/**
 * HW6b — the PSP suggestions as both timelines use them (HIRING-WORKFLOW-AUDIT-2026-10-31 §4.6).
 * Pure, so the rules are tested without a component: which jobs PSP backs up, and what "Add as a job"
 * puts in the one employer form.
 */

/**
 * The jobs PSP backs up, by the key the timeline gives each job. A draft job from before AW1 has no
 * key and the timeline calls it `row-<position>` (`OfficeJobsSection`); the route reports its
 * position for exactly that case.
 */
export function corroboratedJobKeys(s: PspEmploymentSuggestions | null | undefined): Set<string> {
  return new Set(
    (s?.employers ?? []).filter((e) => e.match === "corroborated").map((e) => e.key ?? `row-${e.index}`),
  );
}

/**
 * What the employer form opens with for a carrier PSP named.
 *
 * ⚠ The dates are when PSP SAW the truck — the first and last inspection or crash under that DOT
 * number — not when the driver was hired or left (D-PSP5, §3.6). They are a starting point the
 * recruiter confirms with the driver, which the block above the button says in words; the form never
 * saves without somebody pressing Save. "Drove a truck" and "DOT-regulated" are Yes because an
 * inspection under a USDOT number is both, by definition.
 */
export function pspJobPrefill(u: UnlistedCarrier): Partial<EmployerFields> {
  return {
    employer_name: u.carrierName ?? "",
    usdot_number: u.usdotNumber,
    started_on: u.firstSeen,
    ended_on: u.lastSeen,
    operated_cmv: true,
    dot_regulated: true,
  };
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * The words. `strings.ts`'s voice: the fact, then the next action, no CFR citation. The limit is said
 * in plain words on every showing (§4.6.5) — PSP sees only the trucks a driver was inspected or crashed
 * in, so a short list here is not a short career.
 */
export const PSP_SUGGESTION_COPY = {
  heading: "From the PSP record",
  pulled: (date: string): string => `PSP report of ${date}.`,
  limit: "PSP only shows trucks the driver was inspected in or had a crash in. Most drivers have more jobs than this.",
  unlisted: (u: UnlistedCarrier, from: string, to: string): string => {
    const seen = [
      u.inspections > 0 ? plural(u.inspections, "inspection", "inspections") : null,
      u.crashes > 0 ? plural(u.crashes, "crash", "crashes") : null,
    ].filter(Boolean).join(" and ");
    const carrier = u.carrierName ? `${u.carrierName}, DOT ${u.usdotNumber}` : `DOT ${u.usdotNumber}`;
    return `PSP shows ${seen} under ${carrier}, ${from === to ? `on ${from}` : `between ${from} and ${to}`} — not on their list.`;
  },
  owedTo: {
    b10: `Inside the last ${EMPLOYMENT_WINDOW_YEARS} years, so it belongs on the list.`,
    b11: `${EMPLOYMENT_WINDOW_YEARS} to ${CMV_WINDOW_YEARS} years ago — it belongs on the list if they drove a truck there.`,
    outside: `More than ${CMV_WINDOW_YEARS} years ago — not required on the list.`,
  } as const,
  confirmDates: "The dates are when PSP saw the truck, not when they started or left. Confirm them with the driver.",
  add: "Add as a job",
  allListed: "Every carrier PSP names is on their list.",
  seen: "Seen in PSP",
};
