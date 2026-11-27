/**
 * How a truck's fault codes read in a maintenance follow-up (OUT-OF-ROUTE-MAP-ANALYSIS §7, D-ORM8–10;
 * Q-ORM6–8 ruled (a) 2026-11-27). Pure, so the words are tested once.
 *
 * The office reader is not a mechanic and often not a native speaker (memory: finance reader), so a code
 * reads as Samsara's description first and the two numbers after — the numbers are what the shop's own
 * tool looks up. A maker-specific code (53% of the fleet's, measured) has no description from Samsara
 * and says so plainly rather than showing "Manufacturer Assignable SPN".
 */
import { faultCodeGroup, type TruckFaultCode, type TruckLampState } from "@silvicom/shared";

/** Samsara's four dash lamps, in the order a driver would call them out — red first. */
const LAMP_WORDS: [keyof TruckLampState, string][] = [
  ["stop", "red STOP"],
  ["warning", "amber warning"],
  ["emissions", "emissions"],
  ["protect", "protect"],
];

/** "Lamps on: red STOP, emissions." · "No dash lamps on." · null when Samsara sent no lamp reading. */
export function lampsSentence(lamps: TruckLampState | null): string | null {
  if (!lamps) return null;
  const on = LAMP_WORDS.filter(([k]) => lamps[k]).map(([, w]) => w);
  return on.length ? `Lamps on: ${on.join(", ")}.` : "No dash lamps on.";
}

/** "SPN 1636 · FMI 3" — FMI left out when Samsara sends none. */
export const codeNumbers = (c: Pick<TruckFaultCode, "spn" | "fmi">): string => (c.fmi === null ? `SPN ${c.spn}` : `SPN ${c.spn} · FMI ${c.fmi}`);

/** What is wrong, in Samsara's words; the plain fallback for a maker-specific or undescribed code. */
export function codeTitle(c: Pick<TruckFaultCode, "description" | "makerSpecific">): string {
  if (c.description) return c.description;
  return c.makerSpecific ? "Maker-specific code — the shop looks it up by its SPN" : "Samsara has no description for this code";
}

/** "Voltage above normal · Engine #2 · 3 times" — whichever parts Samsara sent. */
export function codeDetail(c: Pick<TruckFaultCode, "fmiDescription" | "moduleName" | "occurrences">): string {
  const parts = [c.fmiDescription, c.moduleName, c.occurrences && c.occurrences > 1 ? `${c.occurrences} times` : null];
  return parts.filter((p): p is string => !!p).join(" · ");
}

/** The truck's own codes, and the cameras', radar's and telematics units' to fold beneath them (Q-ORM7). */
export function splitCodes<T extends Pick<TruckFaultCode, "module">>(codes: readonly T[]): { vehicle: T[]; electronics: T[] } {
  return {
    vehicle: codes.filter((c) => faultCodeGroup(c) === "vehicle"),
    electronics: codes.filter((c) => faultCodeGroup(c) === "electronics"),
  };
}
