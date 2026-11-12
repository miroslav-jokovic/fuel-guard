import { z } from "zod";
import type { SectionClaim } from "./auth.js";
import type { UserRole } from "./constants.js";
import type { ModuleSet } from "./entitlements.js";
import { canReachSurface } from "./surfaces.js";
import { SURFACES } from "./surfaceCatalogue.js";
import { FINDING_KIND_LABELS } from "./findingAssignment.js";
import { FUEL_PROBLEMS_LINK_KINDS, FUEL_PROBLEMS_LINK_STATES } from "./fuelProblemsLinkContract.js";
import {
  DEFAULT_FUEL_LOG_TAB,
  FUEL_LOG_DECLINE_RISKS,
  FUEL_LOG_FACET_TABS,
  FUEL_LOG_TABS,
  FUEL_LOG_TANK_TYPES,
} from "./fuelLogLinkContract.js";
import { EFS_CARD_STATUSES } from "./efsCardCatalog.js";
import { DRIVER_STATUSES } from "./constants.js";
import { DQ_ROSTER_COLUMN_KEYS } from "./dqFile.js";
import { DQ_DUE_FILTERS } from "./dqFleetFilter.js";
import { FILE_FILTERS } from "./fileChip.js";
import { LINK_ANY } from "./linkContract.js";
import { FUEL_CARDS_HEALTH, FUEL_CARDS_LINKED, FUEL_CARDS_OVERRIDE } from "./fuelCardsLinkContract.js";
import { FUEL_ALERTS_SEVERITIES, FUEL_ALERTS_STATUS_ALL, FUEL_ALERTS_STATUSES } from "./fuelAlertsLinkContract.js";

/**
 * The pages Ask AI can open filtered — `open_view` (F21 Step 5, D-AI5 (a) "navigate", D-AI6).
 *
 * ── ONE TOOL, ITS ACCESS DERIVED PER PAGE ──────────────────────────────────────────────────────────
 * "Show me the open fuel problems for 718" is a navigation, not a figure: it reads nothing, and the
 * person's own session opens the page and reads it under the page's own gates. So `open_view` is one
 * tool over several pages rather than a tool per page. Each page here is a `SURFACES` key, and whether a
 * caller may be offered it is that surface's OWN gate (`canReachSurface`), the answer the sidebar gives:
 * never a section list restated beside the catalogue. The web asks `surfaceAllowed` too before it
 * navigates (the per-person screen grants), exactly as it does for an "Open in …" link.
 *
 * ── A FILTER THE PAGE DOES NOT HAVE IS REFUSED, NOT DROPPED ────────────────────────────────────────
 * Step 5's acceptance. Each page's filters are a STRICT schema: an unknown key ("amount_over") or a
 * value outside the page's own list is an error that names what the page can filter by, so the model
 * says "Fuel problems cannot filter by amount" instead of opening a page wider than the question and
 * implying it is the answer. The values are the page's own vocabularies, read from its link contract.
 *
 * The model names trucks by UNIT NUMBER; the API resolves them to ids (`openAssistantView`), and the
 * ids go only into the link, never into model-facing text (D-AI8).
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a calendar day, YYYY-MM-DD");
const units = z.array(z.string().min(1)).min(1).max(25);
/** The roster's Due words without its "any time" blank, which a link says by leaving `due` out. */
const DQ_DUE_DAYS = DQ_DUE_FILTERS.filter((d): d is Exclude<(typeof DQ_DUE_FILTERS)[number], ""> => d !== "");

/**
 * A Fuel log facet belongs to ONE tab (`FUEL_LOG_FACET_TABS`): the page clears it on any other, so a
 * link with Fills' `tank` on the Declines tab would show a list wider than the answer says it opened.
 * Refused, naming the tab that has it, never moved to that tab on the model's behalf.
 */
const fuelLogFacetsOnTheirTab = (f: { tab?: string } & Record<string, unknown>, ctx: z.RefinementCtx) => {
  const tab = f.tab ?? DEFAULT_FUEL_LOG_TAB;
  for (const [facet, owners] of Object.entries(FUEL_LOG_FACET_TABS) as Array<[string, readonly string[]]>) {
    if (f[facet] !== undefined && !owners.includes(tab)) {
      ctx.addIssue({ code: "custom", path: [facet], message: `only the ${owners.join(" or ")} tab has this filter, not ${tab}` });
    }
  }
};

