<script setup lang="ts">
import { AppSegmentedControl } from "@silvicom/ui";
import type { DispatchBoardResponse } from "@silvicom/shared";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import { dispatcherOptions, fleetOptions, type ScopeChoice } from "./dispatchScope";

/**
 * My fleet · All, Fleet, Dispatched by — the one scope control both dispatch pages carry (DISPATCH-BOARD-
 * PLAN §5.3 point 1, DB5b). Rendered into a FilterBar's `#filters` slot; the rule it feeds is
 * `admitsScope`. My fleet is disabled for a caller no McLeod login is linked to: the page says why.
 */
defineProps<{
  board: Pick<DispatchBoardResponse, "fleets" | "dispatchers"> | null | undefined;
  linked: boolean;
  /** Shown, not owned: a press is `choose`, so `useScopeChoice` records that the person chose. */
  choice: ScopeChoice;
}>();
const fleet = defineModel<string>("fleet", { required: true });
const dispatcher = defineModel<string>("dispatcher", { required: true });

const SCOPE_OPTIONS = [
  { value: "mine", label: "My fleet" },
  { value: "all", label: "All" },
];
const emit = defineEmits<{ choose: [v: ScopeChoice] }>();
</script>

<template>
  <AppSegmentedControl
    :model-value="choice"
    :options="SCOPE_OPTIONS"
    label="Whose work"
    :disabled="!linked"
    @update:model-value="emit('choose', $event === 'mine' ? 'mine' : 'all')"
  />
  <FilterSelect v-model="fleet" label="Fleet" :options="fleetOptions(board)" />
  <FilterSelect v-model="dispatcher" label="Dispatched by" :options="dispatcherOptions(board)" />
</template>
