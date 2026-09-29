<script setup lang="ts">
import { computed, ref, toRef, watch } from "vue";
import { AppButton as BaseButton, AppCallout } from "@silvicom/ui";
import {
  OPEN_SIGNING_WARNS_ON,
  SIGN_LINK_LIFETIME_HOURS,
  SIGN_LINK_UNLOCK_LIMIT,
  hiringStep,
  rolesThatManage,
  type SigningSent,
} from "@silvicom/shared";
import { formatDate, formatDateTime } from "@/lib/format";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import ApplicantTextsStatus from "@/features/recruitment/ApplicantTextsStatus.vue";
import { useApplicantChecklistQuery } from "@/features/recruitment/useApplicantChecklist";
import { useApplicationInvitesQuery } from "@/features/recruitment/useApplicationInvites";
import { useSendForSigning } from "@/features/recruitment/useSendForSigning";

/**
 * "Send for signing" — the office's act at the desk, to the applicant's own phone (D-AW14, C3s3a).
 *
 * ── WHAT IT REPLACED ──────────────────────────────────────────────────────────────────────────
 * AF5's "Open signing on this screen" opened the sign link in a new tab on the office's computer and
 * handed the screen over (D-AF3). The owner's model moved the signing onto the driver's phone, so the
 * link now goes by email, and by text where they agreed, and the office never sees it: this panel says
 * WHERE it went, how long it works, and — the one remedy for every failure — "Send again".
 *
 * ── IT SAYS WHAT IS OUTSTANDING BEFORE THE PRESS, AND SENDS ANYWAY (D-AF6) ─────────────────────
 * Read from the SAME checklist query the page shows (`OPEN_SIGNING_WARNS_ON`), replaced by the server's
 * own reading once pressed.
 *
 * ⚠ The resting sentence reads the invitation, not this panel's memory, so an office that reloads, or
 * a colleague at another desk, sees the same thing: a live link and its end, a link that ran out, or
 * one that stopped after five wrong dates of birth.
 */
const props = defineProps<{ invitationId: string; driverId: string }>();

const session = useSessionStore();
const toast = useToastStore();
const send = useSendForSigning();
const checklistQ = useApplicantChecklistQuery(toRef(props, "driverId"));
const invitesQ = useApplicationInvitesQuery(toRef(props, "driverId"));

const invite = computed(() => invitesQ.data.value?.find((i) => i.id === props.invitationId) ?? null);
const canSend = computed(() => Boolean(session.role) && rolesThatManage("recruitment").includes(session.role!));
const result = ref<SigningSent | null>(null);

/** Where the last send stands, from the invitation. `legacy`: opened on a screen before C3s3a, never sent. */
const lastSend = computed<"none" | "legacy" | "live" | "ran_out" | "stopped">(() => {
  const inv = invite.value;
  if (!inv?.signing_opened_at) return "none";
  if (!inv.sign_link_expires_at) return "legacy";
  if ((inv.unlock_failures ?? 0) >= SIGN_LINK_UNLOCK_LIMIT) return "stopped";
  return Date.parse(inv.sign_link_expires_at) <= Date.now() ? "ran_out" : "live";
});

const outstanding = computed(() =>
  (checklistQ.data.value?.steps ?? [])
    .filter((s) => OPEN_SIGNING_WARNS_ON.includes(s.key) && s.state !== "done")
    .map((s) => s.label),
);
const warnedAfter = computed(() => (result.value?.warnings ?? []).map((k) => hiringStep(k).label));

/** What became of the email, in one sentence. */
const emailLine = computed(() => {
  const email = result.value?.email;
  if (!email) return null;
  if (email.sent) return `Emailed to ${email.email}.`;
  if (email.reason === "no_address") return "Not emailed: this application has no email address.";
  if (email.reason === "mail_disabled") return "Not emailed: email is not set up for this account.";
  return "The email did not go through.";
});

/**
 * What became of the text. Nothing for an applicant who never agreed — the status line below says so,
 * and "not texted" beside it would read as a fault.
 */
