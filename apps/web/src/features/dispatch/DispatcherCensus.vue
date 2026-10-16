<script setup lang="ts">
import { computed } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import type { DispatchBoardResponse, DispatchBoardRow } from "@silvicom/shared";
import { dispatcherName, fleetCensus, NO_FLEET_OPTION, POOL_FLEET, POOL_OPTION } from "./dispatchBoardView";
import type { ScopeChoice } from "./dispatchScope";

/**
 * Trucks per dispatcher, in numbers, and the board's scope control at once (DISPATCH-BOARD-V2-PLAN
 * D-DBV2). The owner, after the dispatchers' session (2026-10-15): "dispatch needs to see how many
 * trucks each dispatcher has — we have that, but it is not transparent in numbers." The v1 board had
 * the fleets in a dropdown with no counts, beside a My fleet · All switch; here each fleet is a button
 * with its trucks and how many are empty, and pressing it is the filter — so the count and the control
 * are one thing, never two that could disagree (the live map's census-button rule).
 *
 * "Mine" (fleet ∪ loads I dispatch, D-DB1) leads for a caller linked to a McLeod login; All follows;
 * the parked pool and trucks with no fleet close the strip, each only when it has trucks.
 */
const props = defineProps<{
  /** Every truck the board returned — the census counts the whole fleet, whatever else is narrowed. */
  rows: readonly DispatchBoardRow[];
  /** How many of them are the caller's; null when the caller is linked to no McLeod login. */
  mineCount: number | null;
  board: Pick<DispatchBoardResponse, "fleets" | "dispatchers"> | null | undefined;
  choice: ScopeChoice;
  fleet: string;
}>();
const emit = defineEmits<{ pick: [v: { scope: ScopeChoice; fleet: string }] }>();

const census = computed(() => fleetCensus(props.rows));
const working = computed(() => props.rows.filter((r) => r.fleetCode !== POOL_FLEET));

interface Item {
  key: string;
  label: string;
  /** Who runs the fleet, when an office linked it and the name says more than the code. */
  owner: string | null;
  trucks: number;
  empty: number | null;
  pick: { scope: ScopeChoice; fleet: string };
  pressed: boolean;
}

const items = computed<Item[]>(() => {
  const out: Item[] = [];
  const none = !props.fleet;
  if (props.mineCount != null) {
    out.push({ key: "mine", label: "Mine", owner: null, trucks: props.mineCount, empty: null, pick: { scope: "mine", fleet: "" }, pressed: none && props.choice === "mine" });
  }
  out.push({
    key: "all", label: "All", owner: null, trucks: working.value.length, empty: working.value.filter((r) => r.flags.emptyNow).length,
    pick: { scope: "all", fleet: "" }, pressed: none && props.choice === "all",
  });
  const codes = [...census.value.keys()].filter((c): c is string => c != null && c !== POOL_FLEET).sort();
  for (const code of codes) {
    const c = census.value.get(code)!;
    const linked = props.board?.fleets.find((f) => f.code === code)?.dispatcherId ?? null;
    const name = linked ? dispatcherName(linked, props.board?.dispatchers ?? []) : null;
    out.push({
      key: code, label: code, owner: name && name.toLowerCase() !== code.toLowerCase() ? name : null,
      trucks: c.trucks, empty: c.empty, pick: { scope: "all", fleet: code }, pressed: props.fleet === code,
    });
  }
  const pool = census.value.get(POOL_FLEET);
  if (pool) out.push({ key: POOL_OPTION, label: "Pool", owner: null, trucks: pool.trucks, empty: null, pick: { scope: "all", fleet: POOL_OPTION }, pressed: props.fleet === POOL_OPTION });
  const unfleeted = census.value.get(null);
  if (unfleeted) {
    out.push({ key: NO_FLEET_OPTION, label: "No fleet", owner: null, trucks: unfleeted.trucks, empty: null, pick: { scope: "all", fleet: NO_FLEET_OPTION }, pressed: props.fleet === NO_FLEET_OPTION });
  }
  return out;
});

const title = (i: Item) =>
  `${i.label}${i.owner ? ` (${i.owner})` : ""}: ${i.trucks} ${i.trucks === 1 ? "truck" : "trucks"}${i.empty != null ? `, ${i.empty} empty now` : ""}`;
</script>

<template>
  <!-- Scrolls sideways on a phone rather than wrapping into a wall of buttons: 16 fleets do not fit. -->
  <div role="group" aria-label="Trucks per dispatcher" class="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
    <!-- The live map's census tile (LiveMapRail): a ghost row button, ringed, pressed = in force. The
         `row` size is full-width by design, so each sits in a cell sized to its own content. -->
    <div v-for="i in items" :key="i.key" class="shrink-0">
      <BaseButton
        variant="ghost"
        size="row"
        class="px-2.5 ring-1 ring-inset"
        :class="i.pressed ? 'bg-surface-subtle ring-edge-strong' : 'ring-edge-subtle'"
        :aria-pressed="i.pressed"
        :title="title(i)"
        :aria-label="title(i)"
        @click="emit('pick', i.pick)"
      >
        <span class="flex flex-col items-start">
          <span class="text-xs font-normal text-ink-muted">{{ i.label }}</span>
          <span class="whitespace-nowrap text-sm tabular-nums text-ink">
            <span class="font-semibold">{{ i.trucks }}</span>
            <span v-if="i.empty" class="text-xs font-normal text-ink-muted"> · {{ i.empty }} empty</span>
          </span>
        </span>
      </BaseButton>
    </div>
  </div>
</template>