export const ASSISTANT_VIEWS = {
  fuel_problems: {
    surfaceKey: "fuel.exceptions",
    filters: z
      .object({
        states: z.array(z.enum(FUEL_PROBLEMS_LINK_STATES as [string, ...string[]])).min(1).optional(),
        kinds: z.array(z.enum(FUEL_PROBLEMS_LINK_KINDS as [string, ...string[]])).min(1).optional(),
        units: units.optional(),
        from: day.optional(),
        to: day.optional(),
        mine: z.boolean().optional(),
      })
      .strict(),
    describe:
      "the fuel problems queue (vendor-statement and policy findings, possible-theft fill cases, cards used away " +
      "from their truck). Filters: states (" + FUEL_PROBLEMS_LINK_STATES.join(", ") + "; default open, investigating, " +
      "working), kinds (" + FUEL_PROBLEMS_LINK_KINDS.map((k) => `${k} = ${FINDING_KIND_LABELS[k]}`).join("; ") + "), " +
      "units (truck unit numbers), from/to (calendar days the problem's fill fell on; default the last 90 days), " +
      "mine (true = assigned to the person asking).",
  },
  fuel_log: {
    surfaceKey: "fuel.log",
    filters: z
      .object({
        tab: z.enum(FUEL_LOG_TABS).optional(),
        units: units.optional(),
        from: day.optional(),
        to: day.optional(),
        tank: z.enum(FUEL_LOG_TANK_TYPES).optional(),
        risk: z.enum(FUEL_LOG_DECLINE_RISKS).optional(),
        state: z.string().regex(/^[A-Z]{2}$/, "a two-letter state code, e.g. TX").optional(),
      })
      .strict()
      .superRefine(fuelLogFacetsOnTheirTab),
    describe:
      "the fuel log, one row per transaction. Filters: tab (fills = fill-ups with gallons, cost and MPG, the " +
      "default; declines = declined card swipes, each scored for risk; source = the raw EFS statement lines), " +
      "units (truck unit numbers), from/to (calendar days; default every day there is), tank (fills tab only: " +
      FUEL_LOG_TANK_TYPES.join(", ") + "), risk (declines tab only, the decline's risk score from most to least suspicious: " +
      FUEL_LOG_DECLINE_RISKS.join(", ") + "), state (declines or source tab only: the two-letter state the purchase was in).",
  },
  fuel_alerts: {
    surfaceKey: "safety.alerts",
    filters: z
      .object({
        status: z.enum([...FUEL_ALERTS_STATUSES, FUEL_ALERTS_STATUS_ALL]).optional(),
        severity: z.enum(FUEL_ALERTS_SEVERITIES as [string, ...string[]]).optional(),
        units: units.optional(),
        from: day.optional(),
        to: day.optional(),
        reefer: z.boolean().optional(),
      })
      .strict(),
    describe:
      "the fuel alerts queue (fills that look like possible theft, card misuse or data that does not add up). " +
      "Filters: status (ONE of " + [...FUEL_ALERTS_STATUSES, FUEL_ALERTS_STATUS_ALL].join(", ") + "; without it the page " +
      "shows open alerts, or every status when units are named), severity (ONE of " + FUEL_ALERTS_SEVERITIES.join(", ") +
      "; the page cannot show two at once), units (truck unit numbers), from/to (calendar days of the fill), " +
      "reefer (true = only alerts about reefer fuel going into the truck).",
  },
  fuel_cards: {
    surfaceKey: "fuel.cards",
    filters: z
      .object({
        status: z.enum(EFS_CARD_STATUSES).optional(),
        unit: z.string().min(1).optional(),
        policy: z.string().regex(/^\d+$/, "an EFS policy number, digits only").optional(),
        override: z.enum(FUEL_CARDS_OVERRIDE).optional(),
        linked: z.enum(FUEL_CARDS_LINKED).optional(),
        health: z.enum(FUEL_CARDS_HEALTH).optional(),
      })
      .strict(),
    describe:
      "the EFS fuel card list. Filters, each ONE value (the page shows one at a time): status (" +
      EFS_CARD_STATUSES.join(", ") + "), unit (ONE truck unit number, the card's unit prompt), policy (EFS policy " +
      "number), override (active = an exception with uses left, none), linked (linked = the card matches a fleet " +
      "fuel card, unlinked), health (errors = the last sync failed for the card, ok).",
  },
  drivers: {
    surfaceKey: "fleet.drivers",
    filters: z
      .object({
        status: z.enum([...DRIVER_STATUSES, LINK_ANY]).optional(),
        file: z.enum(FILE_FILTERS).optional(),
        due: z.enum(DQ_DUE_DAYS).optional(),
        requirement: z.enum(DQ_ROSTER_COLUMN_KEYS).optional(),
        search: z.string().trim().min(1).max(60).optional(),
        unseated: z.boolean().optional(),
        archived: z.boolean().optional(),
      })
      .strict(),
    describe:
      "the drivers roster. Filters, each ONE value: status (" + [...DRIVER_STATUSES, LINK_ANY].join(", ") +
      "; default active), file (the driver's file chip, which is their WORST item: " + FILE_FILTERS.join(", ") +
      "; attention = anything not complete), due (qualification items overdue, or overdue-or-due inside 7, 14 or " +
      "30 days: " + DQ_DUE_DAYS.join(", ") + "), requirement (narrows due to ONE item: " +
      DQ_ROSTER_COLUMN_KEYS.join(", ") + "), search (a name or employee number, as the search box matches it), " +
      "unseated (true = active drivers holding no truck), archived (true = the archived roster).",
  },
} as const satisfies Record<string, { surfaceKey: string; filters: z.ZodType; describe: string }>;

