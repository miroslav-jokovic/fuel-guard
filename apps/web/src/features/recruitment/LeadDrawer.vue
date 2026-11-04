<script setup lang="ts">
import { computed, ref, toRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { AppButton as BaseButton, AppCallout, FactList, QueryState } from "@silvicom/ui";
import {
  LEAD_CONTACT_METHOD_LABELS,
  LEAD_CONTACT_OUTCOME_LABELS,
  LEAD_EVIDENCE_LABELS,
  LEAD_REQUIREMENT_LABELS,
  LEAD_STATUS_LABELS,
  LEAD_VERDICT_LABELS,
  leadAnswerRows,
  leadChannelLabel,
  leadVerdictWhy,
  type LeadContactInput,
} from "@silvicom/shared";
import SlideOver from "@/components/SlideOver.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { leadStatusTone, leadVerdictTone } from "@/lib/badges.recruiting";
import { formatDateTime, formatPhone } from "@/lib/format";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import LeadContactForm from "./LeadContactForm.vue";
import LeadConvertForm from "./LeadConvertForm.vue";
import { NEW_APPLICANT, useLeadActions, type LeadHoldAnswer } from "./useLeadActions";
import { useLeadContactsQuery, useLeadQuery } from "./useLeads";

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
 */
const props = defineProps<{ leadId: string }>();
const emit = defineEmits<{ close: [] }>();

const route = useRoute();
const id = toRef(props, "leadId");
const leadQ = useLeadQuery(id);
const contactsQ = useLeadContactsQuery(id);
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
const router = useRouter();
const session = useSessionStore();
const toast = useToastStore();
const { logContact, convert, setHold } = useLeadActions(id);

const canWork = computed(() => session.can("recruitment") && lead.value !== null && lead.value.purged_at === null);
const working = ref<"contact" | "convert" | "hold" | null>(null);
// A person's other lead opens in this same drawer, and a refusal can reveal the details were deleted meanwhile.
watch([id, canWork], () => (working.value = null));

/**
 * Set at once, not read from a mutation's `isPending`, which vue-query reports a tick later: a double press in that
 * tick would write two append-only contact rows.
 */
const busy = ref(false);
async function act(failed: string, run: () => Promise<void>): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    await run();
  } catch (e) {
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
    <LeadContactForm v-else-if="working === 'contact'" :form-id="CONTACT_FORM" @save="saveContact" />
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

    <template v-if="canWork" #footer>
      <div v-if="working" class="flex items-center justify-end gap-3">
        <BaseButton :disabled="busy" @click="working = null">Cancel</BaseButton>
        <BaseButton v-if="working === 'contact'" variant="primary" type="submit" :form="CONTACT_FORM" :disabled="busy" data-test="save-contact">
          {{ busy ? "Saving…" : "Save contact" }}
        </BaseButton>
        <BaseButton v-else-if="working === 'hold'" variant="primary" :disabled="busy" data-test="save-hold" @click="runHold">
          {{ busy ? "Saving…" : holding ? "Mark do not contact" : "Lift do not contact" }}
        </BaseButton>
        <BaseButton v-else variant="primary" :disabled="busy || convertChoice === ''" data-test="save-convert" @click="runConvert">
          {{ busy ? "Saving…" : "Confirm" }}
        </BaseButton>
      </div>
      <div v-else class="flex flex-wrap items-center justify-end gap-3">
        <BaseButton :disabled="busy" data-test="hold" @click="working = 'hold'">{{ lead?.do_not_contact ? "Lift do not contact" : "Do not contact" }}</BaseButton>
        <BaseButton v-if="lead?.status !== 'converted'" :disabled="busy" data-test="convert" @click="startConvert">Make applicant</BaseButton>
        <BaseButton variant="primary" :disabled="busy" data-test="log-contact" @click="working = 'contact'">Log a contact</BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
