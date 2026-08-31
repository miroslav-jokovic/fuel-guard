<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { AppIcon, AppButton as BaseButton, AppInput } from "@silvicom/ui";
import { BookmarkIcon, TrashIcon } from "@silvicom/ui/icons";
import { useFloating, offset, flip, shift, autoUpdate } from "@floating-ui/vue";
import type { BuiltInView, SavedView } from "@silvicom/shared";

/**
 * The reader's saved views for one table (D-ROS14, R3c-2), in `FilterBar`'s `#actions` slot.
 *
 * ── APPLYING A VIEW IS A NAVIGATION, WHICH IS THE WHOLE DESIGN ──────────────────────────────────
 * This component never sets a filter. It emits the view's query string and the page navigates to it,
 * so the URL afterwards IS the view — the same URL you would get by pasting the link. There is no
 * second code path that "applies" a view, and therefore no way for a saved view and its link to
 * drift apart.
 *
 * ── WHY SAVE OFFERS THE CURRENT NAME BACK ───────────────────────────────────────────────────────
 * Save is idempotent on the name (the table's primary key), so typing a name you already used
 * replaces that view. Pre-filling the name of the view you are looking at makes "adjust it and save
 * it again" the obvious path, and typing a new name the deliberate one. Without it, updating a view
 * means retyping its name exactly, and the failure mode is a near-duplicate rather than an error.
 */
const props = defineProps<{
  /**
   * The carrier-standard views (D-ROS16) — shipped in `@silvicom/shared`, stored nowhere, identical
   * for every org. Listed above the reader's own because they are what a new safety manager needs on
   * their first morning, before they have saved anything.
   */
  builtIns: readonly BuiltInView[];
  views: SavedView[];
  /** The query string the table is showing right now — what Save would store. */
  currentQuery: string;
  /** The name of the view matching `currentQuery`, when one does. */
  activeName: string | null;
  busy: boolean;
}>();

const emit = defineEmits<{
  apply: [query: string];
  save: [name: string];
  remove: [name: string];
}>();

const open = ref(false);
const draftName = ref("");
const triggerRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const { floatingStyles } = useFloating(triggerRef, panelRef, {
  placement: "bottom-end",
  middleware: [offset(4), flip(), shift({ padding: 8 })],
  whileElementsMounted: autoUpdate,
});

// Escape from anywhere, including from the name field — see ColumnPicker.vue for why it is a
// document listener rather than a handler on the panel.
const onKey = (e: KeyboardEvent) => {
  if (e.key === "Escape") open.value = false;
};
watch(open, (isOpen) => {
  if (isOpen) {
    draftName.value = props.activeName ?? "";
    document.addEventListener("keydown", onKey);
  } else {
    document.removeEventListener("keydown", onKey);
  }
});
onBeforeUnmount(() => document.removeEventListener("keydown", onKey));

function onSave() {
  const name = draftName.value.trim();
  if (!name) return;
  emit("save", name);
  open.value = false;
}
function onApply(view: { query: string }) {
  emit("apply", view.query);
  open.value = false;
}
</script>

<template>
  <div class="relative">
    <button
      ref="triggerRef"
      type="button"
      class="inline-flex items-center gap-x-1.5 rounded-control bg-surface px-2.5 py-1.5 text-sm font-medium text-ink-secondary ring-1 ring-inset ring-edge hover:bg-surface-subtle"
      :aria-expanded="open"
      aria-haspopup="dialog"
      @click.stop="open = !open"
    >
      <AppIcon :icon="BookmarkIcon" class="size-4 text-ink-tertiary" aria-hidden="true" />
      {{ props.activeName ?? "Views" }}
    </button>
    <Teleport to="body">
      <template v-if="open">
        <button type="button" class="fixed inset-0 z-scrim" aria-label="Close the view list" @click.stop="open = false" />
        <div
          ref="panelRef"
          :style="floatingStyles"
          class="z-popover w-72 rounded-control bg-surface p-4 text-sm shadow-overlay ring-1 ring-edge-subtle"
          role="dialog"
          aria-label="Saved views"
        >
          <div v-if="props.builtIns.length" class="space-y-1">
            <p class="px-1.5 pb-1 text-2xs font-medium uppercase tracking-wide text-ink-tertiary">
              Standard
            </p>
            <BaseButton
              v-for="built in props.builtIns"
              :key="built.name"
              variant="ghost"
              size="sm"
              class="w-full justify-start truncate"
              :title="built.description"
              @click="onApply(built)"
            >
              {{ built.name }}
            </BaseButton>
          </div>

          <p
            v-if="props.builtIns.length && props.views.length"
            class="mt-3 border-t border-edge-subtle px-1.5 pt-3 text-2xs font-medium uppercase tracking-wide text-ink-tertiary"
          >
            Yours
          </p>
          <div v-if="props.views.length" class="space-y-1">
            <div
              v-for="view in props.views"
              :key="view.name"
              class="flex items-center gap-1 rounded-control hover:bg-surface-subtle"
            >
              <BaseButton
                variant="ghost"
                size="sm"
                class="min-w-0 flex-1 justify-start truncate"
                @click="onApply(view)"
              >
                {{ view.name }}
              </BaseButton>
              <BaseButton
                variant="ghost"
                size="sm"
                :disabled="props.busy"
                :aria-label="`Delete the view ${view.name}`"
                @click="emit('remove', view.name)"
              >
                <AppIcon :icon="TrashIcon" class="size-4 text-ink-tertiary" aria-hidden="true" />
              </BaseButton>
            </div>
          </div>
          <p v-else-if="!props.builtIns.length" class="text-ink-muted">
            No saved views yet. Filter the roster the way you want it, then name it here.
          </p>

          <div class="mt-3 space-y-2 border-t border-edge-subtle pt-3">
            <AppInput
              v-model="draftName"
              placeholder="Name this view…"
              :maxlength="60"
              @keydown.enter="onSave"
            />
            <BaseButton
              variant="primary"
              size="sm"
              class="w-full"
              :disabled="props.busy || !draftName.trim()"
              @click="onSave"
            >
              {{ props.activeName && draftName.trim() === props.activeName ? "Update this view" : "Save this view" }}
            </BaseButton>
          </div>
        </div>
      </template>
    </Teleport>
  </div>
</template>
