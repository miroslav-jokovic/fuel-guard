<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import {
  INQUIRY_METHODS,
  INQUIRY_METHOD_LABELS,
  INQUIRY_OUTCOME_LABELS,
  canReadInvestigationHistory,
  rolesThatManage,
  type InquiryMethod,
} from "@fuelguard/shared";
import {
  AppButton as BaseButton,
  AppCard as BaseCard,
  AppInput as BaseInput,
  AppDateField,
  AppCombobox as ComboSelect,
  AppFormField as FormField,
} from "@fuelguard/ui";
import SlideOver from "@/components/SlideOver.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { useEmploymentHistoryQuery } from "@/features/recruitment/useEmployment";
import InquiryResponseDrawer from "@/features/recruitment/InquiryResponseDrawer.vue";
import {
  useInquiriesQuery,
  useInquiryPreview,
  useRecordInquiry,
  useRecordInquiryOutcome,
  type EmployerInquiry,
} from "@/features/recruitment/useEmployerInquiries";

/**
 * The §391.23 previous-employer inquiry record (EMPLOYER-INQUIRY-PLAN E3).
 *
 * ── THIS SCREEN DOES NOT SEND EMAIL, AND SAYS SO ───────────────────────────────────────────────
 * Whether we send on the carrier's behalf from our own domain is unanswered (Q-PEI2) — it is a
 * deliverability and an impersonation question at once. §391.23(c)(2) asks for a record of "the date
 * the previous employer was contacted, or the attempts made", not for proof that we ran the mail
 * server. So the letter is composed here, the operator sends it however that employer actually
 * answers — post, fax, their own portal — and the record is made either way (D-PEI6).
 *
 * ── ATTEMPTS, NOT RETRIES ──────────────────────────────────────────────────────────────────────
 * A second letter is a second row. §391.23(c)(1) accepts documented good-faith efforts IN PLACE OF a
 * reply, so the list below is not a log of failures — when nobody answers, it is the evidence that
 * completes the file.
 */
const props = defineProps<{ driverId: string }>();
const driverId = computed(() => props.driverId);

const session = useSessionStore();
const toast = useToastStore();
const employmentQ = useEmploymentHistoryQuery(driverId);
const inquiriesQ = useInquiriesQuery(driverId);
const record = useRecordInquiry();
const recordOutcome = useRecordInquiryOutcome();

const canInvestigate = computed(() => {
  const role = session.role;
  return Boolean(role) && rolesThatManage("recruitment").includes(role!) && canReadInvestigationHistory(role);
});

/** Only DOT-regulated employers owe a §391.23(a)(2) inquiry. */
const owing = computed(() => (employmentQ.data.value ?? []).filter((e) => e.dot_regulated));

const composeFor = ref<string | null>(null);
/** The attempt whose answer is being recorded (E4). */
const answering = ref<EmployerInquiry | null>(null);
const declaredFor = computed(() => {
  const employmentId = answering.value?.employment_id;
  const row = (employmentQ.data.value ?? []).find((e) => e.id === employmentId);
  return row ? { started_on: row.started_on, ended_on: row.ended_on } : null;
});
const preview = useInquiryPreview(composeFor);
const form = reactive({ method: "email" as InquiryMethod, contacted_on: "", sent_to: "", note: "" });

watch(composeFor, (id) => {
  if (!id) return;
  Object.assign(form, {
    method: "email" as InquiryMethod,
    contacted_on: new Date().toISOString().slice(0, 10),
    sent_to: "",
    note: "",
  });
});
watch(
  () => preview.data.value?.sendTo,
  (to) => {
    if (to && !form.sent_to) form.sent_to = to;
  },
);

const employerOf = (employmentId: string) =>
  (employmentQ.data.value ?? []).find((e) => e.id === employmentId)?.employer_name ?? "this employer";

async function save(): Promise<void> {
  if (!composeFor.value) return;
  try {
    await record.mutateAsync({
      driverId: driverId.value,
      input: {
        employment_id: composeFor.value,
        kind: "safety_performance",
        method: form.method,
        contacted_on: form.contacted_on,
        sent_to: form.sent_to.trim(),
        note: form.note.trim() || null,
      },
    });
    toast.success("Inquiry recorded", "The letter and the address it went to are on file.");
    composeFor.value = null;
  } catch (e) {
    toast.error("Could not record the inquiry", e instanceof Error ? e.message : undefined);
  }
}

async function close(row: EmployerInquiry, outcome: "responded" | "no_response" | "undeliverable"): Promise<void> {
  try {
    await recordOutcome.mutateAsync({
      id: row.id,
      driverId: driverId.value,
      input: { outcome, outcome_on: new Date().toISOString().slice(0, 10) },
    });
    toast.success(
      outcome === "no_response" ? "Non-response documented" : "Recorded",
      outcome === "no_response"
        ? "A documented good-faith effort counts in place of a reply."
        : undefined,
    );
  } catch (e) {
    toast.error("Could not record what came back", e instanceof Error ? e.message : undefined);
  }
}

const OUTCOME_TONE: Record<string, string> = {
  awaiting: "info",
  responded: "success",
  no_response: "neutral",
  undeliverable: "warning",
};

const columns: DataTableColumn[] = [
  { key: "employer_name", label: "Employer" },
  { key: "contacted_on", label: "Contacted" },
  { key: "method", label: "How" },
  { key: "outcome", label: "Outcome" },
];

const FORM_ID = "employer-inquiry-form";
</script>

