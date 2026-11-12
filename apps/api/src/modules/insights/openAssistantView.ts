import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ASSISTANT_VIEWS,
  assistantUnitKey,
  fuelProblemsToQuery,
  parseAssistantViewFilters,
  SURFACES,
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

/** Unit numbers to this carrier's vehicle ids, by the assistant's one unit rule (`assistantUnitKey`). */
async function vehicleIdsFor(admin: SupabaseClient, orgId: string, units: readonly string[]) {
  const { data, error } = await admin.from("vehicles").select("id, unit_number").eq("org_id", orgId);
  if (error) throw new Error(error.message);
  const byKey = new Map(
    ((data ?? []) as Array<{ id: string; unit_number: string | null }>).filter((r) => r.unit_number).map((r) => [assistantUnitKey(r.unit_number!), r.id]),
  );
  const ids: string[] = [];
  const notFound: string[] = [];
  for (const u of units) {
    const id = byKey.get(assistantUnitKey(u));
    if (id) ids.push(id);
    else notFound.push(u);
  }
  return { ids: [...new Set(ids)], notFound };
}

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

  // One view today; each view added is one branch here, built by its page's link contract.
  const f = parsed.filters;
  let vehicleIds: string[] = [];
  if (f.units?.length) {
    const found = await vehicleIdsFor(admin, orgId, f.units);
    // A named truck that is not in the fleet is never dropped into "every truck".
    if (found.notFound.length) return { error: `Not in this fleet: ${found.notFound.join(", ")}. Nothing was opened.` };
    vehicleIds = found.ids;
  }
  const query = fuelProblemsToQuery({
    from: f.from,
    to: f.to,
    vehicleIds,
    states: f.states as FindingQueueState[] | undefined,
    kinds: f.kinds as FindingKind[] | undefined,
    mine: f.mine,
  });
  return {
    opened: page.label,
    filters: { ...f },
    link: { surfaceKey: page.key, query },
  };
}
