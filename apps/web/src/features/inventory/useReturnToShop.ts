import { computed, ref } from "vue";
import type { AssetDto, AssetMovementInput } from "@silvicom/shared";
import { useToastStore } from "@/stores/toast";
import { defaultReturnBay } from "./driverHeldMove";
import { useLocationsQuery } from "./useInventory";
import { useMoveAsset } from "./useAssets";

/**
 * Return to shop — the one verb for "take it off this truck / back from this driver" (EA1), from the
 * equipment card and, since EA4, from the Scan page's card. One implementation, so both doors write
 * the same row.
 *
 * ── ONE TAP WHEN THE SHOP HAS ONE BAY ─────────────────────────────────────────────────────────
 * Production has one bay (2026-10-30), so asking "which bay?" would be a question with one answer.
 * With one, the move is written at once (`removed`, the word the move drawer's Return writes); with
 * none or several, `giveBack` answers `false` and the caller opens the move drawer, which asks.
 *
 * The movement id is kept per item until it lands, so a second tap after a lost answer re-sends the
 * same move rather than writing another (D-INV27).
 */
export function useReturnToShop() {
  const toast = useToastStore();
  const record = useMoveAsset();
  const { data: locations } = useLocationsQuery();
  const ids = new Map<string, string>();
  const returning = ref<string | null>(null);
  const bay = computed(() => defaultReturnBay(locations.value ?? []));

  /** True when it was returned (or the attempt was reported); false when the caller must ask where. */
  async function giveBack(asset: AssetDto): Promise<boolean> {
    if (!bay.value) return false;
    const id = ids.get(asset.id) ?? crypto.randomUUID();
    ids.set(asset.id, id);
    returning.value = asset.id;
    try {
      await record.mutateAsync({
        id,
        assetId: asset.id,
        reason: "removed",
        toLocationId: bay.value,
        occurredAt: new Date().toISOString(),
      } as AssetMovementInput);
      ids.delete(asset.id);
      toast.success(`${asset.displayNo} returned to the shop`);
    } catch (e) {
      toast.error("Could not return it", e instanceof Error ? e.message : undefined);
    } finally {
      returning.value = null;
    }
    return true;
  }

  return { giveBack, returning, locations };
}
