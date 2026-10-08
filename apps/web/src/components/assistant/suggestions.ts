import { surfaceForPath } from "@silvicom/shared";

/**
 * What the assistant offers to answer, chosen by the page the reader is on (F21 redesign).
 *
 * ⚠ Every question here must be one the assistant's tools CAN answer today, and those tools are
 * still fuel-shaped (`modules/insights/askData.ts`: spend, MPG, rankings, theft cases, idling,
 * driver scores, declines, telematics coverage, imports, roster counts). Offering a dispatcher
 * "which loads are late?" before a loads tool exists would be a button that produces an apology.
 * When Step 4 of the plan adds a section's tools, that section's questions are added here with them.
 *
 * Keyed by the surface the page belongs to (`surfaceForPath`, the same catalogue the sidebar reads),
 * so a detail page asks about its parent's subject. A page with nothing specific gets the general
 * set — which is also the order the reader sees on `/ask` itself.
 */

const GENERAL = [
  "How much did we spend on fuel last month, and what's our fleet MPG?",
  "Which drivers have the worst MPG this quarter?",
  "How many high or critical theft alerts in the last 30 days?",
  "Idle hours and cost this month — who are the worst idlers?",
];

const BY_SURFACE: Record<string, string[]> = {
  "fuel.log": [
    "Top 5 fuel stations by spend in the last 30 days",
    "Is fuel spend going up week by week this quarter?",
    "What's our average price per gallon this month?",
  ],
  "fuel.spend": [
    "Is fuel spend going up week by week this quarter?",
    "Which trucks spent the most on fuel last month?",
    "How much did we spend on reefer fuel this month?",
  ],
  "fuel.cards": [
    "How many declined card attempts this month, and how many look suspicious?",
    "Which drivers have the most flagged fills this month?",
  ],
  "fuel.exceptions": [
    "Which drivers have the most flagged fills this month?",
    "How many open cases have a location mismatch?",
  ],
  "safety.alerts": [
    "How many high or critical theft alerts in the last 30 days?",
    "Which trucks have the most flagged fills this month?",
    "How many open cases show a fill bigger than the tank?",
  ],
  "safety.idling": [
    "Idle hours and cost this month — who are the worst idlers?",
    "Which trucks idled the most in the last 2 weeks?",
  ],
  "safety.driver-performance": [
    "Best and worst drivers by safety score this month",
    "Who has the lowest efficiency score this quarter?",
  ],
  "fleet.odometer": [
    "Which drivers enter odometers least accurately?",
    "What % of our fills are corroborated by telematics?",
  ],
  "fleet.vehicles": ["How many trucks, trailers and drivers are active right now?"],
  "fleet.drivers": ["How many drivers are active right now?", "Best and worst drivers by safety score this month"],
};

/** Up to `n` questions: the page's own first, then the general set, never the same one twice. */
export function suggestionsFor(path: string, n = 4): string[] {
  const s = surfaceForPath(path);
  const key = s?.parent ?? s?.key ?? "";
  const own = BY_SURFACE[key] ?? [];
  return [...new Set([...own, ...GENERAL])].slice(0, n);
}
