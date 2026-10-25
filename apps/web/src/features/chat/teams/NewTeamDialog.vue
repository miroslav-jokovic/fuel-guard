<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { CHAT_TEAM_DESCRIPTION_MAX, CHAT_TEAM_NAME_MAX, type ChatDirectoryEntry } from "@silvicom/shared";
import {
  AppButton as BaseButton,
  AppFormField as FormField,
  AppInput as BaseInput,
  BaseModal,
} from "@silvicom/ui";
import PeoplePicker from "../PeoplePicker.vue";

/**
 * Make a team (D-CHAT17): a name, an optional description, and its first people. The maker is in it
 * and owns it, and everyone in it starts in its General channel (0519). The name is unique among the
 * organisation's live teams; a clash comes back from the server as "already in use", in its words.
 */
const props = defineProps<{ open: boolean; people: ChatDirectoryEntry[]; viewerId: string; busy: boolean }>();
const emit = defineEmits<{ close: []; create: [name: string, description: string | null, memberIds: string[]] }>();

const name = ref("");
const description = ref("");
const picked = ref<Set<string>>(new Set());
watch(
  () => props.open,
  (open) => {
    if (open) {
      name.value = "";
      description.value = "";
      picked.value = new Set();
    }
  },
);

const nameOk = computed(() => name.value.trim().length > 0 && name.value.trim().length <= CHAT_TEAM_NAME_MAX);
function create() {
  if (!nameOk.value) return;
  emit("create", name.value.trim(), description.value.trim() || null, [...picked.value]);
}
</script>

<template>
  <BaseModal
    :open="open"
    title="New team"
    description="A team has a General channel everyone in it is in. Its people can add more channels."
    @close="emit('close')"
  >
    <div class="space-y-3">
      <FormField label="Name">
        <BaseInput v-model="name" placeholder="e.g. Night dispatch" :maxlength="CHAT_TEAM_NAME_MAX" aria-label="Team name" />
      </FormField>
      <FormField label="Description (optional)">
        <BaseInput v-model="description" placeholder="What the team is for" :maxlength="CHAT_TEAM_DESCRIPTION_MAX" aria-label="Team description" />
      </FormField>
      <FormField label="People" hint="You are in the team and own it. You can add people later too.">
        <PeoplePicker v-model="picked" :people="people" :viewer-id="viewerId" :reset-key="open" />
      </FormField>
    </div>
    <template #footer>
      <BaseButton variant="ghost" @click="emit('close')">Cancel</BaseButton>
      <BaseButton variant="primary" :disabled="!nameOk || busy" @click="create">
        {{ picked.size ? `Make the team of ${picked.size + 1}` : "Make the team" }}
      </BaseButton>
    </template>
  </BaseModal>
</template>
