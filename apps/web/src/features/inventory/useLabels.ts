import { useMutation, useQuery } from "@tanstack/vue-query";
import type { LabelFaceDto, LabelTarget } from "@silvicom/shared";
import type { LabelPresetId } from "@silvicom/qr";
import { apiFetch, fetchObjectUrl } from "@/lib/api";

/**
 * Labels, client side (INVENTORY-PLAN.md I10 PR 2).
 *
 * ── THE PRESETS COME FROM THE API RATHER THAN FROM `@silvicom/qr` DIRECTLY ────────────────────
 * This app could import `LABEL_PRESETS` and skip a round trip — it imports the package anyway, for
 * the geometry the preview draws with. It asks the API instead, and the reason is which SERVER is
 * answering: a browser holding a stale bundle would offer a preset the deployed API cannot print,
 * and the failure would be a 422 at the end of a flow rather than an option that was never there.
 * The list is small, cached for the session, and never changes inside one.
 *
 * ⚠ **`useLabelFaces` is a MUTATION and not a query, and that is not a modelling nicety.** Asking
 * what a label will say ISSUES a tag code to anything that has none — `labels.ts` on the API side
 * argues why at length, and the short version is that a preview showing placeholder codes and a
 * sheet carrying different real ones would be a screen lying about the only thing it exists to show.
 * A `useQuery` would refetch on focus and on reconnect, which for a write is the wrong lifecycle
 * even when the write is idempotent.
 */

export interface LabelPresetDto {
  id: LabelPresetId;
  name: string;
  perSheet: number;
  /** What the stock survives (§2.4) — the sentence the screen shows while somebody is choosing. */
  material: string;
  label: { width: number; height: number };
  sheet: { width: number; height: number };
}

export function useLabelPresetsQuery() {
  return useQuery({
    queryKey: ["inventory", "label-presets"] as const,
    staleTime: Infinity,
    queryFn: async (): Promise<LabelPresetDto[]> => {
      const r = await apiFetch<{ presets: LabelPresetDto[] }>("/api/maintenance/inventory/labels/presets");
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load the label stock");
      return r.data.presets;
    },
  });
}

export function useLabelFaces() {
  return useMutation({
    mutationFn: async (targets: LabelTarget[]): Promise<{ faces: LabelFaceDto[]; dropped: number }> => {
      const r = await apiFetch<{ faces: LabelFaceDto[]; dropped: number }>(
        "/api/maintenance/inventory/labels/faces",
        { method: "POST", body: { targets } },
      );
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not read those labels");
      return r.data;
    },
  });
}

export interface LabelRunOptions {
  presetId: LabelPresetId;
  startPosition: number;
  nudgeX: number;
  nudgeY: number;
}

/**
 * Fetch the sheet and hand back an object URL.
 *
 * A blob rather than a navigation, for the reason `fetchObjectUrl`'s own header gives: the route
 * sits behind `requireAuth` and a plain `window.open` on an API path carries no Authorization
 * header. The caller owns the URL and revokes it.
 */
export async function fetchLabelSheet(
  targets: LabelTarget[],
  options: LabelRunOptions,
): Promise<string> {
  return fetchObjectUrl("/api/maintenance/inventory/labels/sheet", {
    method: "POST",
    body: { targets, ...options },
  });
}