export type AssistantView = keyof typeof ASSISTANT_VIEWS;
export const ASSISTANT_VIEW_NAMES = Object.keys(ASSISTANT_VIEWS) as AssistantView[];

const surfaceOf = (view: AssistantView) => SURFACES.find((s) => s.key === ASSISTANT_VIEWS[view].surfaceKey);

/** The views this caller may be offered: each page's own surface gate, in `ASSISTANT_VIEWS` order (stable, so the cached tool definition is too). */
export function assistantViewsFor(
  role: UserRole | null | undefined,
  claim: SectionClaim | null | undefined,
  modules: ModuleSet | null,
): AssistantView[] {
  if (!role || role === "driver") return [];
  return ASSISTANT_VIEW_NAMES.filter((v) => {
    const s = surfaceOf(v);
    return !!s && canReachSurface(s, role, modules, claim ?? null);
  });
}

/** Every surface `open_view` may link to, for the link check that runs before the model sees a result. */
export const ASSISTANT_VIEW_SURFACES: readonly string[] = ASSISTANT_VIEW_NAMES.map((v) => ASSISTANT_VIEWS[v].surfaceKey);

/**
 * The model's filters for a view, checked against the page's contract. An error is a sentence the model
 * can pass on: what was refused, and what the page CAN filter by.
 */
export function parseAssistantViewFilters<V extends AssistantView>(
  view: V,
  raw: unknown,
): { ok: true; filters: z.infer<(typeof ASSISTANT_VIEWS)[V]["filters"]> } | { ok: false; error: string } {
  const schema = ASSISTANT_VIEWS[view].filters;
  const parsed = schema.safeParse(raw ?? {});
  if (parsed.success) return { ok: true, filters: parsed.data as z.infer<(typeof ASSISTANT_VIEWS)[V]["filters"]> };
  const can = Object.keys(schema.shape).join(", ");
  const problems = parsed.error.issues.map((i) =>
    i.code === "unrecognized_keys"
      ? `this page cannot filter by ${i.keys.join(", ")}`
      : `${i.path.join(".") || "filters"}: ${i.message}`,
  );
  return { ok: false, error: `${problems.join("; ")}. It can filter by: ${can}. Say so rather than opening it wider than asked.` };
}
