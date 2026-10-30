import { computed, ref, type Ref } from "vue";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/vue-query";
import { apiFetch } from "@/lib/api";
import { recordOrThrow } from "@silvicom/ui";
import { uploadContentType } from "@/lib/fileFormat";
import type {
  AssetCreateInput,
  AssetDto,
  AssetInput,
  AssetMovementDto,
  AssetMovementInput,
  AssetStatus,
  AssetTypeDto,
  AssetTypeInput,
} from "@silvicom/shared";
import { INVENTORY_PHOTO_CONTENT_TYPES, movesHolder } from "@silvicom/shared";

/**
 * The assets, client side (INVENTORY-PLAN.md step I8).
 *
 * ── THE KEYS SHARE `["inventory", …]` WITH THE STOCK HALF ─────────────────────────────────────
 * One prefix for the whole feature, because one action changes both halves: the shop home counts
 * today's movements across parts AND assets, and I9's unit check writes an asset movement against a
 * count session that the parts side opened. Two prefixes would be two chances to forget the second.
 *
 * ── THE MOVEMENT ID IS MINTED BY THE DRAWER, NEVER BY THIS FILE ───────────────────────────────
 * ⚠ Identical to `useInventory.ts`'s rule and identically easy to get wrong. `useMoveAsset` takes a
 * whole `AssetMovementInput`, id included, and does not generate one: the id is D-INV27's
 * idempotency key, so it must be minted ONCE PER MOVEMENT and reused on every retry. A hook calling
 * `crypto.randomUUID()` in its `mutationFn` would mint one per ATTEMPT, and a tablet would appear to
 * have moved once for every time the network was bad — with no test failing.
 */

/** One page of assets, as the API pages them. The list page derives its pagination from this. */
export const ASSETS_PAGE_SIZE = 50;
const PER_PAGE = ASSETS_PAGE_SIZE;

export interface AssetsFilter {
  /** Free text over number, name, serial, make/model and tag — the API's `search`. */
  search?: string;
  assetTypeId?: string;
  status?: AssetStatus;
  locationId?: string;
  vehicleId?: string;
  trailerId?: string;
  unassigned?: boolean;
  /** DE2: one driver's tablets — the driver page's Equipment card. */
  driverId?: string;
  /** D-DE3: tablets whose driver has left. The Inventory tab's *Not returned* filter. */
  notReturned?: boolean;
  /** EA2: Equipment's Drivers tab (`driver`) and In the shop tab (`shop`). */
  holder?: "shop" | "driver";
  page: number;
}

export interface AssetDetail {
  asset: AssetDto;
  /** Signed, 300 s (D-INV8). Null until a photo is attached. */
  photoUrl: string | null;
}

export function useAssetsQuery(filter: Ref<AssetsFilter>, enabled: Ref<boolean> = ref(true)) {
  return useQuery({
    queryKey: ["inventory", "assets", filter] as const,
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<{ assets: AssetDto[]; total: number }> => {
      const f = filter.value;
      const params = new URLSearchParams({
        limit: String(PER_PAGE),
        offset: String((f.page - 1) * PER_PAGE),
      });
      if (f.search) params.set("search", f.search);
      if (f.assetTypeId) params.set("assetTypeId", f.assetTypeId);
      if (f.status) params.set("status", f.status);
      if (f.locationId) params.set("locationId", f.locationId);
      if (f.vehicleId) params.set("vehicleId", f.vehicleId);
      if (f.trailerId) params.set("trailerId", f.trailerId);
      if (f.unassigned) params.set("unassigned", "true");
      if (f.driverId) params.set("driverId", f.driverId);
      if (f.notReturned) params.set("notReturned", "true");
      if (f.holder) params.set("holder", f.holder);
      const r = await apiFetch<{ assets: AssetDto[]; total: number }>(
        `/api/maintenance/inventory/assets?${params}`,
      );
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load assets");
      return r.data;
    },
  });
}

