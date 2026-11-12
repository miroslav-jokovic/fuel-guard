import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import {
  ASSISTANT_VIEWS,
  assistantUnitKey,
  fuelAlertsToQuery,
  fuelLogToQuery,
  fuelProblemsToQuery,
  parseAssistantViewFilters,
  SURFACES,
  type AnomalySeverity,
  type AssistantView,
  type FindingKind,
  type FindingQueueState,
} from "@silvicom/shared";

/**
 * `open_view` (F21 Step 5): the definition the model is shown, and the run that turns its filters into a
 * page link. It reads nothing but the carrier's unit numbers: the PAGE reads the data, in the person's
 * own session, under its own gates (D-AI5 (a)). The link is lifted off before the model sees the result
 * (`splitAssistantLink`, which also marks it `navigate`), so the model is told only what was opened.
 */

/** The tool, offering only the views this caller may open (`assistantViewsFor`). */
export function openViewTool(views: readonly AssistantView[]): Anthropic.Tool {
  return {
    name: "open_view",
    description:
      "Open a page of the app filtered as the person asked, behind the chat: use when they ask to SEE, SHOW, OPEN or " +
      "FILTER a list (\"show me the open fuel problems for 718\"), or to narrow the page they are on. It reads no " +
      "figures; answer in one short sentence saying what was opened. Pages: " +
      views.map((v) => `${v} = ${ASSISTANT_VIEWS[v].describe}`).join(" ") +
      " Pass only filters the page has. If the person asked for one it does not have, the call fails and names " +
      "what it can filter by: tell them, do not open it wider than asked.",
    input_schema: {
      type: "object",
      properties: {
        view: { type: "string", enum: [...views] },
        filters: { type: "object", description: "The page's filters, by the names listed for it." },
      },
      required: ["view"],
    },
  };
}

/**
 * The model's unit numbers to this carrier's trucks, by the assistant's one unit rule (`assistantUnitKey`):
 * each as a vehicle id (Fuel problems' URL) and as the fleet spells its unit number (Fuel log's URL, whose
 * two EFS tabs key on the unit as text). A named truck not in the fleet is reported, never dropped.
 */
async function trucksFor(admin: SupabaseClient, orgId: string, units: readonly string[]) {
  const { data, error } = await admin.from("vehicles").select("id, unit_number").eq("org_id", orgId);
  if (error) throw new Error(error.message);
  const byKey = new Map(
    ((data ?? []) as Array<{ id: string; unit_number: string | null }>)
      .filter((r) => r.unit_number)
      .map((r) => [assistantUnitKey(r.unit_number!), { id: r.id, unit: r.unit_number! }]),
  );
  const ids: string[] = [];
  const unitNumbers: string[] = [];
  const notFound: string[] = [];
  for (const u of units) {
    const hit = byKey.get(assistantUnitKey(u));
    if (hit) {
      ids.push(hit.id);
      unitNumbers.push(hit.unit);
    } else notFound.push(u);
  }
  return { ids: [...new Set(ids)], unitNumbers: [...new Set(unitNumbers)], notFound };
}

type Filters<V extends AssistantView> = z.infer<(typeof ASSISTANT_VIEWS)[V]["filters"]>;

export async function openAssistantView(
  admin: SupabaseClient,
  orgId: string,
  input: Record<string, unknown>,
  views: readonly AssistantView[],
): Promise<unknown> {
  const view = String(input.view ?? "") as AssistantView;
  // The caller's own views only (D-AI1's second check, as for a tool outside `allowed`).
  if (!views.includes(view)) return { error: `That page is not available with this person's access. Pages: ${views.join(", ") || "none"}.` };
  const parsed = parseAssistantViewFilters(view, input.filters);
  if (!parsed.ok) return { error: parsed.error };
  const page = SURFACES.find((s) => s.key === ASSISTANT_VIEWS[view].surfaceKey)!;

  // Trucks first, for every view that has them: a unit not in the fleet opens nothing.
  const f = parsed.filters as { units?: string[] } & Record<string, unknown>;
  const trucks = f.units?.length ? await trucksFor(admin, orgId, f.units) : null;
  if (trucks?.notFound.length) return { error: `Not in this fleet: ${trucks.notFound.join(", ")}. Nothing was opened.` };

  // One branch per view, each built by its page's own link contract. Exhaustive: a view added to
  // `ASSISTANT_VIEWS` without its branch here does not compile.
  let query: Record<string, string>;
  switch (view) {
    case "fuel_problems": {
      const p = parsed.filters as Filters<"fuel_problems">;
      query = fuelProblemsToQuery({
        from: p.from,
        to: p.to,
        vehicleIds: trucks?.ids ?? [],
        states: p.states as FindingQueueState[] | undefined,
        kinds: p.kinds as FindingKind[] | undefined,
        mine: p.mine,
      });
      break;
    }
    case "fuel_log": {
      const l = parsed.filters as Filters<"fuel_log">;
      // The URL carries unit numbers as the fleet spells them ("#718" → "718"), never the model's spelling.
      query = fuelLogToQuery({ ...l, units: trucks?.unitNumbers ?? [] });
      break;
    }
    case "fuel_alerts": {
      const a = parsed.filters as Filters<"fuel_alerts">;
      query = fuelAlertsToQuery({
        status: a.status,
        severity: a.severity as AnomalySeverity | undefined,
        from: a.from,
        to: a.to,
        vehicleIds: trucks?.ids ?? [],
        reeferOnly: a.reefer,
      });
      break;
    }
    default: {
      const unhandled: never = view;
      return { error: `No link is built for ${String(unhandled)}.` };
    }
  }
  return {
    opened: page.label,
    filters: { ...f },
    link: { surfaceKey: page.key, query },
  };
}
