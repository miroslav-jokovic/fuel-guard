<script setup lang="ts">
import { computed, ref, toRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { AppButton as BaseButton, AppCallout, AppCheckbox, AppFormField as FormField, AppTextarea, FactList, QueryState } from "@silvicom/ui";
import {
  LEAD_CLOSURE_KIND_LABELS,
  LEAD_CONTACT_METHOD_LABELS,
  LEAD_CONTACT_OUTCOME_LABELS,
  LEAD_EVIDENCE_LABELS,
  LEAD_REQUIREMENT_LABELS,
  LEAD_STATUS_LABELS,
  LEAD_VERDICT_LABELS,
  canPurgeLead,
  leadAnswerRows,
  leadChannelLabel,
  leadCloseReasonLabel,
  leadEvidenceFrom,
  leadVerdictWhy,
  qualifyUnavailable,
  type LeadCloseReason,
  type LeadContactInput,
} from "@silvicom/shared";
import SlideOver from "@/components/SlideOver.vue";
import StepUpPrompt from "@/components/StepUpPrompt.vue";
import { useStepUpRetry } from "@/composables/useStepUpRetry";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { leadStatusTone, leadVerdictTone } from "@/lib/badges.recruiting";
import { formatDateTime, formatPhone } from "@/lib/format";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import LeadCloseForm from "./LeadCloseForm.vue";
import LeadContactForm from "./LeadContactForm.vue";
import LeadConvertForm from "./LeadConvertForm.vue";
import { NEW_APPLICANT, useLeadActions, type LeadHoldAnswer, type LeadPurgeAnswer } from "./useLeadActions";
import { useLeadClosuresQuery, useLeadContactsQuery, useLeadQuery } from "./useLeads";

/**
 * One lead (E4b): what they told us, what that means against the opening, and who already reached them.
 *
 * It reads the lead by id rather than taking the queue's row, because a notification or a person's other lead
 * can name one the loaded queue does not hold.
 *
 * Every detail says where it came from, because a recruiter treats a typed-in number and a form's answer
 * differently, and every verdict says why, because "not known yet" is only useful beside what to ask. Contacts
 * sit straight under the details: who already called is what a recruiter needs before dialling.
 *
 * Working a lead (E4b3) needs `recruitment` manage, and a purged lead has nothing left to work, so either way the
 * footer is not there at all. Each act replaces the body (contract §6.2), the question on do-not-contact included:
 * `useConfirm`'s dialog over this one counts as a press outside it, which closes the drawer and loses the lead.
 * Delete details is the admin's (`canPurgeLead`, derived, never a role list), and its password prompt replaces the
 * body the same way.
 *
 * The recruiter's verdict (LQ5c over 0578): Qualify after a reached call, Close with a reason from the fixed list,
 * Reopen a closed lead. What each needs on record is derived from the contacts already loaded here
 * (`leadEvidenceFrom`) with the database's own rule and words (`closeReasonUnavailable`, `qualifyUnavailable`), so
 * a button a recruiter cannot use yet says what to log first — and the database still decides. The acts are listed
 * under "Decisions", newest first, so the next recruiter sees why the lead sits where it does.
 */
const props = defineProps<{ leadId: string }>();
const emit = defineEmits<{ close: [] }>();

const route = useRoute();
const id = toRef(props, "leadId");
const leadQ = useLeadQuery(id);
const contactsQ = useLeadContactsQuery(id);
const closuresQ = useLeadClosuresQuery(id);
const lead = computed(() => leadQ.data.value ?? null);

const title = computed(() => {
  if (!lead.value) return "Lead";
  return lead.value.purged_at ? "Details deleted" : (lead.value.full_name ?? "No name given");
});
const source = computed(() => (lead.value ? leadChannelLabel(lead.value.channel) : ""));
const facts = computed(() => [
  { key: "name", label: "Name", value: lead.value?.full_name },
  { key: "phone", label: "Phone", value: lead.value?.phone_e164 ? formatPhone(lead.value.phone_e164) : null },
  { key: "email", label: "Email", value: lead.value?.email_lower },
]);
const answers = computed(() => leadAnswerRows(lead.value?.answers ?? {}));
const linkTo = (leadId: string) => ({ query: { ...route.query, lead: leadId } });

const CONTACT_FORM = "lead-contact-form";
const CLOSE_FORM = "lead-close-form";
const router = useRouter();
const session = useSessionStore();
const toast = useToastStore();
const { logContact, convert, setHold, purge, close, qualify, reopen } = useLeadActions(id);
const { stepUpFor, holdForStepUp, confirmed, cancel: cancelStepUp } = useStepUpRetry();

const canWork = computed(() => session.can("recruitment") && lead.value !== null && lead.value.purged_at === null);
const canDelete = computed(() => canPurgeLead(session.role) && lead.value !== null && lead.value.purged_at === null);
const working = ref<"contact" | "convert" | "hold" | "purge" | "close" | "qualify" | "reopen" | null>(null);
function stopWork(): void {
  working.value = null;
  cancelStepUp();
}
// A person's other lead opens in this same drawer, and a refusal can reveal the details were deleted meanwhile.
watch([id, canWork, canDelete], stopWork);

/**
 * Set at once, not read from a mutation's `isPending`, which vue-query reports a tick later: a double press in that
 * tick would write two append-only contact rows.
 */
const busy = ref(false);
async function act(failed: string, run: () => Promise<void>, retry?: () => Promise<void>): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    await run();
  } catch (e) {
    if (retry && holdForStepUp(e, retry)) return;
    toast.error(failed, e instanceof Error ? e.message : undefined);
  } finally {
    busy.value = false;
  }
}

