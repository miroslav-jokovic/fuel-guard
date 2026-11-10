import { resolveSectionAccess, type AppSection, type SectionAccess, type SectionClaim } from "./auth.js";
import type { UserRole } from "./constants.js";

/**
 * Which assistant tools a caller may use (F21 R5; PLAN.md D-AI1/D-AI3; owner's rulings 2026-11-10).
 *
 * ── THE RULE (Q-AI2, Q-AI5 as ruled) ──────────────────────────────────────────────────────────────
 * "AI will be related to their features and they will not be able to see whatever they want … others
 * need to see what is already regulated by permissions." So every tool declares the section(s) its
 * data belongs to, and a caller's tool list is the tools whose every requirement their access meets —
 * asked through `resolveSectionAccess`, the one function every request-time check in the product asks,
 * with the org's overrides on the caller's token. Admin gets everything because the matrix says so;
 * accounting data reaches admin, accountant and the read-only auditor because the matrix says that too. No role list
 * is written anywhere in this file, which is the point: a hand list beside the matrix is the
 * `session.canManage` workaround CLAUDE.md names.
 *
 * ── WHERE EACH SECTION COMES FROM ────────────────────────────────────────────────────────────────
 * Each requirement is the gate of the PAGE the tool's figure comes from (its surface in
 * `surfaceCatalogue.ts`, and that page's API route), so the assistant can never answer what the page
 * would refuse. `fleet_roster` counts drivers (Drivers, roster) AND trucks and trailers (Vehicles,
 * equipment), so it needs both.
 *
 * The model is shown only the tools in the list (it cannot call or mention one it does not have), and
 * the API checks the same list again before running any call (defence in depth).
 */

export interface ToolRequirement {
  section: AppSection;
  level: Exclude<SectionAccess, "none">;
}

const view = (section: AppSection): ToolRequirement => ({ section, level: "view" });

/** Every assistant tool and what it needs. The API's tool definitions must match these names exactly. */
export const ASSISTANT_TOOL_ACCESS = {
  // Fuel pages: Fuel log, Fuel costs, Findings/Alerts, Fuel cards, Odometer mismatches — all `section("fuel")`.
  fleet_summary: [view("fuel")],
  top_risk: [view("fuel")],
  odometer_accuracy: [view("fuel")],
  count_signal: [view("fuel")],
  fuel_report: [view("fuel")],
  fuel_economics: [view("fuel")],
  fuel_ranking: [view("fuel")],
  spend_trend: [view("fuel")],
  declined_summary: [view("fuel")],
  telematics_coverage: [view("fuel")],
  import_activity: [view("fuel")],
  // Driver performance and Idling are safety pages (`safety.driver-performance`, `safety.idling`;
  // `/api/idle/*` asks `requireSection("safety", "view")`).
  driver_performance: [view("safety")],
  idling_summary: [view("safety")],
  // Drivers (roster) and Vehicles (equipment).
  fleet_roster: [view("roster"), view("equipment")],
  // Fleet report and its income statement (`finance.fleet-report`, gate `section("accounting")`;
  // every `/api/accounting/*` read asks `requireSection("accounting", "view")`). The matrix gives
  // `accounting` to admin and accountant, and VIEW to the read-only auditor, who can open that page
  // too. That is the owner's Q-AI5 ruling with no list written; the auditor is Q-AI11 (PLAN.md §5).
  finance_report: [view("accounting")],
  income_statement: [view("accounting")],
} as const satisfies Record<string, readonly ToolRequirement[]>;

export type AssistantToolName = keyof typeof ASSISTANT_TOOL_ACCESS;
export const ASSISTANT_TOOL_NAMES = Object.keys(ASSISTANT_TOOL_ACCESS) as AssistantToolName[];

const RANK: Record<SectionAccess, number> = { none: 0, view: 1, manage: 2 };

/** May this caller use this tool? Every requirement, against their resolved access. */
export function callerMayUseTool(role: UserRole | null | undefined, claim: SectionClaim | null | undefined, tool: AssistantToolName): boolean {
  return ASSISTANT_TOOL_ACCESS[tool].every((r) => RANK[resolveSectionAccess(role, r.section, claim)] >= RANK[r.level]);
}

/** The caller's tools, in catalogue order (stable, so the cached prompt prefix is stable per role). */
export function assistantToolsFor(role: UserRole | null | undefined, claim: SectionClaim | null | undefined): AssistantToolName[] {
  if (!role || role === "driver") return [];
  return ASSISTANT_TOOL_NAMES.filter((t) => callerMayUseTool(role, claim, t));
}

// ── NEVER-SHOWN FIELDS (PLAN D-AI7, owner 2026-11-10: "proceed as proposed and recommended") ──────
/**
 * Raw identifiers no report needs, removed from EVERY tool result for EVERY role, admin included.
 * Not because the person may not see them — their pages decide that — but because whatever a tool
 * returns is sent to the model provider, and "3 applicants are waiting on MVR" or "card ending 4417"
 * answers the question without the value. Names, statuses, counts and last-4s stay.
 *
 * Matched on the KEY, case-insensitively, at any depth; a future tool that returns a record with one of
 * these fields loses it here rather than relying on its author to remember. (`account_number` alone is
 * deliberately absent: a general-ledger account number is a report's ordinary vocabulary.) The 2026-10-15 EFS audit
 * (full card numbers in a public repository) is why card numbers are on the list.
 */
export const NEVER_EXPOSED_FIELDS = [
  "ssn", "social_security_number", "tax_id", "ein",
  "dob", "date_of_birth", "birth_date",
  "license_number", "licence_number", "cdl_number", "dl_number",
  "bank_account", "bank_account_number", "routing_number", "iban",
  "card_number", "pan", "full_card_number", "pin", "card_pin",
  "password", "api_key", "token", "secret",
] as const;

const NEVER = new Set<string>(NEVER_EXPOSED_FIELDS);

/** A copy of `value` with every never-shown key removed, at any depth. Pure; the input is untouched. */
export function stripNeverExposed<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripNeverExposed(v)) as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (!NEVER.has(k.toLowerCase())) out[k] = stripNeverExposed(v);
    }
    return out as T;
  }
  return value;
}
