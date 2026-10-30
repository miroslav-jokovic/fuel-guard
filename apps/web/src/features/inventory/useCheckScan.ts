import { ref, type ComputedRef, type Ref } from "vue";
import type { AssetDto, ScanResult } from "@silvicom/shared";
import { useScanInput } from "@/composables/useScanInput";
import { useAssetTypesQuery } from "./useAssets";
import { resolveScanCode } from "./useScan";
import { judgeScan, type AssignTarget } from "./assignLine";

/**
 * A unit check, by scanner (EA3; EQUIPMENT-ASSIGN-BY-SCAN-PROPOSAL §3.5).
 *
 * ── SCANNING TICKS AN ITEM OFF ────────────────────────────────────────────────────────────────
 * The labels exist so a check is "scan everything you see". A scan of something this unit holds is
 * *It's here* (writes nothing, as the tap does); of something recorded elsewhere, the answer says
 * where and the screen offers *Move it here* — the same `found` move as *One turned up*, so the ledger
 * keeps where it came from. Anything else is judged by `assignLine.ts`, the Assign list's own reading,
 * so the two screens say the same thing about the same label (a tablet goes to a driver; a shop part
 * is not equipment).
 *
 * ── ONE ANSWER LINE, REPLACED BY EACH SCAN ────────────────────────────────────────────────────
 * Ten toasts for ten straps would bury the one that matters — the strap that is on the wrong truck.
 * Tapping still works for a label that will not read; the screen's question card is unchanged.
 */

export type ScanTone = "ok" | "warn" | "danger";
export interface LastScan {
  text: string;
  tone: ScanTone;
  /** Recorded on another holder: the screen offers to move it onto this unit. */
  moveable: AssetDto | null;
}

export const SCAN_TONE: Record<ScanTone, string> = {
  ok: "text-success-700",
  warn: "font-medium text-warning-700",
  danger: "font-medium text-danger-700",
};

export function useCheckScan(opts: {
  /** What this unit holds, as the check lists it (driver's tablet included, D-DE4). */
  held: ComputedRef<AssetDto[]>;
  answered: Ref<Record<string, "found" | "missing">>;
  target: ComputedRef<AssignTarget>;
  markFound: (asset: AssetDto) => void;
  enabled: ComputedRef<boolean>;
}) {
  const { data: types } = useAssetTypesQuery();
  const lastScan = ref<LastScan | null>(null);

  function tick(asset: AssetDto) {
    if (opts.answered.value[asset.id] === "missing") {
      lastScan.value = { text: `${asset.displayNo} was reported missing in this check — undo that report to change it.`, tone: "warn", moveable: null };
      return;
    }
    opts.markFound(asset);
    lastScan.value = { text: `${asset.displayNo} · ${asset.name} — here`, tone: "ok", moveable: null };
  }

  async function onScan(code: string) {
    let result: ScanResult;
    try {
      result = await resolveScanCode(code);
    } catch (e) {
      lastScan.value = { text: e instanceof Error ? e.message : "Could not look that code up.", tone: "danger", moveable: null };
      return;
    }
    const mine = result.kind === "asset" ? opts.held.value.find((a) => a.id === result.asset.id) : undefined;
    if (mine) return tick(mine);
    const v = judgeScan(result, opts.target.value, types.value, null);
    if (v.kind === "here") return tick(v.asset);
    if (v.kind === "assign") {
      lastScan.value = {
        text: `${v.asset.displayNo} · ${v.asset.name} is recorded ${v.fromLabel ? `on ${v.fromLabel}` : "in the shop"}.`,
        tone: "warn",
        moveable: v.asset,
      };
      return;
    }
    const text =
      v.kind === "retired"
        ? `${v.asset.displayNo} is retired — no longer in use.`
        : v.kind === "new"
          ? `${v.message} Add it from the truck's Assign equipment.`
          : v.message;
    lastScan.value = { text, tone: "danger", moveable: null };
  }

  useScanInput({ enabled: opts.enabled, onScan: (code) => void onScan(code) });

  return { lastScan, onScan, SCAN_TONE };
}
