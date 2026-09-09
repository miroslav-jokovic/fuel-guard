import { computed, type Ref } from "vue";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/vue-query";
import { apiFetch } from "@/lib/api";
import type {
  CountSessionDto,
  CountSessionInput,
  PartMovementInput,
  PartDto,
  PartInput,
  StockLocationInput,
  PartMovementDto,
  StockLineDto,
  StockLineSettings,
  StockLocationDto,
} from "@silvicom/shared";

/**
 * Shop inventory, client side (INVENTORY-PLAN.md step I4).
 *
 * ── EVERY KEY STARTS `["inventory", …]` ────────────────────────────────────────────────────────
 * One prefix for the whole feature, so a write can invalidate the shelf, the catalogue and the
 * ledger with one call — which is what a movement actually changes. The alternative, invalidating
 * three keys by name at each mutation, is three chances to forget the third; the part detail reads
 * the catalogue row AND the stock lines AND the movements, and all three move when a part is
 * received.
 *
 * ── THE MOVEMENT ID IS MINTED BY THE SCREEN, NEVER BY THIS FILE ───────────────────────────────
 * ⚠ `useRecordMovement` takes a whole `PartMovementInput`, id included, and does not generate one.
 * That is D-INV27 and it is the single easiest thing in this feature to get wrong: the id is the
 * idempotency key, so it must be minted ONCE PER MOVEMENT and reused on every retry. A hook that
 * called `crypto.randomUUID()` inside its `mutationFn` would mint one per ATTEMPT — every retry
 * would become a second movement, the shelf would drift by exactly the number of times the network
 * was bad, and no test would fail. `MovementDrawer.vue` owns the id's lifetime because it owns the
 * form's.
 */

const PER_PAGE = 50;

export interface PartsFilter {
  search?: string;
  category?: string;
  includeInactive?: boolean;
  page: number;
}

export interface PartDetail {
  part: PartDto;
  stock: StockLineDto[];
  /** Signed, 300 s (D-INV8). Null until a photo is attached. */
  photoUrl: string | null;
}

export function usePartsQuery(filter: Ref<PartsFilter>) {
  return useQuery({
    queryKey: ["inventory", "parts", filter] as const,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<{ parts: PartDto[]; total: number }> => {
      const f = filter.value;
      const params = new URLSearchParams({
        limit: String(PER_PAGE),
        offset: String((f.page - 1) * PER_PAGE),
      });
      if (f.search) params.set("search", f.search);
      if (f.category) params.set("category", f.category);
      if (f.includeInactive) params.set("includeInactive", "true");
      const r = await apiFetch<{ parts: PartDto[]; total: number }>(
        `/api/maintenance/inventory/parts?${params}`,
      );
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load parts");
      return r.data;
    },
  });
}

export function usePartQuery(id: Ref<string>) {
  return useQuery({
    queryKey: ["inventory", "part", id] as const,
    enabled: computed(() => Boolean(id.value)),
    queryFn: async (): Promise<PartDetail> => {
      const r = await apiFetch<PartDetail>(`/api/maintenance/inventory/parts/${id.value}`);
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load the part");
      return r.data;
    },
  });
}

/**
 * The shop's locations. `includeInactive` is for the manager screen, which has to show a closed bay
 * to reopen it; every picker takes the default, because a movement into a closed location is
 * refused by the RPC (`IV012`) and offering one would be an error the form could have prevented.
 */
export function useLocationsQuery(includeInactive = false) {
  return useQuery({
    queryKey: ["inventory", "locations", includeInactive] as const,
    queryFn: async (): Promise<StockLocationDto[]> => {
      const r = await apiFetch<{ locations: StockLocationDto[] }>(
        `/api/maintenance/inventory/locations${includeInactive ? "?includeInactive=true" : ""}`,
      );
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load stock locations");
      return r.data.locations;
    },
  });
}

/**
 * Everything that has fallen to its reorder point.
 *
 * Deliberately takes no page argument, because the endpoint takes none: a low-stock list that
 * under-reports says "nothing to order" and is believed, so the API returns the whole thing (the
 * defect the 2026-09-09 review of I0–I3 found and fixed). A `limit` added here would put the
 * shortfall back one layer up.
 */
export function useLowStockQuery() {
  return useQuery({
    queryKey: ["inventory", "low-stock"] as const,
    queryFn: async (): Promise<{ lines: StockLineDto[]; total: number }> => {
      const r = await apiFetch<{ lines: StockLineDto[]; total: number }>(
        "/api/maintenance/inventory/low-stock",
      );
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load low stock");
      return r.data;
    },
  });
}

