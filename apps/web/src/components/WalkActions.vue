<script setup lang="ts">
import { computed, ref } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import { bottomBaseHeight, useBottomChrome } from "@/composables/bottomChrome";

/**
 * A walk's actions, rendered where the hand is (I5 PR 2b, I9; D-INV17 as amended 2026-09-10).
 *
 * ── ONE LIST, TWO PLACES ──────────────────────────────────────────────────────────────────────
 * The count and the check began life in a phone-only shell with a sticky bottom bar, because a
 * technician holding a phone in a bay reaches the bottom of the screen with a thumb and nothing
 * else (research §5.1). The owner then ruled that the screens belong in the app's own shell with
 * its own page anatomy, which puts a page's actions in `PageHeader`'s actions row. Both are right
 * for the device they describe, so the page defines its actions ONCE — a list of label, tone and
 * handler — and this component renders that list in the header row from `md` up and as a fixed
 * bottom bar below it. Two renders of one definition, not two definitions. (`sm` until the contract's
 * §9 rule 2, Maintenance M4: a 700 px phone held sideways is still a phone in a bay.)
 *
 * The bar keeps the two phone facts the old shell carried: the safe-area inset (the primary action
 * otherwise sits under the home indicator) and a scoped rule for it, because `env()` has no
 * utility class and `lint:tokens` refuses an arbitrary one. The page adds bottom padding below `sm`
 * so the bar never covers the last card.
 *
 * On a shop page the bar stands ON the section's tab row (`SectionTabBar`, the base layer in
 * `bottomChrome.ts`) rather than under it: verbs above doors. It then needs no safe-area inset of its
 * own — the row on the edge carries it — and the shell's `--bottom-chrome` pads the page for both.
 */
export interface WalkAction {
  label: string;
  primary?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

defineProps<{
  actions: WalkAction[];
  /** Render as the phone's bottom bar (hidden from `sm` up) instead of the header row (hidden below it). */
  bar?: boolean;
}>();

/** The bar tells the shell how tall it is, so the Ask AI launcher parks above it (bottomChrome.ts). */
const barEl = ref<HTMLElement | null>(null);
useBottomChrome(barEl);
/** Where the bar stands: on the tab row when one is drawn, else on the edge with the inset. */
const onBase = computed(() => bottomBaseHeight.value > 0);
</script>

<template>
  <div
    v-if="bar"
    ref="barEl"
    class="walk-bar fixed inset-x-0 z-raised border-t border-edge bg-surface px-4 md:hidden"
    :class="{ 'walk-bar-on-base': onBase }"
    :style="{ bottom: `${bottomBaseHeight}px` }"
  >
    <div class="flex gap-2">
      <BaseButton
        v-for="action in actions"
        :key="action.label"
        block
        :variant="action.primary ? 'primary' : 'secondary'"
        :disabled="action.disabled"
        @click="action.onClick"
      >
        {{ action.label }}
      </BaseButton>
    </div>
  </div>
  <div v-else class="hidden items-center gap-2 md:flex">
    <BaseButton
      v-for="action in actions"
      :key="action.label"
      :variant="action.primary ? 'primary' : 'secondary'"
      :disabled="action.disabled"
      @click="action.onClick"
    >
      {{ action.label }}
    </BaseButton>
  </div>
</template>

<style scoped>
.walk-bar {
  padding-top: 0.75rem;
  padding-bottom: calc(0.75rem + env(safe-area-inset-bottom));
}
.walk-bar-on-base {
  padding-bottom: 0.75rem;
}
</style>
