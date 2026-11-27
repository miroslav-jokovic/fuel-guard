<script setup lang="ts">
import { computed, ref, toRef, watch } from "vue";
import { BROKER_MAIL_ASK_LABELS, BROKER_MAIL_DRAFT_STATE_LABELS, formatDisplayDateTime, type BrokerMailCompose, type BrokerMailLoadFacts } from "@silvicom/shared";
import { AppBadge, AppButton, AppCallout, AppFormField, AppTextarea, FactList, QueryState, type Fact } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import { useToastStore } from "@/stores/toast";
import { useBrokerMailDetail, useCloseBrokerMail, useComposeDraft, useQueueDraft } from "./useBrokerMail";

/**
 * One broker email (BROKER-MAIL-READER-PLAN P4, D-BMR11; the mockup's panel). What the broker asks,
 * the load as the Dispatch board shows it, and the reply draft: 360 writes it from those facts only,
 * the dispatcher reads and edits it, and "Put draft in Outlook" makes it a reply DRAFT in their own
 * Outlook, in the same thread. 360 never sends — they press Send in Outlook, and the row closes itself.
 * "Handled by phone" / "Not for us" close the row and stop its texts. All three acts are the mailbox
 * owner's alone (an admin who sees everyone's reads, and cannot write in someone's name).
 */
const props = defineProps<{ messageId: string | null }>();
const emit = defineEmits<{ close: [] }>();
const toast = useToastStore();
const { data, isLoading, isError, error, isFetching, refetch } = useBrokerMailDetail(toRef(props, "messageId"));
const compose = useComposeDraft();
const queue = useQueueDraft();
const closeIt = useCloseBrokerMail();

const proposal = ref<BrokerMailCompose | null>(null);
const text = ref("");
watch(() => props.messageId, () => { proposal.value = null; text.value = ""; });

const open = computed(() => data.value?.threadState === "waiting");
const draftOpen = computed(() => data.value?.draft && ["queued", "claimed", "in_outlook"].includes(data.value.draft.state));
const canAct = computed(() => Boolean(data.value?.isOwner && open.value));

function factsOf(f: BrokerMailLoadFacts): Fact[] {
  const stop = f.nextStop;
  return [
    { label: "Status", value: f.status ?? "—" },
    { label: "In McLeod", value: f.inMcleod ? (f.accepted ? "Yes, accepted" : "Yes, not on a truck yet") : "No" },
    { label: "Truck · trailer", value: [f.truckUnit, f.trailerUnit].filter(Boolean).join(" · ") || "—" },
    { label: "Last GPS", value: f.location ? `${f.location.place}, ${f.location.ageMinutes} min ago` : "No live position" },
    { label: stop?.kind === "pickup" ? "Next: pickup" : "Next: delivery", value: stop ? [stop.city, stop.state].filter(Boolean).join(", ") || "—" : "—" },
    { label: "Appointment", value: stop?.appointment ?? "—" },
    { label: "ETA", value: f.eta?.at ?? "—" },
    { label: "Miles to go", value: f.milesToNextStop ?? "—", numeric: true },
  ];
}
const facts = computed(() => (data.value?.facts ? factsOf(data.value.facts) : []));