const saveContact = (input: LeadContactInput) =>
  act("Could not log the contact", async () => {
    await logContact.mutateAsync(input);
    working.value = null;
    toast.success("Contact logged");
  });

const openApplicants = computed(() => (lead.value?.drivers ?? []).filter((d) => d.status === "applicant" && !d.archived));
const otherRecords = computed(() => (lead.value?.drivers.length ?? 0) - openApplicants.value.length);
const convertChoice = ref("");
function startConvert(): void {
  convertChoice.value = openApplicants.value.length > 0 ? "" : NEW_APPLICANT;
  working.value = "convert";
}
const runConvert = () =>
  act("Could not make them an applicant", async () => {
    const made = await convert.mutateAsync(convertChoice.value === NEW_APPLICANT ? null : convertChoice.value);
    working.value = null;
    toast.push("success", made.created_applicant ? "Applicant created" : "Added to their record", undefined, {
      duration: 8000,
      action: { label: "Open applicant", onAction: () => void router.push(`/recruitment/${made.driver_id}`) },
    });
  });

function holdToast(answer: LeadHoldAnswer): void {
  if (answer.kind === "held") {
    if (answer.newly) toast.success("Marked do not contact", "This number is held wherever it turns up.");
    else toast.info("Already held", "This number was already marked do not contact.");
  } else if (answer.stop_remains) {
    const lifted = answer.lifted > 0 ? "The office's hold is lifted, but this" : "This";
    toast.warning("The number stays held", `${lifted} person texted STOP. Only their START can undo that.`);
  } else if (answer.lifted > 0) toast.success("Hold lifted", "The office can contact this number again.");
  else toast.info("Nothing to lift", "This number has no hold on it.");
}
const holding = computed(() => !lead.value?.do_not_contact);
const runHold = () =>
  act("Could not change do not contact", async () => {
    const answer = await setHold.mutateAsync(holding.value);
    working.value = null;
    holdToast(answer);
  });

