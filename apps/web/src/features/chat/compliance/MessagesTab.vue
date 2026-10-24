<script setup lang="ts">
import { computed, ref } from "vue";
import type { ChatComplianceMessage, ChatCompliancePerson, ChatComplianceReason } from "@silvicom/shared";
import { AppButton as BaseButton, AppFormField as FormField, AppInput as BaseInput, AppSelect as BaseSelect } from "@silvicom/ui";
import { formatDateTime } from "@/lib/format";
import ComplianceMessage from "./ComplianceMessage.vue";
import { useToastStore } from "@/stores/toast";
import { createExport, dayStartIso, searchMessages, useComplianceRefresh, type RunAct } from "./useChatCompliance";

/**
 * Messages across the org by words, person and date — the current words AND any earlier version an
 * edit replaced, so a sentence somebody rewrote is still found. Each line shows which conversation it
 * is from and opens it. A search runs when pressed: each is a ledgered act with the reason attached.
 * "Export these results" exports every match of the search last run, unpaged (CHA3, up to 10,000).
 */
const props = defineProps<{ reason: ChatComplianceReason | null; people: ChatCompliancePerson[]; run: RunAct }>();
const emit = defineEmits<{ open: [threadId: string] }>();

const q = ref("");
const person = ref<string | null>(null);
const from = ref("");
const to = ref("");
const rows = ref<ChatComplianceMessage[]>([]);
const next = ref<{ before_at: string; before_id: string } | null>(null);
const searched = ref(false);
const busy = ref(false);
const toast = useToastStore();
const refresh = useComplianceRefresh();
/** The filters of the search last run, so the export is of what is on screen, not of what was retyped since. */
const lastFilters = ref<{ q?: string; person?: string; from?: string; to?: string } | null>(null);

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
      const filters = older && lastFilters.value ? lastFilters.value : {
        q: q.value.trim() || undefined,
        person: person.value || undefined,
        from: dayStartIso(from.value),
        to: dayStartIso(to.value, 1),
      };
      const r = await searchMessages({ reason, ...filters, ...(older && next.value ? next.value : {}) });
      lastFilters.value = filters;
      rows.value = older ? [...rows.value, ...r.messages] : r.messages;
      next.value = r.next;
      searched.value = true;
    } finally {
      busy.value = false;
    }
  });
}
async function exportResults() {
  if (!props.reason || !lastFilters.value) return;
  const reason = props.reason;
  const filters = lastFilters.value;
  await props.run(async () => {
    busy.value = true;
    try {
      const r = await createExport({ reason, scope: "search", ...filters });
      toast.success(`Exported ${r.message_count} message${r.message_count === 1 ? "" : "s"}. The files are on the Exports tab.`);
      refresh();
    } finally {
      busy.value = false;
    }
  });
}

const where = (m: ChatComplianceMessage) => m.thread_subject?.trim() || (m.thread_kind === "direct" ? "Direct conversation" : m.thread_kind === "driver" ? "Driver conversation" : "Group");
</script>

<template>
  <div class="space-y-4">
    <form class="grid gap-3 md:grid-cols-[1fr_1fr_9rem_9rem_auto] md:items-end" @submit.prevent="search()">
      <FormField label="Words">
        <BaseInput v-model="q" aria-label="Words to find" placeholder="A word or phrase; earlier versions are searched too" />
      </FormField>
      <FormField label="Sent by">
        <BaseSelect v-model="person" :options="peopleOptions" aria-label="Sent by" />
      </FormField>
      <FormField label="From">
        <BaseInput v-model="from" type="date" aria-label="From day" />
      </FormField>
      <FormField label="To">
        <BaseInput v-model="to" type="date" aria-label="To day" />
      </FormField>
      <BaseButton type="submit" variant="primary" :disabled="!reason || busy">Search messages</BaseButton>
    </form>

    <template v-if="searched">
      <div v-if="rows.length > 0" class="flex justify-end">
        <BaseButton size="sm" :disabled="!reason || busy" @click="exportResults">Export these results</BaseButton>
      </div>
      <p v-if="rows.length === 0" class="text-sm text-ink-muted">No messages match.</p>
      <ol v-else class="divide-y divide-edge-subtle rounded-surface bg-surface ring-1 ring-edge">
        <li v-for="m in rows" :key="m.id" class="p-3">
          <div class="mb-1 flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
            <span>{{ formatDateTime(m.created_at) }}</span>
            <span>· {{ where(m) }}</span>
            <BaseButton size="sm" variant="ghost" class="ml-auto" @click="emit('open', m.thread_id)">Open conversation</BaseButton>
          </div>
          <ComplianceMessage :message="m" />
        </li>
      </ol>
      <div v-if="next" class="flex justify-center">
        <BaseButton size="sm" :disabled="busy" @click="search(true)">Older messages</BaseButton>
      </div>
    </template>
    <p v-else class="text-sm text-ink-muted">Give a reason above, then search. Nothing is read until you do.</p>
  </div>
</template>
