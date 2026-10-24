<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ChatComplianceMessage, ChatComplianceReason, ChatComplianceThreadResponse } from "@silvicom/shared";
import { AppButton as BaseButton, BaseModal } from "@silvicom/ui";
import { formatDateTime } from "@/lib/format";
import ComplianceMessage from "./ComplianceMessage.vue";
import { useToastStore } from "@/stores/toast";
import { createExport, openThread, useComplianceRefresh, type RunAct } from "./useChatCompliance";

/**
 * One conversation, read whole: everyone who was ever in it (with when they left), and its lines oldest
 * first with every retraction and every earlier version visible. Opening it, and every older page, is a
 * ledgered act with the reason attached; the modal fetches only when told to.
 *
 * From here a holder can also EXPORT the whole conversation (CHA3: PDF + JSONL + manifest, a ledgered
 * act with the same reason) or start a HOLD on it, which the Holds tab completes with the matter.
 */
const props = defineProps<{ threadId: string | null; reason: ChatComplianceReason | null; run: RunAct }>();
const emit = defineEmits<{ close: []; hold: [conversation: { id: string; title: string }] }>();
const toast = useToastStore();
const refresh = useComplianceRefresh();
const exporting = ref(false);

async function exportAll() {
  if (!props.threadId || !props.reason) return;
  const thread = props.threadId;
  const reason = props.reason;
  await props.run(async () => {
    exporting.value = true;
    try {
      const r = await createExport({ reason, scope: "conversation", thread });
      toast.success(`Exported ${r.message_count} message${r.message_count === 1 ? "" : "s"}. The files are on the Exports tab.`);
      refresh();
    } finally {
      exporting.value = false;
    }
  });
}

const data = ref<ChatComplianceThreadResponse | null>(null);
const busy = ref(false);

async function load(beforeSeq: number | null) {
  if (!props.threadId || !props.reason) return;
  const id = props.threadId;
  const reason = props.reason;
  await props.run(async () => {
    busy.value = true;
    try {
      const r = await openThread(id, { reason, before_seq: beforeSeq ?? undefined });
      data.value = beforeSeq && data.value ? { ...r, messages: [...r.messages, ...data.value.messages] } : r;
    } finally {
      busy.value = false;
    }
  });
}
watch(
  () => props.threadId,
  (id) => {
    data.value = null;
    if (id) void load(null);
  },
  { immediate: true },
);

const title = computed(() => {
  const c = data.value?.conversation;
  if (!c) return "Conversation";
  return c.subject?.trim() || c.members.filter((m) => !m.left_at).map((m) => m.name ?? "Someone").join(", ") || "Conversation";
});
const lines = computed<ChatComplianceMessage[]>(() => data.value?.messages ?? []);
</script>

<template>
  <BaseModal :open="threadId !== null" :title="title" size="xl" @close="emit('close')">
    <div v-if="data" class="space-y-4 text-sm">
      <section>
        <h3 class="text-xs font-semibold uppercase tracking-wide text-ink-muted">People</h3>
        <ul class="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          <li v-for="m in data.conversation.members" :key="m.user_id" :class="m.left_at ? 'text-ink-muted' : 'text-ink'">
            {{ m.name ?? "Someone" }} <span class="text-xs text-ink-tertiary">· {{ m.role }}</span>
            <span v-if="m.left_at" class="text-xs"> · left {{ formatDateTime(m.left_at) }}</span>
          </li>
        </ul>
        <p class="mt-1 text-xs text-ink-muted">
          {{ data.conversation.kind }} conversation, started {{ formatDateTime(data.conversation.created_at) }}<template v-if="data.conversation.archived_at">, archived {{ formatDateTime(data.conversation.archived_at) }}</template>.
        </p>
      </section>

      <section class="space-y-3">
        <div v-if="data.before_seq" class="flex justify-center">
          <BaseButton size="sm" :disabled="busy" @click="load(data.before_seq)">Earlier messages</BaseButton>
        </div>
        <p v-if="lines.length === 0" class="text-center text-ink-muted">No messages.</p>
        <div v-for="m in lines" :key="m.id" class="rounded-surface bg-surface-subtle px-3 py-2">
          <div class="mb-1 text-xs text-ink-muted">#{{ m.seq }} · {{ formatDateTime(m.created_at) }}</div>
          <ComplianceMessage :message="m" />
        </div>
      </section>
    </div>
    <p v-else class="text-sm text-ink-muted">{{ busy ? "Opening the conversation…" : "Confirm your password to open it." }}</p>
    <template #footer>
      <BaseButton v-if="data && threadId" @click="emit('hold', { id: threadId, title })">Place a hold</BaseButton>
      <BaseButton v-if="data" :disabled="exporting" @click="exportAll">{{ exporting ? "Exporting…" : "Export" }}</BaseButton>
      <BaseButton @click="emit('close')">Close</BaseButton>
    </template>
  </BaseModal>
</template>
