<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ChatDirectoryEntry, ChatTeam } from "@silvicom/shared";
import { AppButton as BaseButton, BaseModal } from "@silvicom/ui";
import PeoplePicker from "../PeoplePicker.vue";

/**
 * Add people to a team (a team owner's act, or a `chat.teams` holder's — 0520). They join its General
 * channel with it. The list is the office people not already in the team.
 */
const props = defineProps<{ team: ChatTeam | null; people: ChatDirectoryEntry[]; memberIds: string[]; viewerId: string; busy: boolean }>();
const emit = defineEmits<{ close: []; add: [userIds: string[]] }>();

const picked = ref<Set<string>>(new Set());
const picker = ref<InstanceType<typeof PeoplePicker> | null>(null);
const searchField = computed(() => picker.value?.searchInput() ?? null);
watch(() => props.team, () => { picked.value = new Set(); });
const offered = computed(() => {
  const inTeam = new Set(props.memberIds);
  return props.people.filter((p) => !inTeam.has(p.user_id));
});
</script>

<template>
  <BaseModal
    :open="team !== null"
    :title="team ? `Add people to ${team.name}` : 'Add people'"
    description="They join the team and its General channel."
    :initial-focus="searchField"
    @close="emit('close')"
  >
    <PeoplePicker ref="picker" v-model="picked" :people="offered" :viewer-id="viewerId" :reset-key="team?.space_id" />
    <template #footer>
      <BaseButton variant="ghost" @click="emit('close')">Cancel</BaseButton>
      <BaseButton variant="primary" :disabled="picked.size === 0 || busy" @click="emit('add', [...picked])">
        {{ picked.size > 1 ? `Add ${picked.size} people` : "Add" }}
      </BaseButton>
    </template>
  </BaseModal>
</template>
