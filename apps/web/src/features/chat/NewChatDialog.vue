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
 */
const props = defineProps<{ open: boolean; people: ChatDirectoryEntry[]; viewerId: string; busy: boolean }>();
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
      subject.value = "";
    }
  },
);
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
    :initial-focus="searchField"
    @close="emit('close')"
  >
    <div class="space-y-3">
      <PeoplePicker ref="picker" v-model="picked" :people="people" :viewer-id="viewerId" :reset-key="open" />
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
