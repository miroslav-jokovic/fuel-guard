<script setup lang="ts">
import { computed, ref } from "vue";
import type { ChatComplianceConversation, ChatCompliancePerson, ChatComplianceReason } from "@silvicom/shared";
import { AppButton as BaseButton, AppFormField as FormField, AppInput as BaseInput, AppSelect as BaseSelect, DataTable, type DataTableColumn } from "@silvicom/ui";
import { formatDateTime } from "@/lib/format";
import { dayStartIso, searchConversations, type RunAct } from "./useChatCompliance";

/**
 * Every conversation of the org — direct, group, channel and driver threads alike (§5.3) — newest
 * activity first, narrowed to a person or a date range. A search runs when pressed, never on its own:
 * each one is a ledgered act with the reason attached.
 */
const props = defineProps<{ reason: ChatComplianceReason | null; people: ChatCompliancePerson[]; run: RunAct }>();
const emit = defineEmits<{ open: [threadId: string] }>();

const person = ref<string | null>(null);
const from = ref("");
const to = ref("");
const rows = ref<ChatComplianceConversation[]>([]);
const next = ref<{ before_at: string; before_id: string } | null>(null);
const searched = ref(false);
const busy = ref(false);

const peopleOptions = computed(() => [
  { value: "", label: "Anyone" },
  ...props.people.map((p) => ({ value: p.user_id, label: `${p.name ?? p.user_id}${p.suspended ? " (suspended)" : ""} · ${p.role}` })),
]);

async function search(older = false) {
  if (!props.reason) return;
  const reason = props.reason;
  await props.run(async () => {
    busy.value = true;
    try {
      const r = await searchConversations({
        reason,
        person: person.value || undefined,
        from: dayStartIso(from.value),
        to: dayStartIso(to.value, 1),
        ...(older && next.value ? next.value : {}),
      });
      rows.value = older ? [...rows.value, ...r.conversations] : r.conversations;
      next.value = r.next;
      searched.value = true;
    } finally {
      busy.value = false;
    }
  });
}

const columns: DataTableColumn[] = [
  { key: "last_message_at", label: "Last message", width: "lg" },
  { key: "kind", label: "Kind", width: "sm" },
  { key: "subject", label: "Conversation", width: "3xl" },
  { key: "message_count", label: "Messages", numeric: true, width: "sm" },
  { key: "open", label: "", width: "sm", align: "center" },
];
const title = (c: ChatComplianceConversation) =>
  c.subject?.trim() || c.members.map((m) => m.name ?? "Someone").join(", ") || "Conversation";
</script>

<template>
  <div class="space-y-4">
    <form class="grid gap-3 md:grid-cols-[1fr_10rem_10rem_auto] md:items-end" @submit.prevent="search()">
      <FormField label="Person">
        <BaseSelect v-model="person" :options="peopleOptions" aria-label="Person" />
      </FormField>
      <FormField label="From">
        <BaseInput v-model="from" type="date" aria-label="From day" />
      </FormField>
      <FormField label="To">
        <BaseInput v-model="to" type="date" aria-label="To day" />
      </FormField>
      <BaseButton type="submit" variant="primary" :disabled="!reason || busy">Search conversations</BaseButton>
    </form>

    <DataTable
      v-if="searched"
      :columns="columns"
      :rows="rows"
      row-key="thread_id"
      :loading="busy && rows.length === 0"
      empty-text="No conversations match."
    >
      <template #cell-last_message_at="{ value }">{{ formatDateTime(value) }}</template>
      <template #cell-subject="{ row }">
        <span class="font-medium text-ink">{{ title(row) }}</span>
        <span v-if="row.archived_at" class="ml-2 text-xs text-ink-muted">archived</span>
        <div class="text-xs text-ink-muted">
          {{ row.members.filter((m: { left_at: string | null }) => !m.left_at).length }} in it
          <template v-if="row.members.some((m: { left_at: string | null }) => m.left_at)">
            · {{ row.members.filter((m: { left_at: string | null }) => m.left_at).length }} left
          </template>
        </div>
      </template>
      <template #cell-open="{ row }">
        <BaseButton size="sm" variant="ghost" @click="emit('open', row.thread_id)">Open</BaseButton>
      </template>
      <template #footer>
        <div v-if="next" class="flex justify-center p-3">
          <BaseButton size="sm" :disabled="busy" @click="search(true)">Older conversations</BaseButton>
        </div>
      </template>
    </DataTable>
    <p v-else class="text-sm text-ink-muted">Give a reason above, then search. Nothing is read until you do.</p>
  </div>
</template>
