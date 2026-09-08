<script setup lang="ts">
import { computed } from "vue";
import { featureConfigSchemas } from "@silvicom/shared";
import { AppSelect, AppSwitch as BaseSwitch, AppFormField as FormField } from "@silvicom/ui";

/**
 * The two choices under the `tab.score` feature: how deep the score goes in the driver app, and
 * whether Home shows the fleet leaderboard (D-DB18). Both live in ONE config row, so every write
 * carries the other's current value rather than resetting it to the catalog default — which is
 * why they are one component rather than two independent controls on the page.
 */
const props = defineProps<{
  /** The org's stored `tab.score` config, or undefined when the org has no row yet. */
  config: Record<string, unknown> | undefined;
  disabled: boolean;
}>();
const emit = defineEmits<{ save: [config: Record<string, unknown>] }>();

const parsed = computed(() => {
  const result = featureConfigSchemas["tab.score"].safeParse(props.config ?? {});
  return result.success ? result.data : featureConfigSchemas["tab.score"].parse({});
});

const depths = [
  { label: "Home + Score tab", value: "tab" },
  { label: "Home summary only", value: "home" },
];
const depth = computed(() => (parsed.value.detailTab ? "tab" : "home"));
const leaderboardOn = computed(() => parsed.value.leaderboard);
</script>

<template>
  <div class="mt-3 max-w-xs">
    <FormField v-slot="{ id }" label="Visibility">
      <AppSelect
        :id="id"
        :model-value="depth"
        :options="depths"
        aria-label="Driver score visibility"
        :disabled="disabled"
        @update:model-value="emit('save', { ...parsed, detailTab: String($event) === 'tab' })"
      />
    </FormField>
    <div class="mt-3 flex items-center justify-between gap-3">
      <div class="min-w-0">
        <p class="text-sm text-ink">Fleet leaderboard on Home</p>
        <p class="text-xs text-ink-muted">The week's top five drivers by first name and grade, plus the driver's own place.</p>
      </div>
      <BaseSwitch
        :model-value="leaderboardOn"
        :disabled="disabled"
        :aria-label="`${leaderboardOn ? 'Hide' : 'Show'} the fleet leaderboard`"
        @update:model-value="(value: boolean) => emit('save', { ...parsed, leaderboard: value })"
      />
    </div>
  </div>
</template>