const textLine = computed(() => {
  const text = result.value?.text;
  if (!text || text.state === "held") return null;
  if (text.state === "sent") return "Also texted to the applicant.";
  if (text.state === "queued") return `It is night where the applicant lives, so it will be texted to them at ${formatDateTime(text.notBefore)}.`;
  return "The text did not go through.";
});

/** Neither went: the office must know now, while the applicant is still at the desk. */
const reachedNobody = computed(() => {
  const r = result.value;
  return r !== null && !r.email.sent && r.text.state !== "sent" && r.text.state !== "queued";
});

// The drawer swaps applicants without unmounting; one applicant's answer must never greet the next.
watch(() => props.invitationId, () => { result.value = null; });

async function press(): Promise<void> {
  try {
    result.value = await send.mutateAsync({ invitationId: props.invitationId, driverId: props.driverId });
  } catch (e) {
    toast.error("Could not send it for signing", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <section class="space-y-3">
    <p v-if="invite?.submitted_at" class="text-xs text-ink-secondary">
      Signed and filed {{ formatDate(invite.submitted_at) }}.
    </p>
    <p v-else-if="!invite?.approved_at" class="text-xs text-ink-secondary">
      The applicant signs the packet on their own phone while they are in the office. Approve the
      application first; send it for signing once they are here.
    </p>
    <template v-else>
      <template v-if="!result">
        <p v-if="lastSend === 'live'" class="text-xs text-ink-secondary">
          Sent. The link works until {{ formatDateTime(invite.sign_link_expires_at!) }}. Sending again makes
          a new link, and the one before stops working.
        </p>
        <p v-else-if="lastSend === 'ran_out'" class="text-xs text-ink-secondary">
          The last link ran out {{ formatDateTime(invite.sign_link_expires_at!) }}. Send again for a new one.
        </p>
        <AppCallout v-else-if="lastSend === 'stopped'" tone="caution">
          The last link stopped after {{ SIGN_LINK_UNLOCK_LIMIT }} wrong dates of birth. Check it is the
          applicant holding the phone, then send again.
        </AppCallout>
        <p v-else-if="lastSend === 'legacy'" class="text-xs text-ink-secondary">
          Opened on this screen {{ formatDate(invite.signing_opened_at!) }}. Signing now happens on the
          applicant's phone: send it to them.
        </p>
        <p v-else class="text-xs text-ink-secondary">
          Approved. When the applicant is here, send it to their phone. The link works for
          {{ SIGN_LINK_LIFETIME_HOURS }} hours.
        </p>
      </template>

      <AppCallout v-if="!result && outstanding.length > 0" tone="caution">
        Still outstanding: {{ outstanding.join(", ") }}. You can send it for signing now; these stay on the
        checklist.
      </AppCallout>

      <template v-if="result">
        <AppCallout v-if="warnedAfter.length > 0" tone="caution">
          Sent with these still outstanding: {{ warnedAfter.join(", ") }}.
        </AppCallout>
        <AppCallout v-if="reachedNobody" tone="caution">
          The link did not reach the applicant. Correct their email address, or ask them to agree to texts on
          their phone, then send again.
        </AppCallout>
        <p v-if="emailLine" class="text-xs text-ink-secondary">{{ emailLine }}</p>
        <p v-if="textLine" class="text-xs text-ink-secondary">{{ textLine }}</p>
        <p class="text-xs text-ink-secondary">
          The link works until {{ formatDateTime(result.signLinkExpiresAt) }}.
        </p>
      </template>

      <ApplicantTextsStatus :driver-id="driverId" :can-manage="canSend" />

      <BaseButton v-if="canSend" size="sm" :variant="result || lastSend !== 'none' ? 'secondary' : 'primary'"
        :disabled="send.isPending.value" @click="press">
        {{ send.isPending.value ? "Sending…" : result || lastSend !== "none" ? "Send again" : "Send for signing" }}
      </BaseButton>
      <p v-else class="text-xs text-ink-muted">Somebody who manages recruitment sends it for signing.</p>
    </template>
  </section>
</template>
