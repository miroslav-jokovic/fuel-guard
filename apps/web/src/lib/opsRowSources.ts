/**
 * Every Operations card's rows, by widget key — what the tab's "Needs action" card reads
 * (SMALL-SCREENS-PLAN.md D-SM12, Q-SM3; C2, 2026-11-15).
 *
 * ── WHY HERE ─────────────────────────────────────────────────────────────────────────────────────
 * Each card lives in the feature that owns its data (D-FM8), and `lint:boundaries` refuses one
 * feature reading another's. A card that lists rows from ten features therefore cannot live in any of
 * them. `lib/` is the Dashboard's composition root — `dashboardWidgets.ts` already names every
 * feature's card for the same reason — so it may name every feature's rows too. Each entry is the
 * composable the card ITSELF draws from, so a row here and the row on its card are one computation.
 *
 * ── ONE SOURCE PER CARD, IN BOTH DIRECTIONS ──────────────────────────────────────────────────────
 * A card added to the tab without an entry here would be a card whose alarms "Needs action" silently
 * never lists. `opsNeedsAction.test.ts` asserts the keys are exactly the catalogue's Operations cards
 * minus the aggregate itself.
 */
import { defineComponent, toRef, watch, type ComputedRef, type PropType, type Ref } from "vue";
import type { DayWindow } from "@silvicom/shared";
import type { CountRow } from "@/components/ui/CountList.vue";
import { useFleetNowRows } from "@/features/dispatch/useFleetNowRows";
import { useRoadAttentionRows } from "@/features/dispatch/useRoadAttentionRows";
import { useDriverFilesRows } from "@/features/compliance/useDriverFilesRows";
import { useSeatsRows } from "@/features/roster/useSeatsRows";
import { useTruckPapersRows } from "@/features/roster/useTruckPapersRows";
import { useShopRows } from "@/features/maintenance/useShopRows";
import { useOpsFuelRows } from "@/features/dashboard/widgets/useOpsFuelRows";
import { useHazmatReviewRows } from "@/features/hazmat/useHazmatReviewRows";
import { useHiringRows } from "@/features/recruitment/useHiringRows";
import { useRoadsideRows } from "@/features/roadside/useRoadsideRows";

/** The page's range goes to every source; only a card that takes it (Roadside, IC16) reads it. */
export type OpsRowSource = (range: Ref<DayWindow>) => { rows: ComputedRef<CountRow[]> };

export const OPS_ROW_SOURCES: Record<string, OpsRowSource> = {
  "ops.fleet-now": useFleetNowRows,
  "ops.road-attention": useRoadAttentionRows,
  "ops.driver-files": useDriverFilesRows,
  "ops.seats": useSeatsRows,
  "ops.shop": useShopRows,
  "ops.truck-papers": useTruckPapersRows,
  "ops.fuel": useOpsFuelRows,
  "ops.hazmat": useHazmatReviewRows,
  "ops.hiring": useHiringRows,
  "ops.roadside": useRoadsideRows,
};

/**
 * One source, mounted — it draws nothing and reports its rows.
 *
 * ── WHY A COMPONENT AND NOT A LOOP OVER THE COMPOSABLES ──────────────────────────────────────────
 * A source's composable starts its read the moment it is called, and a read for a section the caller
 * does not hold is a request the API refuses. So a source must run ONLY for a reader its card's gate
 * admits (D-FM4) — and a composable cannot be called conditionally, or later when a gate changes,
 * from another component's setup. Mounting is the one conditional way to run one: `v-for` over the
 * admitted sources starts exactly those reads, and a source whose gate closes unmounts and stops.
 */
export const OpsRowSourceProbe = defineComponent({
  name: "OpsRowSourceProbe",
  props: {
    source: { type: Function as PropType<OpsRowSource>, required: true },
    range: { type: Object as PropType<DayWindow>, required: true },
  },
  emits: { rows: (_rows: CountRow[]) => true },
  setup(props, { emit }) {
    const { rows } = props.source(toRef(props, "range"));
    watch(rows, (r) => emit("rows", r), { immediate: true });
    return () => null;
  },
});
