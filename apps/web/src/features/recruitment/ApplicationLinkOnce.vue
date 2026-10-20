<script setup lang="ts">
import { computed } from "vue";
import type { ApplicationInviteTextOutcome } from "@silvicom/shared";
import { AppButton as BaseButton } from "@silvicom/ui";
import { formatDateTime } from "@/lib/format";
import { useToastStore } from "@/stores/toast";
import type { ApplicationInviteDelivery } from "@/features/recruitment/useApplicationInvites";

/**
 * The one moment an application token exists outside the applicant's inbox (H5b, U1).
 *
 * The server stores a SHA-256 and nothing else, so there is no re-read and no resend that recovers
 * this string. Extracted from `ApplicationInviteCard` when U1 gave the invitation a second birthplace
 * on the applicant board: two copies of a "we cannot show you this again" promise is exactly the
 * wording that drifts, and a recruiter who reads the softer of the two loses a link believing it can
 * be fetched back.
 */
const props = defineProps<{
  link: string;
  delivery?: ApplicationInviteDelivery | null;
  /** Q-AW55: what became of the invitation by text, when one was asked for. */
  text?: ApplicationInviteTextOutcome | null;
  /**
   * What to do if it is lost. An invitation's link is replaced by a new invitation; a SENT
   * application's is replaced by sending it again (AF4), which rotates the link on the same row.
   */
  ifLost?: string;
  /**
   * The line above a link that was NOT emailed. AF5's sign link is the one that must not be sent on
   * (D-AF3: it signs the packet, and signing happens in the office), so "send this link to the
   * applicant" would be exactly the wrong instruction.
   */
  heading?: string;
}>();

const toast = useToastStore();

/**
 * What to say ABOVE the link, which is the only thing the send changed here.
 *
 * The link is still shown, still copyable and still shown once, whatever happened to the email — the
 * recruiter's next action does not depend on it. What does depend on it is whether they need to take
 * that action at all, and the three failures are three different people's problems: no address is the
 * recruiter's (they left the field blank), `mail_disabled` is an admin's (the org has no mail
 * provider), and `send_failed` is the applicant's address. Saying "could not send" to all three sends
 * somebody to the wrong person.
 */
const headline = computed((): string => {
  const d = props.delivery;
  if (!d) return props.heading ?? "Send this link to the applicant";
  if (d.sent) return `Emailed to ${d.email}`;
  switch (d.reason) {
    case "no_address":
      return "No email address was given — send this link yourself";
    case "mail_disabled":
      return "Email is switched off for this account — send this link yourself";
    default:
      return `Could not email ${d.email} — send this link yourself`;
  }
});

/**
 * The text's line (Q-AW55), one sentence, and the same division of blame as the email's: `queued` is
 * nobody's problem and says when; `number_stopped` is the applicant's own earlier word, which the office
 * may not overrule; `invalid_phone` is the recruiter's typing; `sms_disabled` is an admin's; the rest is
 * the provider. "Send this link yourself" is said only where the text is NOT coming.
 */
const textLine = computed((): string | null => {
  const t = props.text;
  if (!t) return null;
  const to = t.phoneLast4 ? `the number ending ${t.phoneLast4}` : "that number";
  if (t.outcome === "sent") return `Texted to ${to}.`;
  if (t.outcome === "queued") {
    return `It is outside texting hours somewhere in the US, so it will be texted to ${to} at ${t.notBefore ? formatDateTime(t.notBefore) : "the next opening"}.`;
  }
  switch (t.reason) {
    case "number_stopped":
      return `Not texted: ${to} texted STOP to us, and the office cannot undo that. Send the link yourself.`;
    case "invalid_phone":
      return "Not texted: that is not a US mobile number. Send the link yourself.";
    case "sms_consent_not_final":
      return "Not texted: texts are not available yet — the wording is waiting on legal review. Send the link yourself.";
    case "sms_disabled":
      return "Not texted: texts are switched off for this account. Send the link yourself.";
    default:
      return `The text to ${to} did not go. Send the link yourself.`;
  }
});

async function copyLink(link: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(link);
    toast.success("Link copied");
  } catch {
    // Clipboard access is refused in some browsers and contexts; the link is on screen either way.
    toast.error("Could not copy", "Select the link and copy it manually.");
  }
}
</script>

<template>
  <div class="rounded-surface bg-surface-muted p-3">
    <p class="text-xs font-medium text-ink-secondary">{{ headline }}</p>
    <p v-if="textLine" class="mt-1 text-xs text-ink-secondary">{{ textLine }}</p>
    <p class="mt-1 break-all font-mono text-xs text-ink">{{ link }}</p>
    <div class="mt-3 flex items-center gap-3">
      <BaseButton size="sm" @click="copyLink(link)">Copy the link</BaseButton>
      <p class="text-xs text-ink-muted">
        <template v-if="delivery?.sent">Their copy is in the email. </template>It is shown once here.
        We keep only a fingerprint of it, so it cannot be shown again —
        {{ ifLost ?? "create a new invitation if it is lost." }}
      </p>
    </div>
  </div>
</template>