// LQ5c: the evidence on record, counted as 0578's functions count it; the buttons and the reason list read it.
const evidence = computed(() => leadEvidenceFrom(contactsQ.data.value ?? [], lead.value?.also.length ?? 0));
const isClosed = computed(() => lead.value?.status === "not_qualified" || lead.value?.status === "lost");
const canDecide = computed(() => canWork.value && lead.value?.status !== "converted");
const qualifyWhy = computed(() => qualifyUnavailable(evidence.value));
const closeForm = ref<InstanceType<typeof LeadCloseForm> | null>(null);
const closeReady = computed(() => closeForm.value?.ready ?? false);
const decisionNote = ref("");
function startDecision(kind: "close" | "qualify" | "reopen"): void {
  decisionNote.value = "";
  working.value = kind;
}
const runClose = (input: { reason: LeadCloseReason; note: string | null }) =>
  act("Could not close the lead", async () => {
    const a = await close.mutateAsync(input);
    working.value = null;
    if (a.already) toast.info("Already closed", `This lead was already ${LEAD_STATUS_LABELS[a.status].toLowerCase()}.`);
    else toast.success(`Closed — ${leadCloseReasonLabel(input.reason)}`, a.verdict_written ? "The requirement is recorded as not met." : undefined);
  });
const runQualify = () =>
  act("Could not mark the lead qualified", async () => {
    const a = await qualify.mutateAsync({ note: decisionNote.value.trim() || null });
    working.value = null;
    if (a.already) toast.info("Already qualified");
    else toast.success("Marked qualified", "Next: make them an applicant when they are ready.");
  });
const runReopen = () =>
  act("Could not reopen the lead", async () => {
    const a = await reopen.mutateAsync({ note: decisionNote.value.trim() || null });
    working.value = null;
    toast.success("Reopened", `The lead is ${LEAD_STATUS_LABELS[a.status].toLowerCase()} again.`);
  });

const samePerson = ref(false);
function startPurge(): void {
  samePerson.value = false;
  working.value = "purge";
}
function purgeToast(answer: LeadPurgeAnswer): void {
  const skipped = answer.skipped_applicants.length;
  if (skipped > 0) {
    const kept = skipped === 1 ? "1 other lead became an applicant, so it stays." : `${skipped} other leads became applicants, so they stay.`;
    toast.warning("Details deleted, with leads left", `${kept} Delete the applicant to remove it.`);
  } else if (answer.purged.length > 1) toast.success("Details deleted", `${answer.purged.length} leads were emptied.`);
  else if (answer.purged.length === 1) toast.success("Details deleted");
  else toast.info("Already deleted", "This lead's details were deleted before.");
}
const runPurge = (): Promise<void> =>
  act("Could not delete the details", async () => {
    const answer = await purge.mutateAsync(samePerson.value);
    working.value = null;
    purgeToast(answer);
  }, runPurge);
</script>

