<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { USER_ROLE_LABELS, type ChatDirectoryEntry, type UserRole } from "@silvicom/shared";
import { AppAvatar, AppButton as BaseButton, AppIcon, AppSearchField } from "@silvicom/ui";
import { CheckIcon, XMarkIcon } from "@silvicom/ui/icons";

/**
 * The searchable office-people checklist that starting a conversation (CH2) and making a team (CH5b)
 * share. The list is `/api/chat/people` — office members who are not suspended, the same rule the
 * database's writes enforce — so it cannot offer somebody the server would refuse. The viewer is
 * not listed: whoever starts a conversation or makes a team is in it already.
 *
 * ── WHY THE ROWS ARE BUTTONS WITH A DRAWN BOX (2026-11-01) ──────────────────────────────────────
 * Each row was an outer `items-center` <label> holding a slotless `AppCheckbox`. AppCheckbox is a
 * form control: its root is a 36px `items-start` label with the box 2px from the top, aligned to a
 * first line of text the slotless form never draws. Centred as a 36px block against a 20px name,
 * every box sat 8px above its name (measured in the built page, owner's screenshot of "New
 * conversation" in dark mode), and the markup nested a label inside a label.
 *
 * A picker row is not a form field: it is a person you tap. So the row is one `role="checkbox"`
 * `AppButton` (`size="row"`, as the rail's rows) — drawn box, avatar, name, role — as FilterSelect's multi-select draws its box for the same
 * reason (a native input inside a focusable row breaks the row's semantics). Every child is a fixed
 * size in an `items-center` row, so nothing can drift. Whoever is picked shows as a chip above the
 * search (the "To:" line of Slack, Teams and Linear), so a pick made before a search narrowed the
 * list is still visible and one tap removes it.
 */
const props = defineProps<{ people: ChatDirectoryEntry[]; viewerId: string; resetKey?: unknown }>();
const picked = defineModel<Set<string>>({ required: true });

const query = ref("");
watch(() => props.resetKey, () => { query.value = ""; });

const roleLabel = (r: string) => USER_ROLE_LABELS[r as UserRole] ?? r;
const nameOf = (p: ChatDirectoryEntry) => p.name ?? "Unnamed member";
const others = computed(() => props.people.filter((p) => p.user_id !== props.viewerId));
const shown = computed(() => {
  const q = query.value.trim().toLowerCase();
  return q ? others.value.filter((p) => (p.name ?? "").toLowerCase().includes(q)) : others.value;
});
// In the list's order, so the chips do not reshuffle as people are added.
const chosen = computed(() => others.value.filter((p) => picked.value.has(p.user_id)));
// The dialog that holds this opens on the search, not on its close button (BaseModal `initialFocus`).
const search = ref<InstanceType<typeof AppSearchField> | null>(null);
defineExpose({ searchInput: () => search.value?.input() ?? null });

function toggle(id: string) {
  const next = new Set(picked.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  picked.value = next;
}
</script>

<template>
  <div class="space-y-3">
    <ul v-if="chosen.length" class="flex flex-wrap gap-1.5" aria-label="Picked">
      <li v-for="p in chosen" :key="p.user_id">
        <BaseButton
          size="sm"
          variant="soft"
          class="h-7 gap-1.5 rounded-full py-0.5 pr-2 pl-0.5 text-xs"
          :aria-label="`Remove ${nameOf(p)}`"
          @click="toggle(p.user_id)"
        >
          <AppAvatar :label="nameOf(p)" :identity="p.user_id" size="xs" />
          <span class="max-w-40 truncate text-ink">{{ nameOf(p) }}</span>
          <AppIcon :icon="XMarkIcon" class="size-3.5" aria-hidden="true" />
        </BaseButton>
      </li>
    </ul>
    <AppSearchField ref="search" v-model="query" placeholder="Search people" label="Search people" :debounce="0" />
    <ul class="-mx-2 max-h-72 space-y-0.5 overflow-y-auto" aria-label="People">
      <li v-for="p in shown" :key="p.user_id">
        <BaseButton
          size="row"
          block
          :variant="picked.has(p.user_id) ? 'soft' : 'ghost'"
          role="checkbox"
          :aria-checked="picked.has(p.user_id)"
          class="gap-3 px-2 py-1.5"
          @click="toggle(p.user_id)"
        >
          <span class="flex w-full min-w-0 items-center gap-3">
            <span
              class="flex size-4 shrink-0 items-center justify-center rounded-detail border transition-colors"
              :class="picked.has(p.user_id) ? 'border-action-primary bg-action-primary text-action-primary-foreground' : 'border-edge-control bg-surface'"
              aria-hidden="true"
            >
              <AppIcon v-if="picked.has(p.user_id)" :icon="CheckIcon" class="size-3" />
            </span>
            <AppAvatar :label="nameOf(p)" :identity="p.user_id" size="sm" />
            <span class="min-w-0 flex-1 truncate font-medium text-ink">{{ nameOf(p) }}</span>
            <span class="shrink-0 text-xs text-ink-muted">{{ roleLabel(p.role) }}</span>
          </span>
        </BaseButton>
      </li>
      <li v-if="shown.length === 0" class="px-2 py-3 text-sm text-ink-muted">
        {{ others.length === 0 ? "Nobody else in your organisation can chat yet." : "Nobody by that name." }}
      </li>
    </ul>
  </div>
</template>
