import { z } from "zod";
import type { SectionClaim } from "./auth.js";
import type { UserRole } from "./constants.js";
import type { ModuleSet } from "./entitlements.js";
import { canReachSurface } from "./surfaces.js";
import { SURFACES } from "./surfaceCatalogue.js";
import { FINDING_KIND_LABELS } from "./findingAssignment.js";
import { FUEL_PROBLEMS_LINK_KINDS, FUEL_PROBLEMS_LINK_STATES } from "./fuelProblemsLinkContract.js";

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
} as const satisfies Record<string, { surfaceKey: string; filters: z.ZodType; describe: string }>;

export type AssistantView = keyof typeof ASSISTANT_VIEWS;
export const ASSISTANT_VIEW_NAMES = Object.keys(ASSISTANT_VIEWS) as AssistantView[];

const surfaceOf = (view: AssistantView) => SURFACES.find((s) => s.key === ASSISTANT_VIEWS[view].surfaceKey);

/** The views this caller may be offered: each page's own surface gate, in catalogue order. */
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
