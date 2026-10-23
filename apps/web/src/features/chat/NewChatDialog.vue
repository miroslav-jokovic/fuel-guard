<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { USER_ROLE_LABELS, type ChatDirectoryEntry, type UserRole } from "@silvicom/shared";
import {
  AppButton as BaseButton,
  AppCheckbox as BaseCheckbox,
  AppFormField as FormField,
  AppInput as BaseInput,
  AppSearchField,
  BaseModal,
} from "@silvicom/ui";

/**
 * Start a conversation (CH2). One person picked opens THE direct conversation with them — the same one
 * every time (0512's pair key); two or more make a group, which may carry a name.
 *
 * The list is `/api/chat/people`: the office members who are not suspended, from the same rule the
 * write enforces, so this cannot offer somebody the server would refuse. The viewer is not listed.
 */
const props = defineProps<{ open: boolean; people: ChatDirectoryEntry[]; viewerId: string; busy: boolean }>();
const emit = defineEmits<{ close: []; start: [memberIds: string[], subject: string | null] }>();

const query = ref("");
const picked = ref<Set<string>>(new Set());
const subject = ref("");
watch(
  () => props.open,
  (open) => {
    if (open) {
      query.value = "";
      picked.value = new Set();
      subject.value = "";
    }
  },
);

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
const isGroup = computed(() => picked.value.size > 1);
function start() {
  if (picked.value.size === 0) return;
  emit("start", [...picked.value], isGroup.value ? subject.value.trim() || null : null);
}
</script>

<template>
  <BaseModal
    :open="open"
    title="New conversation"
    description="Pick one person for a private conversation, or several for a group."
    @close="emit('close')"
  >
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
      <FormField v-if="isGroup" label="Group name (optional)">
        <BaseInput v-model="subject" placeholder="e.g. Night dispatch" maxlength="200" />
      </FormField>
    </div>
    <template #footer>
      <BaseButton variant="ghost" @click="emit('close')">Cancel</BaseButton>
      <BaseButton variant="primary" :disabled="picked.size === 0 || busy" @click="start">
        {{ isGroup ? `Start group of ${picked.size + 1}` : "Open conversation" }}
      </BaseButton>
    </template>
  </BaseModal>
</template>
