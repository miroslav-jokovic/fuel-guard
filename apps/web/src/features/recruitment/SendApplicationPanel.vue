<script setup lang="ts">
import { computed, ref, toRef, watch } from "vue";
import { AppButton as BaseButton, AppCallout } from "@silvicom/ui";
import { APPLICATION_SEND_WARNS_ON, hiringStep } from "@silvicom/shared";
import { formatDate } from "@/lib/format";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import ApplicationLinkOnce from "@/features/recruitment/ApplicationLinkOnce.vue";
import ApplicantTextsStatus from "@/features/recruitment/ApplicantTextsStatus.vue";
import { useApplicantChecklistQuery } from "@/features/recruitment/useApplicantChecklist";
import { useSendApplication, type ApplicationSent } from "@/features/recruitment/useSendApplication";
import { useApplicationInvitesQuery } from "@/features/recruitment/useApplicationInvites";

/**
 * "Send the application" — the office's act between screening and the form (AF4, D-AF5, D-AF7).
 *
 * ── IT SAYS WHAT IS OUTSTANDING BEFORE THE PRESS, AND SENDS ANYWAY ────────────────────────────
 * D-AF5: nothing in law puts screening before the application, so this warns and never refuses.
 * The warning is read from the SAME checklist query the page shows, so the sentence above the button
 * and the rows beside the drawer cannot disagree — and the server answers with its own reading after
 * the press, which is what is shown once it has been sent.
 *
 * ── THE LINK COMES BACK ON SCREEN (D-AF7) ─────────────────────────────────────────────────────
 * A text reaches only an applicant who agreed on their waiting screen (SMS-OPT-IN-PLAN D-SMS7), and
 * the sending address is a personal one until the owner's arrives, so the screen is the delivery path
 * that always works: `ApplicationLinkOnce` shows it once, with copy, exactly as it does for the
 * invitation. `ApplicantTextsStatus` says, before the press, whether a text will go too.
 *
 * ⚠ A second press ROTATES the link: the one sent before stops working. That is the recovery for a
 * lost email, and the button says so rather than letting it be a surprise.
 */
const props = defineProps<{ invitationId: string; driverId: string }>();

const session = useSessionStore();
const toast = useToastStore();
const send = useSendApplication();
const checklistQ = useApplicantChecklistQuery(toRef(props, "driverId"));
const invitesQ = useApplicationInvitesQuery(toRef(props, "driverId"));

/** When it was first sent — 0365 keeps the first date, however many times it is re-sent. */
const sentAt = computed(
  () => invitesQ.data.value?.find((i) => i.id === props.invitationId)?.application_sent_at ?? null,
);

// SP5: the org's answer (the `sections` claim), which is what the route's `requireSection` reads.
const canSend = computed(() => session.can("recruitment"));
const result = ref<ApplicationSent | null>(null);

/** The screening steps not done yet, in the checklist's own words. */
const outstanding = computed(() => {
  const steps = checklistQ.data.value?.steps ?? [];
  return steps
    .filter((s) => APPLICATION_SEND_WARNS_ON.includes(s.key) && s.state !== "done")
    .map((s) => s.label);
});
const warnedAfter = computed(() => (result.value?.warnings ?? []).map((k) => hiringStep(k).label));

/**
 * What became of the text (D-SMS7), in one sentence — and nothing at all for an applicant who never
 * agreed, because the status line below already says so and "not texted" there would read as a fault.
 * Since Q-AW29 a text outside the applicant's hours WAITS and goes in their morning (`queued`), and the
 * sentence says so. `quiet_hours` is what an API from before that answered, when the text was dropped
 * and never retried; the two services can sit at different commits, so the old sentence stays for it.
 */
const textLine = computed(() => {
  const text = result.value?.text;
  if (!text || text.reason === "no_consent") return null;
  if (text.sent) return "Also texted to the applicant.";
  if (text.reason === "queued") return "It is night where the applicant lives, so it will be texted to them in the morning. The email and the link above carry it now.";
  if (text.reason === "quiet_hours") return "Not texted: it is outside daytime hours somewhere in the US. The email and the link above carry it.";
  if (text.reason === "consent_revoked" || text.reason === "no_number" || text.reason === "suppressed") return null;
  return "The text did not go through. The email and the link above carry it.";
});

// The drawer swaps applicants without unmounting; one applicant's link must never greet the next.
watch(() => props.invitationId, () => { result.value = null; });

async function press(): Promise<void> {
  try {
    result.value = await send.mutateAsync({ invitationId: props.invitationId, driverId: props.driverId });
  } catch (e) {
    toast.error("Could not send the application", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <section class="space-y-3">
    <p v-if="sentAt && !result" class="text-xs text-ink-secondary">
      Sent {{ formatDate(sentAt) }}. Sending again makes a new link, and the one sent before stops working.
    </p>
    <p v-else-if="!result" class="text-xs text-ink-secondary">
      The applicant has signed their permissions and is waiting for the application form.
    </p>

    <AppCallout v-if="!result && outstanding.length > 0" tone="caution">
      Still outstanding: {{ outstanding.join(", ") }}. You can send the application now; these stay on
      the checklist.
    </AppCallout>

    <template v-if="result">
      <AppCallout v-if="warnedAfter.length > 0" tone="caution">
        Sent with these still outstanding: {{ warnedAfter.join(", ") }}.
      </AppCallout>
      <ApplicationLinkOnce
        :link="result.link"
        :delivery="result.delivery"
        if-lost="send the application again if it is lost; that makes a new link."
      />
      <p v-if="textLine" class="text-xs text-ink-secondary">{{ textLine }}</p>
    </template>

    <ApplicantTextsStatus :driver-id="driverId" :can-manage="canSend" />

    <BaseButton v-if="canSend" size="sm" :variant="result || sentAt ? 'secondary' : 'primary'"
      :disabled="send.isPending.value" @click="press">
      {{ send.isPending.value ? "Sending…" : result || sentAt ? "Send again" : "Send the application" }}
    </BaseButton>
    <p v-else class="text-xs text-ink-muted">Somebody who manages recruitment sends the application.</p>
  </section>
</template>
