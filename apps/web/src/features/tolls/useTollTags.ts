import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { AssignmentVoid, TransponderCreate, TransponderDto, TransponderMove, TransponderRetire } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * The fleet's toll tags, client side (TOLLS-PER-TRUCK-PLAN.md TL2).
 *
 * One read of the whole fleet serves the Vehicles column: about two tags a truck is a few hundred
 * rows, and one request beats one per row. The truck page asks for that truck's tags, which includes
 * every tag it ever carried, so a tag that moved on last week is still on its card. Every write
 * invalidates both under the one `["toll-tags"]` prefix, since a move changes two trucks at once.
 */

const KEY = ["toll-tags"] as const;

export function useTollTagsQuery(vehicleId?: Ref<string>) {
  return useQuery({
    queryKey: [...KEY, vehicleId ?? "fleet"] as const,
    queryFn: async (): Promise<TransponderDto[]> => {
      const q = vehicleId ? `?vehicleId=${encodeURIComponent(vehicleId.value)}` : "";
      const r = await apiFetch<{ transponders: TransponderDto[] }>(`/api/tolls/transponders${q}`);
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load the toll tags");
      return r.data.transponders;
    },
  });
}

/** Each truck's tags in use, by truck id — the Vehicles column reads this. */
export function useTollTagsByVehicle() {
  const query = useTollTagsQuery();
  const byVehicle = computed(() => {
    const map = new Map<string, TransponderDto[]>();
    for (const t of query.data.value ?? []) {
      if (!t.currentVehicleId) continue;
      map.set(t.currentVehicleId, [...(map.get(t.currentVehicleId) ?? []), t]);
    }
    return map;
  });
  return { query, byVehicle };
}

/**
 * A refusal the form can act on. `existing` rides on a 409 `already_registered`: the tag the office
 * typed is on file, and the form offers to move THAT tag here instead of making a second one.
 */
export class TollTagError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly existing: TransponderDto | null,
  ) {
    super(message);
  }
}

async function write(path: string, body: object, fallback: string): Promise<TransponderDto> {
  const r = await apiFetch<{ transponder: TransponderDto }>(path, { method: "POST", body });
  if (!r.ok || !r.data) {
    const existing = (r.detail?.existing as TransponderDto | undefined) ?? null;
    throw new TollTagError(r.error?.message ?? fallback, r.error?.code ?? "unknown", existing);
  }
  return r.data.transponder;
}

export function useTollTagWrites() {
  const qc = useQueryClient();
  const onSuccess = () => void qc.invalidateQueries({ queryKey: KEY });
  return {
    register: useMutation({
      mutationFn: (input: TransponderCreate) => write("/api/tolls/transponders", input, "Could not add the tag"),
      onSuccess,
    }),
    move: useMutation({
      mutationFn: ({ id, input }: { id: string; input: TransponderMove }) =>
        write(`/api/tolls/transponders/${id}/move`, input, "Could not move the tag"),
      onSuccess,
    }),
    retire: useMutation({
      mutationFn: ({ id, input }: { id: string; input: TransponderRetire }) =>
        write(`/api/tolls/transponders/${id}/retire`, input, "Could not retire the tag"),
      onSuccess,
    }),
    voidEntry: useMutation({
      mutationFn: ({ id, input }: { id: string; input: AssignmentVoid }) =>
        write(`/api/tolls/assignments/${id}/void`, input, "Could not void the entry"),
      onSuccess,
    }),
  };
}
