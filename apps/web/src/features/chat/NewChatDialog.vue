<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ChatDirectoryEntry } from "@silvicom/shared";
import {
  AppButton as BaseButton,
  AppFormField as FormField,
  AppInput as BaseInput,
  BaseModal,
} from "@silvicom/ui";
import PeoplePicker from "./PeoplePicker.vue";

/**
 * Start a conversation (CH2). One person picked opens THE direct conversation with them — the same one
 * every time (0512's pair key); two or more make a group, which may carry a name.
 *
 * The list is `/api/chat/people`: the office members who are not suspended, from the same rule the
 * write enforces, so this cannot offer somebody the server would refuse. The viewer is not listed.
 *
 * `about` (CH11c, "Chat about this" on a record's page): the conversation is ALWAYS a group, even with
 * one person picked — a direct conversation is between two people and never about anything (D-CHAT31)
 * — and its name starts as the record's ("Load L-20481"), which the person may change.
 */
const props = defineProps<{ open: boolean; people: ChatDirectoryEntry[]; viewerId: string; busy: boolean; about?: string | null }>();
const emit = defineEmits<{ close: []; start: [memberIds: string[], subject: string | null] }>();

const picked = ref<Set<string>>(new Set());
const picker = ref<InstanceType<typeof PeoplePicker> | null>(null);
const searchField = computed(() => picker.value?.searchInput() ?? null);
const subject = ref("");
watch(
  () => props.open,
  (open) => {
    if (open) {
      picked.value = new Set();
      subject.value = props.about ?? "";
    }
  },
);
const isGroup = computed(() => !!props.about || picked.value.size > 1);
function start() {
  if (picked.value.size === 0) return;
  emit("start", [...picked.value], isGroup.value ? subject.value.trim() || null : null);
}
</script>

<template>
  <BaseModal
    :open="open"
    :title="about ? `Chat about ${about}` : 'New conversation'"
    :description="about ? 'Pick the people to talk it over with. Only they will see the conversation.' : 'Pick one person for a private conversation, or several for a group.'"
    :initial-focus="searchField"
    @close="emit('close')"
  >
    <div class="space-y-3">
      <PeoplePicker ref="picker" v-model="picked" :people="people" :viewer-id="viewerId" :reset-key="open" />
      <FormField v-if="isGroup" :label="about ? 'Conversation name' : 'Group name (optional)'">
        <BaseInput v-model="subject" placeholder="e.g. Night dispatch" maxlength="200" />
      </FormField>
    </div>
    <template #footer>
      <BaseButton variant="ghost" @click="emit('close')">Cancel</BaseButton>
      <BaseButton variant="primary" :disabled="picked.size === 0 || busy" @click="start">
        {{ about ? "Start the conversation" : isGroup ? `Start group of ${picked.size + 1}` : "Open conversation" }}
      </BaseButton>
    </template>
  </BaseModal>
</template>
