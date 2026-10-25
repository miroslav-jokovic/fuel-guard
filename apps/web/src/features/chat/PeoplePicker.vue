<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { USER_ROLE_LABELS, type ChatDirectoryEntry, type UserRole } from "@silvicom/shared";
import { AppCheckbox as BaseCheckbox, AppSearchField } from "@silvicom/ui";

/**
 * The searchable office-people checklist that starting a conversation (CH2) and making a team (CH5b)
 * share. The list is `/api/chat/people` — office members who are not suspended, the same rule the
 * database's writes enforce — so it cannot offer somebody the server would refuse. The viewer is
 * not listed: whoever starts a conversation or makes a team is in it already.
 */
const props = defineProps<{ people: ChatDirectoryEntry[]; viewerId: string; resetKey?: unknown }>();
const picked = defineModel<Set<string>>({ required: true });

const query = ref("");
watch(() => props.resetKey, () => { query.value = ""; });

const roleLabel = (r: string) => USER_ROLE_LABELS[r as UserRole] ?? r;
const others = computed(() => props.people.filter((p) => p.user_id !== props.viewerId));
const shown = computed(() => {
  const q = query.value.trim().toLowerCase();
  return q ? others.value.filter((p) => (p.name ?? "").toLowerCase().includes(q)) : others.value;
});
function toggle(id: string, on: boolean) {
  const next = new Set(picked.value);
  if (on) next.add(id);
  else next.delete(id);
  picked.value = next;
}
</script>

<template>
  <div class="space-y-3">
    <AppSearchField v-model="query" placeholder="Search people" label="Search people" :debounce="0" />
    <ul class="max-h-72 space-y-0.5 overflow-y-auto" aria-label="People">
      <li v-for="p in shown" :key="p.user_id">
        <label class="flex items-center gap-2 rounded-control px-2 py-1.5 text-sm text-ink hover:bg-surface-subtle">
          <BaseCheckbox :model-value="picked.has(p.user_id)" @update:model-value="(v: boolean) => toggle(p.user_id, v)" />
          <span class="flex-1 truncate">{{ p.name ?? "Unnamed member" }}</span>
          <span class="shrink-0 text-xs text-ink-muted">{{ roleLabel(p.role) }}</span>
        </label>
      </li>
      <li v-if="shown.length === 0" class="px-2 py-3 text-sm text-ink-muted">
        {{ others.length === 0 ? "Nobody else in your organisation can chat yet." : "Nobody by that name." }}
      </li>
    </ul>
  </div>
</template>
