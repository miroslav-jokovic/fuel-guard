<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  CHAT_COMPLIANCE_REASON_LABELS,
  CHAT_HOLD_MATTER_MAX,
  CHAT_HOLD_MATTER_MIN,
  type ChatCompliancePerson,
  type ChatComplianceReason,
  type ChatHold,
} from "@silvicom/shared";
import {
  AppBadge,
  AppButton as BaseButton,
  AppCard as BaseCard,
  AppCheckbox,
  AppFormField as FormField,
  AppInput as BaseInput,
  AppSelect as BaseSelect,
  DataTable,
  type DataTableColumn,
} from "@silvicom/ui";
import { formatDateTime } from "@/lib/format";
import { useToastStore } from "@/stores/toast";
import { releaseHold, setHold, useComplianceHoldsQuery, useComplianceRefresh, type RunAct } from "./useChatCompliance";

/**
 * Legal holds (OFFICE-CHAT-PLAN CHA3, D-CHAT15): on a person, or on a conversation — the second
 * closes the gap Slack's per-person holds leave, a conversation in which no held person speaks. A
 * hold names its matter and carries the reason given above; releasing it takes a reason too, and the
 * hold stays listed as released. Nothing is deleted, here or in the database.
 *
 * A conversation hold is started from the conversation itself (its window's "Place a hold"), which
 * hands it here as `conversation`; a person hold is chosen from the people list.
 */
const props = defineProps<{
  reason: ChatComplianceReason | null;
  people: ChatCompliancePerson[];
  run: RunAct;
  conversation: { id: string; title: string } | null;
}>();
const emit = defineEmits<{ "clear-conversation": [] }>();

const toast = useToastStore();
const refresh = useComplianceRefresh();
const showReleased = ref(false);
const holds = useComplianceHoldsQuery(showReleased);

const person = ref<string | null>(null);
const matter = ref("");
const busy = ref(false);
watch(() => props.conversation, (c) => { if (c) person.value = null; });

const target = computed(() =>
  props.conversation ? { scope: "conversation" as const, id: props.conversation.id } : person.value ? { scope: "person" as const, id: person.value } : null,
);
const matterOk = computed(() => matter.value.trim().length >= CHAT_HOLD_MATTER_MIN && matter.value.trim().length <= CHAT_HOLD_MATTER_MAX);
const peopleOptions = computed(() =>
  props.people.map((p) => ({ value: p.user_id, label: `${p.name ?? p.user_id}${p.suspended ? " (suspended)" : ""} · ${p.role}` })),
);

async function place() {
  const t = target.value;
  const reason = props.reason;
  if (!t || !reason || !matterOk.value) return;
  await props.run(async () => {
    busy.value = true;
    try {
      await setHold({ reason, scope: t.scope, target: t.id, matter: matter.value.trim() });
      toast.success("The hold is in place.");
      matter.value = "";
      person.value = null;
      emit("clear-conversation");
      refresh();
    } finally {
      busy.value = false;
    }
  });
}

async function release(h: ChatHold) {
  const reason = props.reason;
  if (!reason) return;
  await props.run(async () => {
    await releaseHold(h.id, reason);
    toast.success(`The hold for ${h.matter} is released.`);
    refresh();
  });
}

const columns: DataTableColumn[] = [
  { key: "target", label: "On", width: "xl" },
  { key: "matter", label: "Matter", width: "xl" },
  { key: "set_at", label: "Placed", width: "xl" },
  { key: "released_at", label: "Status", width: "xl" },
];
const targetLabel = (h: ChatHold) =>
  h.scope === "person" ? h.user_name ?? "A person" : h.thread_subject?.trim() || `${h.thread_kind ?? "A"} conversation`;
</script>

<template>
  <div class="space-y-4">
    <BaseCard>
      <h2 class="text-sm font-semibold text-ink">Place a hold</h2>
      <p class="mt-1 text-sm text-ink-muted">
        A hold records that these messages must be kept for a matter. Nothing in chat is deleted today; the hold is the
        record of the instruction, from the day it was given. It uses the reason above.
      </p>
      <form class="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end" @submit.prevent="place">
        <FormField v-if="conversation" label="Conversation">
          <div class="flex items-center gap-2 text-sm text-ink">
            <span class="truncate">{{ conversation.title }}</span>
            <BaseButton size="sm" variant="ghost" @click="emit('clear-conversation')">Choose a person instead</BaseButton>
          </div>
        </FormField>
        <FormField v-else label="Person" hint="To hold one conversation, open it and choose “Place a hold”.">
          <BaseSelect v-model="person" :options="peopleOptions" placeholder="Choose a person" aria-label="Person to hold" />
        </FormField>
        <FormField label="Matter" :hint="`The case or ticket the hold is for, ${CHAT_HOLD_MATTER_MIN}–${CHAT_HOLD_MATTER_MAX} characters.`">
          <BaseInput v-model="matter" aria-label="Matter" placeholder="e.g. Matter 2026-CV-118" />
        </FormField>
        <BaseButton type="submit" variant="primary" :disabled="!reason || !target || !matterOk || busy">Place the hold</BaseButton>
      </form>
    </BaseCard>

    <div class="flex justify-end">
      <AppCheckbox v-model="showReleased" label="Show released holds" />
    </div>

    <DataTable
      :columns="columns"
      :rows="holds.data.value ?? []"
      row-key="id"
      :loading="holds.isPending.value"
      :error="holds.isError.value ? 'Could not load the holds.' : null"
      :retrying="holds.isFetching.value"
      empty-text="No holds."
      @retry="holds.refetch()"
    >
      <template #cell-target="{ row }">
        <div class="text-ink">{{ targetLabel(row) }}</div>
        <div class="text-xs text-ink-muted">{{ row.scope === "person" ? "Everything this person wrote" : "This conversation" }}</div>
      </template>
      <template #cell-matter="{ row }">
        <div class="text-ink">{{ row.matter }}</div>
        <div class="text-xs text-ink-muted">{{ CHAT_COMPLIANCE_REASON_LABELS[row.reason.category] }} — {{ row.reason.text }}</div>
      </template>
      <template #cell-set_at="{ row }">
        <div>{{ formatDateTime(row.set_at) }}</div>
        <div class="text-xs text-ink-muted">by {{ row.set_by_name ?? "someone" }}</div>
      </template>
      <template #cell-released_at="{ row }">
        <AppBadge v-if="!row.released_at" tone="warning">In force</AppBadge>
        <template v-else>
          <AppBadge tone="neutral">Released</AppBadge>
          <div class="mt-1 text-xs text-ink-muted">{{ formatDateTime(row.released_at) }} by {{ row.released_by_name ?? "someone" }}</div>
          <div v-if="row.release_reason" class="text-xs text-ink-muted">{{ row.release_reason.text }}</div>
        </template>
      </template>
      <template #actions="{ row }">
        <BaseButton v-if="!row.released_at" size="sm" :disabled="!reason" :title="reason ? undefined : 'Give the reason above first'" @click="release(row)">Release</BaseButton>
      </template>
    </DataTable>
  </div>
</template>
