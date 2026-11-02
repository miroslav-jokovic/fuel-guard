<script setup lang="ts">
import { computed, ref, toRef } from "vue";
import { useRouter } from "vue-router";
import {
  Combobox,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
  Dialog,
  DialogPanel,
  TransitionChild,
  TransitionRoot,
} from "@headlessui/vue";
import { AppIcon } from "@silvicom/ui";
import { MagnifyingGlassIcon } from "@silvicom/ui/icons";
import { searchPalette, type PaletteEntry } from "@/lib/commandPalette";
import { searchPlaceholder } from "@/lib/recordSearch";
import { useRecordSearch } from "@/composables/useRecordSearch";

/**
 * "Go to a page" (SIDEBAR-REDESIGN-PLAN.md D-SB1). ⌘K or Ctrl K anywhere in the signed-in app, or the
 * "Search pages" field at the top of the sidebar.
 *
 * What it lists and how it matches are in `lib/commandPalette.ts`, which is where the argument for
 * having no list of its own is written. This file is the dialog: headless UI's Combobox inside its
 * Dialog, so the arrow keys, Enter, Escape, focus trapping and the listbox semantics are the
 * library's tested ones rather than ours.
 *
 * Pages answer at once, from memory; trucks, trailers, drivers and loads (D-SB8) answer a moment later
 * from the server and are listed under the pages, so the rows a person is already arrowing through
 * never move when the records arrive.
 */
const props = defineProps<{ open: boolean; entries: PaletteEntry[] }>();
const emit = defineEmits<{ close: [] }>();

const router = useRouter();
const query = ref("");
const pages = computed(() => searchPalette(props.entries, query.value));
const { kinds, records, failed, searching } = useRecordSearch(query, toRef(props, "entries"));
const placeholder = computed(() => searchPlaceholder(kinds.value));
const nothing = computed(() => !pages.value.length && !records.value.length && !searching.value);

function go(entry: PaletteEntry | null) {
  if (!entry) return;
  emit("close");
  void router.push(entry.to);
}
</script>

<template>
  <TransitionRoot :show="open" as="template" @after-leave="query = ''">
    <Dialog class="relative z-dialog" @close="emit('close')">
      <TransitionChild
        as="template"
        enter="ease-out duration-150"
        enter-from="opacity-0"
        enter-to="opacity-100"
        leave="ease-in duration-100"
        leave-from="opacity-100"
        leave-to="opacity-0"
      >
        <div class="fixed inset-0 bg-scrim/60" aria-hidden="true" />
      </TransitionChild>

      <div class="fixed inset-0 overflow-y-auto p-4 pt-[12vh]">
        <TransitionChild
          as="template"
          enter="ease-out duration-150 motion-reduce:duration-0"
          enter-from="opacity-0 scale-[0.98]"
          enter-to="opacity-100 scale-100"
          leave="ease-in duration-100 motion-reduce:duration-0"
          leave-from="opacity-100 scale-100"
          leave-to="opacity-0 scale-[0.98]"
        >
          <DialogPanel
            class="mx-auto max-w-xl overflow-hidden rounded-dialog bg-surface shadow-overlay ring-1 ring-edge"
            data-test="command-palette"
          >
            <Combobox @update:model-value="go">
              <div class="relative border-b border-edge-subtle">
                <AppIcon
                  :icon="MagnifyingGlassIcon"
                  class="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-ink-tertiary"
                  aria-hidden="true"
                />
                <ComboboxInput
                  class="h-12 w-full border-0 bg-transparent pl-12 pr-4 text-base text-ink placeholder:text-ink-tertiary focus:outline-none focus:ring-0"
                  :placeholder="placeholder"
                  aria-label="Search pages and records"
                  autocomplete="off"
                  @change="query = ($event.target as HTMLInputElement).value"
                />
              </div>

              <ComboboxOptions v-if="!nothing" static class="max-h-96 scroll-py-2 overflow-y-auto p-2">
                <ComboboxOption v-for="entry in pages" :key="entry.to" v-slot="{ active }" :value="entry" as="template">
                  <li
                    class="flex cursor-default select-none items-center gap-3 rounded-control px-3 py-2 text-sm"
                    :class="active ? 'bg-selected-surface text-ink' : 'text-ink-secondary'"
                  >
                    <AppIcon :icon="entry.icon" class="size-5 shrink-0" :class="active ? 'text-brand-accent-strong' : 'text-ink-tertiary'" aria-hidden="true" />
                    <span class="min-w-0 flex-1 truncate font-medium">{{ entry.name }}</span>
                    <span v-if="entry.section" class="shrink-0 text-xs text-ink-tertiary">{{ entry.section }}</span>
                  </li>
                </ComboboxOption>

                <li
                  v-if="records.length || searching || failed.length"
                  role="presentation"
                  class="px-3 pb-1 pt-3 text-2xs font-semibold uppercase tracking-wide text-ink-tertiary"
                  :class="pages.length ? 'mt-1 border-t border-edge-subtle' : ''"
                >
                  Records
                </li>
                <ComboboxOption v-for="entry in records" :key="entry.key" v-slot="{ active }" :value="entry" as="template">
                  <li
                    class="flex cursor-default select-none items-center gap-3 rounded-control px-3 py-2 text-sm"
                    :class="active ? 'bg-selected-surface text-ink' : 'text-ink-secondary'"
                    data-test="palette-record"
                  >
                    <AppIcon :icon="entry.icon" class="size-5 shrink-0" :class="active ? 'text-brand-accent-strong' : 'text-ink-tertiary'" aria-hidden="true" />
                    <span class="min-w-0 flex-1 truncate">
                      <span class="font-medium">{{ entry.name }}</span>
                      <span v-if="entry.detail" class="ml-2 text-xs text-ink-tertiary">{{ entry.detail }}</span>
                    </span>
                    <span class="shrink-0 text-xs text-ink-tertiary">{{ entry.section }}</span>
                  </li>
                </ComboboxOption>
                <li v-if="searching && !records.length" role="presentation" class="px-3 py-2 text-sm text-ink-muted" aria-live="polite">
                  Searching…
                </li>
                <li v-if="failed.length" role="presentation" class="px-3 py-2 text-sm text-ink-muted" aria-live="polite">
                  Couldn’t search {{ failed.join(" and ") }} just now.
                </li>
              </ComboboxOptions>

              <p v-else class="px-6 py-10 text-center text-sm text-ink-muted">Nothing matches “{{ query }}”.</p>
            </Combobox>

            <div class="flex items-center gap-4 border-t border-edge-subtle bg-surface-subtle px-4 py-2 text-2xs text-ink-tertiary">
              <span><kbd class="font-sans font-semibold">↑ ↓</kbd> to move</span>
              <span><kbd class="font-sans font-semibold">Enter</kbd> to open</span>
              <span><kbd class="font-sans font-semibold">Esc</kbd> to close</span>
            </div>
          </DialogPanel>
        </TransitionChild>
      </div>
    </Dialog>
  </TransitionRoot>
</template>
