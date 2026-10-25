<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { CHAT_CHANNEL_NAME_MAX, type ChatDirectoryEntry, type ChatTeam, type ChatTeamMember } from "@silvicom/shared";
import {
  AppButton as BaseButton,
  AppFormField as FormField,
  AppInput as BaseInput,
  AppRadioGroup,
  BaseModal,
} from "@silvicom/ui";
import PeoplePicker from "../PeoplePicker.vue";

/**
 * A channel in a team (D-CHAT18). Public: everyone in the team sees it on their rail and may join;
 * you join it now. Private: only the people you pick, each from the team, and nobody else sees it.
 * "General" is the team's own channel and cannot be taken (0519 refuses it); a name already in use in
 * the team comes back from the server in its words.
 */
const props = defineProps<{ team: ChatTeam | null; members: ChatTeamMember[]; viewerId: string; busy: boolean }>();
const emit = defineEmits<{ close: []; create: [name: string, visibility: "public" | "private", memberIds: string[]] }>();

const name = ref("");
const visibility = ref<"public" | "private">("public");
const picked = ref<Set<string>>(new Set());
watch(
  () => props.team,
  (t) => {
    if (t) {
      name.value = "";
      visibility.value = "public";
      picked.value = new Set();
    }
  },
);

const VISIBILITY = [
  { value: "public", label: "Public", description: "Everyone in the team can see it and join." },
  { value: "private", label: "Private", description: "Only the people you add." },
];
// The picker's own shape: the team's people, so a private channel can only name somebody in the team.
const people = computed<ChatDirectoryEntry[]>(() => props.members.map((m) => ({ user_id: m.user_id, name: m.name, role: m.role ?? "" })));
const trimmed = computed(() => name.value.trim());
const nameOk = computed(() => trimmed.value.length > 0 && trimmed.value.length <= CHAT_CHANNEL_NAME_MAX && trimmed.value.toLowerCase() !== "general");
function create() {
  if (!nameOk.value) return;
  emit("create", trimmed.value, visibility.value, visibility.value === "private" ? [...picked.value] : []);
}
</script>

<template>
  <BaseModal
    :open="team !== null"
    :title="team ? `New channel in ${team.name}` : 'New channel'"
    description="A channel is a conversation inside the team, with posts and replies."
    @close="emit('close')"
  >
    <div class="space-y-3">
      <FormField label="Name" :hint="trimmed.toLowerCase() === 'general' ? 'General is the team’s own channel; pick another name.' : undefined">
        <BaseInput v-model="name" placeholder="e.g. Loads" :maxlength="CHAT_CHANNEL_NAME_MAX" aria-label="Channel name" />
      </FormField>
      <AppRadioGroup v-model="visibility" :options="VISIBILITY" legend="Who can see it" />
      <FormField v-if="visibility === 'private'" label="People" hint="Only people in the team. You are in it already.">
        <PeoplePicker v-model="picked" :people="people" :viewer-id="viewerId" :reset-key="team?.space_id" />
      </FormField>
    </div>
    <template #footer>
      <BaseButton variant="ghost" @click="emit('close')">Cancel</BaseButton>
      <BaseButton variant="primary" :disabled="!nameOk || busy" @click="create">Make the channel</BaseButton>
    </template>
  </BaseModal>
</template>