/**
 * Create a stock location, and close or rename one.
 *
 * ⚠ **The plan assigned this write to no step at all**, and I4 found it the way the 2026-09-09
 * review found the missing `reorder_point` writer: by measuring. On 2026-09-09 production held
 * **zero rows in all four inventory tables**, and `stock_locations` is the one nothing could ever
 * put a row in — I3 shipped `POST /locations` and `PATCH /locations/:id` with no consumer, no step
 * owns the screen, and I11's settings drawer picks a DEFAULT location, which presumes some exist.
 * Without this the shelf picker on a part is an empty list, I5's receive drawer has nowhere to
 * receive into, and the whole feature is unreachable on day one for a reason no screen explains.
 */
export function useCreateLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: StockLocationInput): Promise<StockLocationDto> => {
      const r = await apiFetch<{ location: StockLocationDto }>("/api/maintenance/inventory/locations", {
        method: "POST",
        body: input,
      });
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not add the location");
      return r.data.location;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["inventory"] }),
  });
}

export function useUpdateLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; patch: Partial<StockLocationInput> }): Promise<void> => {
      const r = await apiFetch(`/api/maintenance/inventory/locations/${input.id}`, {
        method: "PATCH",
        body: input.patch,
      });
      if (!r.ok) throw new Error(r.error?.message ?? "Could not save the location");
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["inventory"] }),
  });
}

/**
 * The five desk verbs, one route each (`/receive`, `/issue`, `/adjust`, `/transfer`, `/return`).
 *
 * One hook rather than five, because after validation they differ in nothing this layer does — the
 * path is the reason and the payload is the contract's own discriminated union, so a caller cannot
 * post a receipt to `/adjust` without a type error. The API's own routes are five for the opposite
 * reason: there the shapes have to BE the rules at the edge.
 *
 * **201 on a replay is a success, not a failure.** `record_part_movement` returns the existing row
 * for an id it has already seen, so a queue flushing twice gets the same movement both times.
 */
const VERB_PATH: Record<PartMovementInput["reason"], string> = {
  received: "receive",
  issued: "issue",
  adjusted: "adjust",
  transferred: "transfer",
  returned: "return",
  counted: "count",
};

export function useRecordMovement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PartMovementInput): Promise<PartMovementDto> => {
      const r = await apiFetch<{ movement: PartMovementDto }>(
        `/api/maintenance/inventory/${VERB_PATH[input.reason]}`,
        { method: "POST", body: input },
      );
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not record the movement");
      return r.data.movement;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["inventory"] }),
  });
}

/**
 * Attach a photo to a part: ask the API to sign an upload, then PUT the bytes straight to Storage.
 *
 * ⚠ **This closes a route that shipped at I3 with no consumer** — `POST /parts/:id/photo` has been
 * live since 2026-09-09 and nothing in the product called it, which is the same defect the I0–I3
 * review found twice and which `useAttachAssetPhoto` avoided at I8 by shipping its screen with it.
 * The part detail renders `photoUrl` and had no way to produce one.
 *
 * The bytes never touch the API process (D-INV8, `inventory/photos.ts`), and the part row is
 * pointed at the path by the signing call itself — so a phone that uploads and then loses its
 * connection has still recorded where the photo will be.
 */
export function useAttachPartPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; file: File }): Promise<void> => {
      const r = await apiFetch<{ uploadUrl: string; token: string }>(
        `/api/maintenance/inventory/parts/${input.id}/photo`,
        { method: "POST", body: { photoId: crypto.randomUUID(), contentType: input.file.type } },
      );
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not start the upload");
      const put = await fetch(r.data.uploadUrl, {
        method: "PUT",
        headers: { "content-type": input.file.type },
        body: input.file,
      });
      if (!put.ok) throw new Error("The photo did not upload. Try again.");
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["inventory"] }),
  });
}

// ── count sessions (I5 PR 2a; the count screen itself is 2b) ─────────────────────────────────────

export function useCountSessionsQuery(status?: Ref<"open" | "closed" | undefined>) {
  return useQuery({
    queryKey: ["inventory", "count-sessions", status ?? null] as const,
    queryFn: async (): Promise<{ sessions: CountSessionDto[]; total: number }> => {
      const params = status?.value ? `?status=${status.value}` : "";
      const r = await apiFetch<{ sessions: CountSessionDto[]; total: number }>(
        `/api/maintenance/inventory/count-sessions${params}`,
      );
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load counts");
      return r.data;
    },
  });
}

/**
 * Open a walk. The server mints the id — the opposite of a movement, and deliberately: a session is
 * started with the network up, because the screen cannot show what to count without it, while a
 * movement is what the phone queues in a dead bay. Two taps of Start must not make two walks.
 */
