<script setup lang="ts">
import { computed, ref, toRef, watch } from "vue";
import { AppButton as BaseButton, AppCallout } from "@silvicom/ui";
import { APPLICATION_SEND_WARNS_ON, hiringStep, rolesThatManage } from "@silvicom/shared";
import { formatDate } from "@/lib/format";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import ApplicationLinkOnce from "@/features/recruitment/ApplicationLinkOnce.vue";
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
 * SMS cannot carry it (memo Q12) and the sending address is a personal one until the owner's arrives,
 * so the screen is the delivery path that always works: `ApplicationLinkOnce` shows it once, with
 * copy, exactly as it does for the invitation.
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

const canSend = computed(() => Boolean(session.role) && rolesThatManage("recruitment").includes(session.role!));
const result = ref<ApplicationSent | null>(null);

/** The screening steps not done yet, in the checklist's own words. */
const outstanding = computed(() => {
  const steps = checklistQ.data.value?.steps ?? [];
  return steps
    .filter((s) => APPLICATION_SEND_WARNS_ON.includes(s.key) && s.state !== "done")
    .map((s) => s.label);
});
const warnedAfter = computed(() => (result.value?.warnings ?? []).map((k) => hiringStep(k).label));

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
    </template>

    <BaseButton v-if="canSend" size="sm" :variant="result || sentAt ? 'secondary' : 'primary'"
      :disabled="send.isPending.value" @click="press">
      {{ send.isPending.value ? "Sending…" : result || sentAt ? "Send again" : "Send the application" }}
    </BaseButton>
    <p v-else class="text-xs text-ink-muted">Somebody who manages recruitment sends the application.</p>
  </section>
</template>
