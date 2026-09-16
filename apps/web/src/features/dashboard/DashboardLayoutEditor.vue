<script setup lang="ts">
/**
 * Rearranging one Dashboard tab (LM10, D-DW3).
 *
 * ── IT EDITS ONE TAB, AND SAVES THE WHOLE ROW ───────────────────────────────────────────────────
 * The stored value is one flat pair of arrays across every tab, because order only means anything
 * within a tab — rendering filters by tab first. The consequence is that saving Fleet must not erase
 * what somebody decided about Dispatch, which is what `mergeTabLayout` is for and why this component
 * hands it the keys it actually OFFERED rather than the whole catalogue.
 *
 * ── NO DRAG AND DROP, DELIBERATELY ──────────────────────────────────────────────────────────────
 * Move-up / move-down buttons. Nine cards is a list somebody reorders once, not a canvas they work
 * in, and buttons are reachable by keyboard and by a screen reader without a library, a second set
 * of pointer-event decisions, or a touch story. If the catalogue ever grows past what a list can
 * hold, that is the moment to reconsider — not before.
 *
 * ── THE RESET IS A DELETE, NOT AN EMPTY SAVE ────────────────────────────────────────────────────
 * D-DW3's three states: no row means "inherit the role default", and that is the state "Restore the
 * default" must produce. Saving an empty layout would mean "show me nothing" and would freeze this
 * person out of every default the product ever changes again.
 */
import { ref, computed, watch } from "vue";
import { AppButton as BaseButton, AppIcon } from "@silvicom/ui";
import { ChevronUpIcon, ChevronDownIcon, EyeIcon, EyeSlashIcon } from "@silvicom/ui/icons";
import { mergeTabLayout, type DashboardWidget, type StoredDashboardLayout } from "@silvicom/shared";
import SlideOver from "@/components/SlideOver.vue";
import { useToastStore } from "@/stores/toast";
import { useDashboardLayout } from "@/composables/useDashboardLayout";

const props = defineProps<{
  open: boolean;
  /** Every widget on this tab the caller's gates admit, in catalogue order. */
  offered: readonly DashboardWidget[];
  /** The ones on screen now, in the order they are on screen. */
  arranged: readonly DashboardWidget[];
}>();
const emit = defineEmits<{ close: [] }>();

const toast = useToastStore();
const { layout: stored, saving, save, reset } = useDashboardLayout();

interface Row {
  key: string;
  label: string;
  shown: boolean;
}

const rows = ref<Row[]>([]);

/**
 * Seeded when the drawer OPENS, not computed.
 *
 * A `computed` would fight the person using it: every move would be overwritten on the next render
 * of the dashboard behind the drawer. The same reason `DashboardPage.vue` seeds its active tab once
 * rather than deriving it.
 */
function seed() {
  const shownKeys = props.arranged.map((w) => w.key);
  const shown = props.arranged.map((w) => ({ key: w.key, label: w.label, shown: true }));
  // Hidden ones keep catalogue order among themselves and sit after the visible list, which is where
  // they will be if they are turned back on.
  const hidden = props.offered
    .filter((w) => !shownKeys.includes(w.key))
    .map((w) => ({ key: w.key, label: w.label, shown: false }));
  rows.value = [...shown, ...hidden];
}
watch(() => props.open, (open) => { if (open) seed(); }, { immediate: true });

const visibleCount = computed(() => rows.value.filter((r) => r.shown).length);

function move(index: number, by: -1 | 1) {
  const to = index + by;
  if (to < 0 || to >= rows.value.length) return;
  const next = [...rows.value];
  const [row] = next.splice(index, 1);
  next.splice(to, 0, row!);
  rows.value = next;
}

async function onSave() {
  const body = mergeTabLayout(
    stored.value ?? null,
    props.offered.map((w) => w.key),
    rows.value.filter((r) => r.shown).map((r) => r.key),
    rows.value.filter((r) => !r.shown).map((r) => r.key),
  ) satisfies StoredDashboardLayout;
  try {
    await save(body);
    toast.success("Dashboard saved");
    emit("close");
  } catch (e) {
    toast.error("Could not save your dashboard", e instanceof Error ? e.message : undefined);
  }
}

async function onReset() {
  try {
    await reset();
    toast.success("Default dashboard restored");
    emit("close");
  } catch (e) {
    toast.error("Could not restore the default", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <SlideOver
    :open="open"
    title="Customize this dashboard"
    description="Choose which cards you see and the order they appear in. Only you see this."
    @close="emit('close')"
  >
    <ul class="space-y-2">
      <li
        v-for="(row, i) in rows"
        :key="row.key"
        class="flex items-center gap-2 rounded-control bg-surface px-3 py-2 ring-1 ring-edge ring-inset"
      >
        <span class="min-w-0 flex-1 truncate text-sm" :class="row.shown ? 'text-ink' : 'text-ink-muted'">
          {{ row.label }}
        </span>

        <BaseButton
          type="button"
          variant="ghost"
          size="icon"
          :disabled="i === 0"
          :aria-label="`Move ${row.label} up`"
          @click="move(i, -1)"
        >
          <AppIcon :icon="ChevronUpIcon" class="size-4" aria-hidden="true" />
        </BaseButton>
        <BaseButton
          type="button"
          variant="ghost"
          size="icon"
          :disabled="i === rows.length - 1"
          :aria-label="`Move ${row.label} down`"
          @click="move(i, 1)"
        >
          <AppIcon :icon="ChevronDownIcon" class="size-4" aria-hidden="true" />
        </BaseButton>
        <BaseButton
          type="button"
          variant="ghost"
          size="icon"
          :aria-label="row.shown ? `Hide ${row.label}` : `Show ${row.label}`"
          :aria-pressed="!row.shown"
          @click="row.shown = !row.shown"
        >
          <AppIcon :icon="row.shown ? EyeIcon : EyeSlashIcon" class="size-4" aria-hidden="true" />
        </BaseButton>
      </li>
    </ul>

    <!-- Said before they save, not after: an empty tab is a surprising result and this is the one
         place it can be explained while it is still a choice. -->
    <p v-if="visibleCount === 0" class="mt-4 text-xs text-ink-muted">
      Nothing is showing on this tab. Save and it stays empty until you turn a card back on, or
      restore the default.
    </p>

    <template #footer>
      <!--
        ⚠ The footer slot is a plain `div` with no display of its own, so the layout has to be here.
        A bare `flex-1` spacer between the buttons does NOT work: it is a block element among inline
        ones and takes a line to itself, which put "Restore the default" on its own row above a
        left-aligned Cancel/Save. Seen in the browser, not in a test — the unit tests find these
        buttons by label and are perfectly happy with them stacked wrongly.

        Restore sits apart from the pair because it is the destructive-ish one: it discards an
        arrangement rather than declining to change it. Stacked on a phone with Save at the bottom
        where a thumb is, the same call `ApplicationReviewDrawer` records.
      -->
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <BaseButton type="button" variant="ghost" :disabled="saving" @click="onReset">
          Restore the default
        </BaseButton>
        <div class="hidden sm:block sm:flex-1"></div>
        <BaseButton type="button" variant="secondary" :disabled="saving" @click="emit('close')">
          Cancel
        </BaseButton>
        <BaseButton type="button" variant="primary" :disabled="saving" @click="onSave">
          {{ saving ? "Saving…" : "Save" }}
        </BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