async function onCompose() {
  if (!props.messageId) return;
  try {
    proposal.value = await compose.mutateAsync(props.messageId);
    text.value = proposal.value.text;
  } catch (e) {
    toast.error("No draft", e instanceof Error ? e.message : undefined);
  }
}
async function onQueue() {
  if (!props.messageId || !text.value.trim()) return;
  try {
    await queue.mutateAsync({ id: props.messageId, body: { text: text.value, factsIncluded: proposal.value?.factsIncluded ?? [], composedSha256: proposal.value?.textSha256 ?? null } });
    toast.success("Going to your Outlook", "It appears in the same thread within a minute. Open it there and press Send.");
    proposal.value = null;
  } catch (e) {
    toast.error("Could not put the draft in Outlook", e instanceof Error ? e.message : undefined);
  }
}
async function onClose(how: "closed_by_phone" | "closed_not_for_us") {
  if (!props.messageId) return;
  try {
    await closeIt.mutateAsync({ id: props.messageId, how });
    toast.success(how === "closed_by_phone" ? "Closed: handled by phone" : "Closed: not for us", "No text will go out about it.");
    emit("close");
  } catch (e) {
    toast.error("Could not close it", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <SlideOver :open="messageId !== null" :title="data?.fromAddress ?? 'Broker email'" :description="data?.subject ?? undefined" size="lg" @close="emit('close')">
    <QueryState :loading="isLoading" :error="isError ? error : null" :retrying="isFetching" loading-text="Opening the email…" error-text="Could not open the email." @retry="refetch()">
      <div v-if="data" class="space-y-6">
        <section aria-labelledby="bm-ask">
          <h3 id="bm-ask" class="text-sm font-semibold text-ink">Asking for</h3>
          <div class="mt-2 flex flex-wrap gap-2">
            <AppBadge v-for="k in data.askKinds.length ? data.askKinds : (['other'] as const)" :key="k" tone="neutral">{{ BROKER_MAIL_ASK_LABELS[k] }}</AppBadge>
          </div>
          <p class="mt-1 text-xs text-ink-tertiary">Received {{ formatDisplayDateTime(data.receivedAt) }}. 360 keeps no email text; open the email in Outlook to read it.</p>
        </section>

        <section aria-labelledby="bm-load">
          <h3 id="bm-load" class="text-sm font-semibold text-ink">Load {{ data.load?.ref ?? "" }}</h3>
          <FactList v-if="data.facts" class="mt-2" :facts="facts" :columns="2" />
          <p v-else class="mt-1 text-sm text-ink-muted">No load is tied to this email, so 360 cannot write a draft for it. Answer in Outlook.</p>
        </section>

        <section v-if="data.draft" aria-labelledby="bm-draft-state">
          <h3 id="bm-draft-state" class="text-sm font-semibold text-ink">Draft</h3>
          <AppCallout :tone="data.draft.state === 'in_outlook' ? 'success' : draftOpen ? 'info' : 'caution'" class="mt-2" data-test="draft-state">
            {{ BROKER_MAIL_DRAFT_STATE_LABELS[data.draft.state] }}
          </AppCallout>
        </section>

        <section v-if="canAct && data.facts && !draftOpen" aria-labelledby="bm-reply">
          <h3 id="bm-reply" class="text-sm font-semibold text-ink">Reply draft</h3>
          <p class="mt-1 text-sm text-ink-muted">Written from the load facts above only. Check it, change anything, then put it in your Outlook — you send it from there.</p>
          <AppCallout v-if="!data.draftsAvailable" tone="info" class="mt-2">Mail reading is switched off, so a draft cannot reach Outlook yet.</AppCallout>
          <template v-else>
            <AppButton v-if="!proposal" class="mt-3" variant="secondary" :disabled="compose.isPending.value" @click="onCompose">
              {{ compose.isPending.value ? "Writing…" : "Write a draft" }}
            </AppButton>
            <AppFormField v-else v-slot="{ id }" class="mt-3" label="Your reply">
              <AppTextarea :id="id" v-model="text" :rows="7" data-test="draft-text" />
            </AppFormField>
          </template>
        </section>
        <p v-else-if="!data.isOwner && open" class="text-sm text-ink-muted">Only the dispatcher whose Outlook this is can reply to it or close it.</p>
      </div>
    </QueryState>
    <template v-if="data && canAct" #footer>
      <div class="flex flex-wrap justify-end gap-3">
        <AppButton variant="ghost" :disabled="closeIt.isPending.value" @click="onClose('closed_not_for_us')">Not for us</AppButton>
        <AppButton variant="secondary" :disabled="closeIt.isPending.value" @click="onClose('closed_by_phone')">Handled by phone</AppButton>
        <AppButton v-if="proposal" variant="primary" :disabled="queue.isPending.value || !text.trim()" data-test="put-in-outlook" @click="onQueue">
          {{ queue.isPending.value ? "Sending to Outlook…" : "Put draft in Outlook" }}
        </AppButton>
      </div>
    </template>
  </SlideOver>
</template>