<template>
  <div class="space-y-6">
    <BaseCard>
      <h3 class="text-sm font-semibold text-ink">Previous-employer inquiries</h3>
      <p class="mt-1 text-sm text-ink-muted">
        Their safety performance history has to be investigated with every DOT-regulated employer in
        the three years before they applied. The replies — or a documented record of trying — must be
        in the file within 30 days of their employment starting.
      </p>

      <ul v-if="canInvestigate && owing.length" class="mt-4 space-y-2">
        <li
          v-for="employer in owing"
          :key="employer.id"
          class="flex flex-wrap items-center justify-between gap-3 rounded-surface bg-surface-muted p-3"
        >
          <div>
            <p class="text-sm font-medium text-ink">{{ employer.employer_name }}</p>
            <p class="text-xs text-ink-muted">
              {{ employer.started_on }} → {{ employer.ended_on ?? "present" }}
            </p>
          </div>
          <BaseButton size="sm" @click="composeFor = employer.id">Compose an inquiry</BaseButton>
        </li>
      </ul>
      <p v-else-if="!owing.length" class="mt-4 text-sm text-ink-muted">
        No DOT-regulated employers on this file yet. Only those owe an inquiry; a non-regulated job
        does not.
      </p>
    </BaseCard>

    <BaseCard padding="none">
      <DataTable
        :columns="columns"
        :rows="inquiriesQ.data.value ?? []"
        row-key="id"
        :loading="inquiriesQ.isLoading.value"
        :error="inquiriesQ.isError.value ? (inquiriesQ.error.value?.message ?? 'Could not load the inquiries.') : null"
        :retrying="inquiriesQ.isFetching.value"
        empty-text="Nothing has been sent yet. Compose an inquiry for each DOT-regulated employer above."
      >
        <template #cell-employer_name="{ row }">
          <span class="font-medium text-ink">{{ row.employer_name }}</span>
          <span v-if="row.employer_address" class="ml-2 text-xs text-ink-muted">{{ row.employer_address }}</span>
        </template>
        <template #cell-contacted_on="{ row }">{{ row.contacted_on }}</template>
        <template #cell-method="{ row }">
          <span class="text-ink-muted">{{ INQUIRY_METHOD_LABELS[row.method as InquiryMethod] ?? row.method }}</span>
        </template>
        <template #cell-outcome="{ row }">
          <span :class="[BADGE_BASE, toneClass(OUTCOME_TONE[row.outcome] ?? 'neutral')]">
            {{ INQUIRY_OUTCOME_LABELS[row.outcome as keyof typeof INQUIRY_OUTCOME_LABELS] ?? row.outcome }}
          </span>
          <span v-if="row.outcome_on" class="ml-2 text-xs text-ink-muted">{{ row.outcome_on }}</span>
        </template>
        <template #actions="{ row }">
          <div v-if="canInvestigate && row.outcome === 'awaiting'" class="flex items-center gap-2">
            <BaseButton size="sm" @click="answering = row">They answered</BaseButton>
            <BaseButton size="sm" @click="close(row, 'no_response')">Document no reply</BaseButton>
          </div>
        </template>
      </DataTable>
    </BaseCard>

    <InquiryResponseDrawer
      :inquiry="answering"
      :declared="declaredFor"
      :driver-id="driverId"
      @close="answering = null"
    />

    <SlideOver
      :open="composeFor !== null"
      size="lg"
      :title="`Inquiry to ${composeFor ? employerOf(composeFor) : ''}`"
      @close="composeFor = null"
    >
      <div class="space-y-6">
        <p class="text-sm text-ink-muted">
          Send this however this employer actually answers — email, post or fax — then record what you
          did. The record of asking is what the file needs; a reply is not required for it to be
          complete, but a record of asking is.
        </p>

        <div v-if="preview.isLoading.value" class="text-sm text-ink-muted">Composing…</div>
        <template v-else-if="preview.data.value">
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="text-sm font-semibold text-ink">{{ preview.data.value.title }}</h3>
              <span :class="[BADGE_BASE, toneClass('neutral')]">{{ preview.data.value.version }}</span>
            </div>
            <p class="mt-3 whitespace-pre-line rounded-surface bg-surface-muted p-3 text-sm text-ink-secondary">
              {{ preview.data.value.body }}
            </p>
          </div>

          <form :id="FORM_ID" class="space-y-4" @submit.prevent="save">
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField v-slot="{ id }" label="How you contacted them">
                <ComboSelect
                  :id="id"
                  v-model="form.method"
                  :options="INQUIRY_METHODS.map((m) => ({ value: m, label: INQUIRY_METHOD_LABELS[m] }))"
                />
              </FormField>
              <FormField v-slot="{ id }" label="On">
                <AppDateField :id="id" v-model="form.contacted_on" />
              </FormField>
            </div>
            <FormField
              v-slot="{ id }"
              label="Where it went"
              hint="The address, mailbox or fax number — or who you spoke to."
            >
              <BaseInput :id="id" v-model="form.sent_to" />
            </FormField>
            <FormField v-slot="{ id }" label="Note" hint="Optional.">
              <BaseInput :id="id" v-model="form.note" placeholder="Optional" />
            </FormField>
          </form>
        </template>
      </div>

      <template #footer>
        <div class="flex items-center justify-end gap-3">
          <BaseButton variant="ghost" :disabled="record.isPending.value" @click="composeFor = null">Cancel</BaseButton>
          <BaseButton
            :form="FORM_ID"
            type="submit"
            variant="primary"
            :disabled="record.isPending.value || !form.contacted_on || !form.sent_to.trim()"
          >
            {{ record.isPending.value ? "Recording…" : "Record this inquiry" }}
          </BaseButton>
        </div>
      </template>
    </SlideOver>
  </div>
</template>
