<script setup lang="ts">
import { AppBadge, AppButton as BaseButton, AppSwitch } from "@silvicom/ui";
import type { ScreenGroupModel, ScreenRowModel } from "./rows";

/**
 * One principal's SCREENS, grouped the way the sidebar groups them (S3 for a role, S4 for a person).
 *
 * A switch, not a checkbox: the question is "in their sidebar or not", which is a state a switch
 * shows at a glance and flips in one tap on a phone. A screen the principal's section does not
 * reach gets no switch — it says what it needs (D-SURF2), and the section is one card above,
 * which is where widening belongs and is visible as what it is.
 */
defineProps<{ groups: ScreenGroupModel[]; disabled: boolean }>();
const emit = defineEmits<{
  set: [value: { surfaceKey: string; allowed: boolean }];
  reset: [surfaceKey: string];
}>();

function onSet(row: ScreenRowModel, allowed: boolean) {
  emit("set", { surfaceKey: row.key, allowed });
}
</script>

<template>
  <ul class="divide-y divide-edge-subtle">
    <template v-for="g in groups" :key="g.key">
      <li class="bg-surface-subtle px-5 py-1.5 text-xs font-semibold tracking-wide text-ink-muted uppercase">
        {{ g.label }}
      </li>
      <li
        v-for="row in g.rows"
        :key="row.key"
        class="flex min-h-12 items-center justify-between gap-x-4 px-5 py-2"
      >
        <p class="min-w-0 text-sm text-ink">{{ row.label }}</p>
        <div class="flex shrink-0 items-center gap-x-3">
          <template v-if="row.reachable">
            <BaseButton
              v-if="row.reset"
              variant="link"
              :disabled="disabled"
              @click="emit('reset', row.key)"
            >
              {{ row.reset }}
            </BaseButton>
            <AppBadge v-if="row.tag" :tone="row.tag.tone">{{ row.tag.label }}</AppBadge>
            <AppSwitch
              :model-value="row.allowed"
              :label="row.label"
              :disabled="disabled"
              :class="row.inherited ? 'opacity-60' : ''"
              @update:model-value="onSet(row, $event)"
            />
          </template>
          <span v-else class="text-xs text-ink-tertiary">Needs {{ row.need }}</span>
        </div>
      </li>
    </template>
  </ul>
</template>