/**
 * *Tablets not returned* (D-DE3): how many tablets sit with a driver who has left.
 *
 * ⚠ The API's `total` for `?notReturned=true&limit=1`, never a page's length. The database counts it
 * (`assets.ts`); a count taken off the fifty rows on screen is the I0–I3 audit's third defect — a number
 * that stops at fifty and is believed.
 */
export function useNotReturnedCountQuery() {
  return useQuery({
    queryKey: ["inventory", "assets", "not-returned-count"] as const,
    queryFn: async (): Promise<number> => {
      const r = await apiFetch<{ assets: AssetDto[]; total: number }>(
        "/api/maintenance/inventory/assets?notReturned=true&limit=1",
      );
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not count the tablets not returned");
      return r.data.total;
    },
  });
}

export function useAssetQuery(id: Ref<string>) {
  return useQuery({
    queryKey: ["inventory", "asset", id] as const,
    enabled: computed(() => Boolean(id.value)),
    queryFn: async (): Promise<AssetDetail> => {
      // A 404 is `NotFoundError` (F21): an asset that is not on the books is not a failed read.
      return recordOrThrow(
        await apiFetch<AssetDetail>(`/api/maintenance/inventory/assets/${id.value}`),
        "Could not load the asset",
      );
    },
  });
}

/**
 * One asset's history, paginated.
 *
 * A page and not the whole thing, because a tablet round the fleet for two years has hundreds of
 * movements and the detail renders thirty. The API pages it for the same reason `/low-stock` does
 * NOT: a history that stops early still answers "what happened recently", while a list of what to
 * order that stops early says "nothing more to order" and is believed.
 */
export function useAssetMovementsQuery(id: Ref<string>, page: Ref<number>) {
  return useQuery({
    queryKey: ["inventory", "asset-movements", id, page] as const,
    enabled: computed(() => Boolean(id.value)),
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<{ movements: AssetMovementDto[]; total: number }> => {
      const params = new URLSearchParams({
        limit: String(PER_PAGE),
        offset: String((page.value - 1) * PER_PAGE),
      });
      const r = await apiFetch<{ movements: AssetMovementDto[]; total: number }>(
        `/api/maintenance/inventory/assets/${id.value}/movements?${params}`,
      );
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load the history");
      return r.data;
    },
  });
}

export function useAssetTypesQuery() {
  return useQuery({
    queryKey: ["inventory", "asset-types"] as const,
    queryFn: async (): Promise<AssetTypeDto[]> => {
      const r = await apiFetch<{ types: AssetTypeDto[] }>("/api/maintenance/inventory/asset-types");
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load asset types");
      return r.data.types;
    },
  });
}

export function useCreateAssetType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AssetTypeInput): Promise<AssetTypeDto> => {
      const r = await apiFetch<{ type: AssetTypeDto }>("/api/maintenance/inventory/asset-types", {
        method: "POST",
        body: input,
      });
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not add the type");
      return r.data.type;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["inventory"] }),
  });
}

/**
 * Edit a type — its name, category, whether it is serialized, its own default quantity, and (DE2b)
 * who holds it.
 *
 * ⚠ `serialized` is not cosmetic: `move_asset` reads it, and `IV020` fires only for a serialized
 * type. Turning it on for ratchet straps would make a trailer unable to accept a second one.
 * ⚠ Nor is `heldBy`: 0524 refuses the switch while any of the type's things sit with the other kind of
 * holder (`held_by_conflict`, 409) — the screen says "move them first", in the API's words.
 */
export function useUpdateAssetType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; patch: Partial<AssetTypeInput> }): Promise<AssetTypeDto> => {
      const r = await apiFetch<{ type: AssetTypeDto }>(
        `/api/maintenance/inventory/asset-types/${input.id}`,
        { method: "PATCH", body: input.patch },
      );
      // The API's `code` travels with the Error (SP9's pattern, `lib/api.ts`): `held_by_conflict` is
      // answered beside the Held-by choice, where the person can act on it, not in a passing toast.
      if (!r.ok || !r.data) {
        throw Object.assign(new Error(r.error?.message ?? "Could not save the type"), { code: r.error?.code });
      }
      return r.data.type;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["inventory"] }),
  });
}

