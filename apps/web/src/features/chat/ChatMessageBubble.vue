<script setup lang="ts">
import { ref } from "vue";
import type { ChatMessage } from "@silvicom/shared";
import { AppButton as BaseButton, AppTextarea as BaseTextarea } from "@silvicom/ui";
import { chatStamp } from "./chatTime";

/**
 * One server line of a conversation, a channel post or a reply — the same bubble in all three
 * (CH2, CH5c), so a channel reads like the rest of chat.
 *
 * Your own lines sit on the right. Edit and Remove act on your own lines only; the database refuses
 * anything else (0512), so the buttons only spare a round trip. A removed line keeps its place as
 * "Message removed". The `footer` slot is the caller's: "Seen" in a direct conversation, a post's
 * replies in a channel.
 */
const props = defineProps<{ message: ChatMessage; viewerId: string; showSender: boolean }>();
const emit = defineEmits<{ edit: [messageId: string, body: string]; remove: [messageId: string] }>();

const editing = ref(false);
const draft = ref("");
function startEdit() {
  draft.value = props.message.body ?? "";
  editing.value = true;
}
function save() {
  const body = draft.value.trim();
  if (body) emit("edit", props.message.id, body);
  editing.value = false;
}
const mine = () => props.message.sender_user_id === props.viewerId;
</script>

<template>
  <div
    class="group max-w-[75%] rounded-surface px-3 py-2 text-sm"
    :class="mine() ? 'ml-auto bg-action-primary text-action-primary-foreground' : 'bg-surface-subtle text-ink'"
  >
    <div v-if="!mine() && showSender" class="text-xs font-semibold opacity-80">
      {{ message.sender_name ?? "Someone" }}
    </div>
    <template v-if="editing">
      <BaseTextarea v-model="draft" :rows="2" aria-label="Edit message" @keydown.enter.exact.prevent="save" @keydown.esc.stop="editing = false" />
      <div class="mt-1 flex justify-end gap-2">
        <BaseButton size="sm" variant="ghost" @click="editing = false">Cancel</BaseButton>
        <BaseButton size="sm" @click="save">Save</BaseButton>
      </div>
    </template>
    <div v-else class="whitespace-pre-wrap break-words" :class="message.deleted_at ? 'italic opacity-70' : ''">
      {{ message.deleted_at ? "Message removed" : message.body }}
    </div>
    <div class="mt-0.5 flex items-center justify-end gap-2 text-2xs opacity-70">
      <span>{{ chatStamp(message.created_at) }}</span>
      <span v-if="message.edited_at && !message.deleted_at">· edited</span>
      <slot name="stamp" />
    </div>
    <slot name="footer" />
    <div
      v-if="mine() && !message.deleted_at && !editing"
      class="mt-1 hidden justify-end gap-2 text-2xs group-focus-within:flex group-hover:flex"
    >
      <BaseButton size="sm" variant="ghost" @click="startEdit">Edit</BaseButton>
      <BaseButton size="sm" variant="ghost" @click="emit('remove', message.id)">Remove</BaseButton>
    </div>
  </div>
</template>