<template>
  <SlideOver :open="leadId !== ''" :title="title" :description="lead ? `${source} · ${formatDateTime(lead.received_at)}` : undefined" size="lg" @close="emit('close')">
    <QueryState
      v-if="!lead"
      :loading="leadQ.isLoading.value"
      :error="leadQ.error.value"
      error-text="Could not load this lead."
      :retrying="leadQ.isFetching.value"
      loading-text="Loading the lead…"
      @retry="leadQ.refetch()"
    />
    <StepUpPrompt v-else-if="stepUpFor" :reason="stepUpFor" @confirmed="confirmed" @cancel="cancelStepUp" />
    <div v-else-if="working === 'purge'" class="space-y-4 text-sm text-ink-secondary" data-test="purge-form">
      <p>This deletes the name, phone, email and answers on this lead. It can't be undone.</p>
      <p>The record of who contacted them stays, and any notes on it are withheld.</p>
      <AppCheckbox v-if="lead.also.length > 0" v-model="samePerson" label="Also delete their other leads with this phone or email" data-test="same-person" />
    </div>
    <LeadContactForm v-else-if="working === 'contact'" :form-id="CONTACT_FORM" @save="saveContact" />
    <LeadCloseForm v-else-if="working === 'close'" ref="closeForm" :form-id="CLOSE_FORM" :evidence="evidence" @save="runClose" />
    <div v-else-if="working === 'qualify' || working === 'reopen'" class="space-y-4 text-sm text-ink-secondary" :data-test="`${working}-form`">
      <template v-if="working === 'qualify'">
        <p>This records that you spoke with them and they are worth an application.</p>
        <p>It does not make them an applicant — that is the next step, when they are ready.</p>
      </template>
      <template v-else>
        <p>This brings the lead back into the queue. Its earlier decisions stay on record.</p>
        <p>It comes back as contacted if anybody ever reached for it, else as new.</p>
      </template>
      <FormField v-slot="{ id }" label="Note (optional)" hint="Stays in this drawer.">
        <AppTextarea :id="id" v-model="decisionNote" :rows="3" :maxlength="2000" data-test="decision-note" />
      </FormField>
    </div>
    <LeadConvertForm
      v-else-if="working === 'convert'"
      v-model="convertChoice"
      :name="lead.full_name ?? 'This person'"
      :applicants="openApplicants"
      :other-records="otherRecords"
    />
    <div v-else-if="working === 'hold'" class="space-y-4 text-sm text-ink-secondary" data-test="hold-form">
      <template v-if="holding">
        <p>This records that the person asked not to be contacted.</p>
        <p>It holds the number on every lead that has it, and on their applicant record if they have one.</p>
      </template>
      <p v-else>This lets the office contact this number again. Only lift it if the person asked to hear from us.</p>
    </div>
    <div v-else class="space-y-6">
      <div class="flex flex-wrap items-center gap-2">
        <span :class="[BADGE_BASE, leadStatusTone(lead.status)]">{{ LEAD_STATUS_LABELS[lead.status] }}</span>
        <span v-if="lead.do_not_contact" :class="[BADGE_BASE, toneClass('danger')]" data-test="held">Do not contact</span>
      </div>

      <AppCallout v-if="lead.purged_at" tone="info" data-test="purged">
        This person's details were deleted on {{ formatDateTime(lead.purged_at) }}. The record of who contacted them stays.
      </AppCallout>

      <section v-else aria-labelledby="lead-details-heading">
        <h3 id="lead-details-heading" class="text-sm font-semibold text-ink">Details</h3>
        <div class="mt-3">
          <FactList :facts="facts" layout="rows">
            <template v-for="fact in facts" :key="fact.key" #[`value-${fact.key}`]>
              <template v-if="fact.value">
                {{ fact.value }}
                <span class="ml-2 whitespace-nowrap text-xs font-normal text-ink-muted" data-test="source">{{ source }}</span>
              </template>
              <span v-else class="text-ink-tertiary">Not given</span>
            </template>
          </FactList>
        </div>
      </section>

      <section aria-labelledby="lead-contacts-heading">
        <h3 id="lead-contacts-heading" class="text-sm font-semibold text-ink">Contacts</h3>
        <div class="mt-3">
          <QueryState
            v-if="!contactsQ.data.value"
            compact
            :loading="contactsQ.isLoading.value"
            :error="contactsQ.error.value"
            error-text="Could not load who contacted this lead."
            :retrying="contactsQ.isFetching.value"
            @retry="contactsQ.refetch()"
          />
          <p v-else-if="contactsQ.data.value.length === 0" class="text-sm text-ink-muted">Nobody has contacted this lead yet.</p>
          <ul v-else class="space-y-3">
            <li v-for="c in contactsQ.data.value" :key="c.id" class="text-sm" data-test="contact">
              <p class="font-medium text-ink">
                {{ LEAD_CONTACT_METHOD_LABELS[c.method] }}{{ c.direction === "inbound" ? " from them" : "" }}
                <template v-if="c.outcome">· {{ LEAD_CONTACT_OUTCOME_LABELS[c.outcome] }}</template>
              </p>
              <p class="text-xs text-ink-muted">{{ c.created_by_name }} · {{ formatDateTime(c.contacted_at) }}</p>
              <p v-if="c.note" class="mt-1 whitespace-pre-line text-ink-secondary">{{ c.note }}</p>
              <p v-else-if="c.note_withheld" class="mt-1 text-ink-muted" data-test="note-withheld">
                A note was written here. It's withheld because this person's details were deleted.
              </p>
            </li>
          </ul>
        </div>
      </section>

      <section v-if="(closuresQ.data.value?.length ?? 0) > 0" aria-labelledby="lead-decisions-heading">
        <h3 id="lead-decisions-heading" class="text-sm font-semibold text-ink">Decisions</h3>
        <ul class="mt-3 space-y-3">
          <li v-for="c in closuresQ.data.value" :key="c.id" class="text-sm" data-test="decision">
            <p class="font-medium text-ink">
              {{ LEAD_CLOSURE_KIND_LABELS[c.kind] }}<template v-if="c.reason"> · {{ leadCloseReasonLabel(c.reason) }}</template>
              <span class="ml-2 text-xs font-normal text-ink-muted">→ {{ LEAD_STATUS_LABELS[c.status_after] }}</span>
            </p>
            <p class="text-xs text-ink-muted">{{ c.actor_name }} · {{ formatDateTime(c.recorded_at) }}</p>
            <p v-if="c.note" class="mt-1 whitespace-pre-line text-ink-secondary">{{ c.note }}</p>
            <p v-else-if="c.note_withheld" class="mt-1 text-ink-muted" data-test="decision-note-removed">Any note here was removed with this person's details.</p>
          </li>
        </ul>
      </section>

      <section v-if="answers.length > 0" aria-labelledby="lead-answers-heading">
        <h3 id="lead-answers-heading" class="text-sm font-semibold text-ink">What they answered</h3>
        <ul class="mt-3 space-y-3">
          <li v-for="a in answers" :key="a.key" class="text-sm" data-test="answer">
            <p class="text-ink-muted">{{ a.question }}</p>
            <p class="font-medium text-ink">
              {{ a.answer }}
              <span class="ml-2 text-xs font-normal text-ink-muted">{{ source }}</span>
            </p>
          </li>
        </ul>
      </section>

      <section v-if="lead.verdicts.length > 0" aria-labelledby="lead-match-heading">
        <h3 id="lead-match-heading" class="text-sm font-semibold text-ink">Against the opening</h3>
        <ul class="mt-3 space-y-3">
          <li v-for="v in lead.verdicts" :key="v.requirement" class="text-sm" data-test="verdict">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-medium text-ink">{{ LEAD_REQUIREMENT_LABELS[v.requirement] }}</span>
              <span :class="[BADGE_BASE, leadVerdictTone(v.verdict)]">{{ LEAD_VERDICT_LABELS[v.verdict] }}</span>
              <span v-if="!v.hard" class="text-xs text-ink-muted">Preference</span>
              <span v-if="v.evidence" class="text-xs text-ink-muted">{{ LEAD_EVIDENCE_LABELS[v.evidence] }}</span>
            </div>
            <p class="mt-1 text-ink-secondary">{{ leadVerdictWhy(v) }}</p>
          </li>
        </ul>
      </section>

      <section v-if="lead.drivers.length > 0 || lead.also.length > 0" aria-labelledby="lead-same-heading">
        <h3 id="lead-same-heading" class="text-sm font-semibold text-ink">May be the same person</h3>
        <p class="mt-1 text-sm text-ink-muted">Matched by phone or email.</p>
        <ul class="mt-3 space-y-2 text-sm">
          <li v-for="d in lead.drivers" :key="d.id" data-test="same-driver">
            <RouterLink :to="`/recruitment/${d.id}`" class="font-medium text-ink hover:underline">Open their record</RouterLink>
            <span class="ml-2 text-xs text-ink-muted capitalize">{{ d.status }}{{ d.archived ? ", archived" : "" }}</span>
          </li>
          <li v-for="o in lead.also" :key="o.id" data-test="same-lead">
            <RouterLink :to="linkTo(o.id)" class="font-medium text-ink hover:underline">{{ leadChannelLabel(o.channel) }}</RouterLink>
            <span class="ml-2 text-xs text-ink-muted">{{ LEAD_STATUS_LABELS[o.status] }} · {{ formatDateTime(o.received_at) }}</span>
          </li>
        </ul>
      </section>
    </div>

    <template v-if="(canWork || canDelete) && !stepUpFor" #footer>
      <div v-if="working" class="flex items-center justify-end gap-3">
        <BaseButton :disabled="busy" @click="stopWork">Cancel</BaseButton>
        <BaseButton v-if="working === 'contact'" variant="primary" type="submit" :form="CONTACT_FORM" :disabled="busy" data-test="save-contact">
          {{ busy ? "Saving…" : "Save contact" }}
        </BaseButton>
        <BaseButton v-else-if="working === 'purge'" variant="danger" :disabled="busy" data-test="save-purge" @click="runPurge">
          {{ busy ? "Deleting…" : "Delete details" }}
        </BaseButton>
        <BaseButton v-else-if="working === 'hold'" variant="primary" :disabled="busy" data-test="save-hold" @click="runHold">
          {{ busy ? "Saving…" : holding ? "Mark do not contact" : "Lift do not contact" }}
        </BaseButton>
        <BaseButton v-else-if="working === 'close'" variant="danger" type="submit" :form="CLOSE_FORM" :disabled="busy || !closeReady" data-test="save-close">
          {{ busy ? "Closing…" : "Close lead" }}
        </BaseButton>
        <BaseButton v-else-if="working === 'qualify'" variant="primary" :disabled="busy" data-test="save-qualify" @click="runQualify">
          {{ busy ? "Saving…" : "Mark qualified" }}
        </BaseButton>
        <BaseButton v-else-if="working === 'reopen'" variant="primary" :disabled="busy" data-test="save-reopen" @click="runReopen">
          {{ busy ? "Reopening…" : "Reopen lead" }}
        </BaseButton>
        <BaseButton v-else variant="primary" :disabled="busy || convertChoice === ''" data-test="save-convert" @click="runConvert">
          {{ busy ? "Saving…" : "Confirm" }}
        </BaseButton>
      </div>
      <div v-else class="flex flex-wrap items-center justify-end gap-3">
        <BaseButton v-if="canDelete" variant="danger" :disabled="busy" data-test="purge" @click="startPurge">Delete details</BaseButton>
        <template v-if="canWork">
          <BaseButton :disabled="busy" data-test="hold" @click="working = 'hold'">{{ lead?.do_not_contact ? "Lift do not contact" : "Do not contact" }}</BaseButton>
          <template v-if="canDecide">
            <BaseButton v-if="isClosed" :disabled="busy" data-test="reopen" @click="startDecision('reopen')">Reopen</BaseButton>
            <template v-else>
              <BaseButton :disabled="busy" data-test="close" @click="startDecision('close')">Close</BaseButton>
              <BaseButton v-if="lead?.status !== 'qualified'" :disabled="busy || qualifyWhy !== null" :title="qualifyWhy ?? undefined" data-test="qualify" @click="startDecision('qualify')">Qualify</BaseButton>
            </template>
          </template>
          <BaseButton v-if="lead?.status !== 'converted'" :disabled="busy" data-test="convert" @click="startConvert">Make applicant</BaseButton>
          <BaseButton variant="primary" :disabled="busy" data-test="log-contact" @click="working = 'contact'">Log a contact</BaseButton>
        </template>
      </div>
    </template>
  </SlideOver>
</template>
