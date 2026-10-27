import { computed, type Ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { ScanResult } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * Resolve a scanned code (D-INV7; INVENTORY-PLAN.md I6).
 *
 * ── THE KEY IS NOT PREFIXED `["inventory", …]`, AND THAT IS DELIBERATE ────────────────────────
 * Every other hook in this feature starts its key with `inventory` so that one movement can
 * invalidate the shelf, the catalogue and the ledger together. A scan is not part of that set: the
 * endpoint is product-wide by §2.10 — a future `document` or `invite` kind belongs to other sections
 * entirely — and it lives outside the maintenance module for exactly that reason. Filing it under
 * `inventory` would mean the day somebody scans a DQ binder cover, a part movement invalidates it.
 *
 * ── A SCAN IS NEVER SERVED FROM CACHE ─────────────────────────────────────────────────────────
 * `staleTime: 0` and `gcTime: 0`, which for a read is unusual enough to say why. The answer carries
 * `quantityOnHand` and an asset's current holder, and the whole reason a technician is standing at
 * the shelf with a scanner is that those two numbers change while they work. Scanning the same bin
 * twice in a walk must ask again; a cached answer would show the count from before the case they
 * just put away, and the second scan is usually a person checking exactly that.
 *
 * ⚠ `staleTime: 0` alone did NOT deliver that, and it shipped broken until 2026-10-27
 * (DRIVER-EQUIPMENT-AND-UNIT-TAGS-PLAN.md §5, R2). A query only runs again when its KEY changes,
 * and the second scan of the same bin sets `code` to the value it already holds — so nothing
 * changed, nothing ran, and the screen kept the quantity from before. After a wifi drop it kept the
 * error, with Retry the only way out. `scanSeq` is bumped by EVERY scan, so every trigger pull is a
 * new key and a new request, which is what "never served from cache" has to mean on this screen.
 */
export function useScanQuery(code: Ref<string>, scanSeq: Ref<number>) {
  return useQuery({
    queryKey: ["scan", "resolve", code, scanSeq] as const,
    enabled: computed(() => code.value.length > 0),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    queryFn: async (): Promise<ScanResult> => {
      const r = await apiFetch<{ result: ScanResult }>(
        `/api/tags/resolve?code=${encodeURIComponent(code.value)}`,
      );
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not read that code");
      return r.data.result;
    },
  });
}