/** One walk, by id — what the count screen opens on. */
export function useCountSessionQuery(id: Ref<string>) {
  return useQuery({
    queryKey: ["inventory", "count-session", id] as const,
    enabled: computed(() => Boolean(id.value)),
    queryFn: async (): Promise<CountSessionDto> => {
      const r = await apiFetch<{ session: CountSessionDto }>(
        `/api/maintenance/inventory/count-sessions/${id.value}`,
      );
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load the count");
      return r.data.session;
    },
  });
}

/**
 * The shelf lines at one location — what a walk of that bay counts.
 *
 * `enabled` on the location, because the count screen learns which bay it is about from the SESSION
 * and cannot ask for the shelf before that resolves.
 */
export function useStockQuery(locationId: Ref<string | undefined>) {
  return useQuery({
    queryKey: ["inventory", "stock", locationId] as const,
    enabled: computed(() => Boolean(locationId.value)),
    queryFn: async (): Promise<{ lines: StockLineDto[]; total: number }> => {
      const r = await apiFetch<{ lines: StockLineDto[]; total: number }>(
        `/api/maintenance/inventory/stock?locationId=${locationId.value}`,
      );
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load the shelf");
      return r.data;
    },
  });
}

export function useOpenCountSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CountSessionInput): Promise<CountSessionDto> => {
      const r = await apiFetch<{ session: CountSessionDto }>("/api/maintenance/inventory/count-sessions", {
        method: "POST",
        body: input,
      });
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not start the count");
      return r.data.session;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["inventory"] }),
  });
}

export function useCloseCountSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; note?: string | null }): Promise<CountSessionDto> => {
      const r = await apiFetch<{ session: CountSessionDto }>(
        `/api/maintenance/inventory/count-sessions/${input.id}/close`,
        { method: "POST", body: { note: input.note ?? null } },
      );
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not close the count");
      return r.data.session;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["inventory"] }),
  });
}

export interface MovementsFilter {
  partId?: string;
  since?: string;
  page: number;
}

export function useMovementsQuery(filter: Ref<MovementsFilter>) {
  return useQuery({
    queryKey: ["inventory", "movements", filter] as const,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<{ movements: PartMovementDto[]; total: number }> => {
      const f = filter.value;
      const params = new URLSearchParams({
        limit: String(PER_PAGE),
        offset: String((f.page - 1) * PER_PAGE),
      });
      if (f.partId) params.set("partId", f.partId);
      if (f.since) params.set("since", f.since);
      const r = await apiFetch<{ movements: PartMovementDto[]; total: number }>(
        `/api/maintenance/inventory/movements?${params}`,
      );
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load the movement history");
      return r.data;
    },
  });
}

export function useCreatePart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PartInput): Promise<PartDto> => {
      const r = await apiFetch<{ part: PartDto }>("/api/maintenance/inventory/parts", {
        method: "POST",
        body: input,
      });
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not add the part");
      return r.data.part;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["inventory"] }),
  });
}

/**
 * Edit a part, or retire one.
 *
 * Retiring is `active: false` through this same call rather than a DELETE, and the API records it
 * as its own audit action: a part number that stops appearing in the issue picker is the event
 * somebody searches the log for. Nothing in the product deletes a part — history is denominated in
 * it.
 */
export function useUpdatePart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; patch: Partial<PartInput> }): Promise<PartDto> => {
      const r = await apiFetch<{ part: PartDto }>(`/api/maintenance/inventory/parts/${input.id}`, {
        method: "PATCH",
        body: input.patch,
      });
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not save the part");
      return r.data.part;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["inventory"] }),
  });
}

/**
 * The reorder point, the optional bin fragments, and whether the line is still carried.
 *
 * ⚠ The quantity is deliberately absent, from the body and from the endpoint behind it: it is the
 * ledger's projection and `record_part_movement` is its only writer (D-INV4). A form that could
 * type a total would destroy the evidence for the question the shop actually asks, which is where
 * the eleventh filter went.
 *
 * The line is addressed by its natural key — `part_stock` has no surrogate id, because a stock line
 * IS the (part, location) pair — and the endpoint creates the row when it does not exist yet, which
 * is what makes "we carry this part at the main shelf, tell me at three" sayable before the first
 * delivery has ever been received.
 */
export function useUpdateStockLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      partId: string;
      locationId: string;
      settings: StockLineSettings;
    }): Promise<void> => {
      const r = await apiFetch(
        `/api/maintenance/inventory/stock/${input.partId}/${input.locationId}`,
        { method: "PATCH", body: input.settings },
      );
      if (!r.ok) throw new Error(r.error?.message ?? "Could not save the shelf");
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["inventory"] }),
  });
}