/**
 * Adopt the standard kit (A4, owner 2026-09-09) — the types and the three fleet rules in one call.
 *
 * ⚠ Offered by the screen ONLY while the org has no types at all. It is idempotent about types but
 * it OVERWRITES fleet rules with the catalogue's numbers, so it is a first run and not a reset: a
 * shop that has since decided its trailers carry six straps would find four again.
 */
export function useAdoptStandardKit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<{ typesCreated: number; rulesSet: number }> => {
      const r = await apiFetch<{ typesCreated: number; rulesSet: number }>(
        "/api/maintenance/inventory/asset-types/standard-kit",
        { method: "POST", body: {} },
      );
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not set up the standard kit");
      return r.data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["inventory"] }),
  });
}

export function useCreateAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AssetCreateInput): Promise<AssetDto> => {
      const r = await apiFetch<{ asset: AssetDto }>("/api/maintenance/inventory/assets", {
        method: "POST",
        body: input,
      });
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not add the asset");
      return r.data.asset;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["inventory"] }),
  });
}

/**
 * Edit what an asset IS — its name, serial, warranty, condition, notes, status.
 *
 * ⚠ Not where it is. The holder columns move through `move_asset` and nothing else (D-INV3), so this
 * patch cannot carry one: an edit screen that could quietly re-home a tablet would leave its history
 * saying it is still in 611.
 */
export function useUpdateAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; patch: Partial<AssetInput> }): Promise<AssetDto> => {
      const r = await apiFetch<{ asset: AssetDto }>(`/api/maintenance/inventory/assets/${input.id}`, {
        method: "PATCH",
        body: input.patch,
      });
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not save the asset");
      return r.data.asset;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["inventory"] }),
  });
}

/**
 * Move it, or say something about it.
 *
 * One hook and two routes, and the route is chosen by asking `movesHolder` — the same function the
 * contract's two schemas and the badge rail ask. A `Record` of reason → path written here would be
 * the fourth spelling of one split, and the day an eighth reason arrives it is the copy nobody
 * updates: a new report would be posted to `/move`, the API would refuse it, and the screen would
 * report a failure for a payload that was correct.
 *
 * **201 on a replay is a success, not a failure.** `move_asset` returns the row it already has for
 * an id it has seen, so a queue flushing twice gets the same movement both times.
 */
export function useMoveAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AssetMovementInput): Promise<AssetMovementDto> => {
      const path = movesHolder(input.reason) ? "move" : "report";
      const r = await apiFetch<{ movement: AssetMovementDto }>(
        `/api/maintenance/inventory/assets/${path}`,
        { method: "POST", body: input },
      );
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not record the move");
      return r.data.movement;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["inventory"] }),
  });
}

/**
 * Attach a photo: ask the API to sign an upload, then PUT the bytes straight to Storage.
 *
 * ⚠ The bytes never touch the API process (D-INV8, `inventory/photos.ts`), and the asset row is
 * pointed at the path by the signing call itself — so a phone that uploads and then loses its
 * connection has still recorded where the photo will be. This is the route I3 shipped for parts and
 * no screen ever called; I8 does not repeat that.
 */
export function useAttachAssetPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; file: File }): Promise<void> => {
      const contentType = await uploadContentType(input.file, INVENTORY_PHOTO_CONTENT_TYPES);
      if (!contentType) throw new Error("A photo must be a JPEG (including JFIF), PNG, WebP or HEIC image.");
      const r = await apiFetch<{ uploadUrl: string; token: string }>(
        `/api/maintenance/inventory/assets/${input.id}/photo`,
        { method: "POST", body: { photoId: crypto.randomUUID(), contentType } },
      );
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not start the upload");
      const put = await fetch(r.data.uploadUrl, {
        method: "PUT",
        headers: { "content-type": contentType },
        body: input.file,
      });
      if (!put.ok) throw new Error("The photo did not upload. Try again.");
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["inventory"] }),
  });
}
