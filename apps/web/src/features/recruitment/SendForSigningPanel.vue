<script setup lang="ts">
import { computed, ref, toRef, watch } from "vue";
import { AppButton as BaseButton, AppCallout } from "@silvicom/ui";
import {
  OPEN_SIGNING_WARNS_ON,
  SIGN_LINK_LIFETIME_HOURS,
  SIGN_LINK_UNLOCK_LIMIT,
  hiringStep,
  type SigningSent,
} from "@silvicom/shared";
import { formatDate, formatDateTime } from "@/lib/format";
import type { RenderedDocument } from "@/lib/documentDownload";
import DocumentPreview from "@/components/DocumentPreview.vue";
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
 *
 * ── THE ENVELOPE, PREVIEWED BEFORE IT GOES (D-AW17, C3s5) ─────────────────────────────────────
 * *"We can review these documents prefilled."* The two documents the envelope carries (D-AW16) — the
 * carrier's packet and the driver handbook — open here, on the row the office sends them from, drawn by
 * the same renderers the driver signs (`preview.ts`, `handbookPreview.ts`) under a DRAFT band. Any role
 * that can read the applicant can read them; only sending is `recruitment: manage`.
 */
const props = defineProps<{ invitationId: string; driverId: string }>();

const session = useSessionStore();
const toast = useToastStore();
const send = useSendForSigning();
const checklistQ = useApplicantChecklistQuery(toRef(props, "driverId"));
const invitesQ = useApplicationInvitesQuery(toRef(props, "driverId"));

const invite = computed(() => invitesQ.data.value?.find((i) => i.id === props.invitationId) ?? null);
// SP5: the org's answer (the `sections` claim), which is what the route's `requireSection` reads.
const canSend = computed(() => session.can("recruitment"));
const result = ref<SigningSent | null>(null);

/**
 * Where the last send stands, from the invitation. Both stamps, since C3s3a writes the end before it
 * opens: an end with no opening is a send that failed half-way, and nothing was sent. (A `legacy` state
 * for links opened on a screen before C3s3a went in M2a, §8.6 item 4 — production had none.)
 */
const lastSend = computed<"none" | "live" | "ran_out" | "stopped">(() => {
  const inv = invite.value;
  if (!inv?.signing_opened_at || !inv.sign_link_expires_at) return "none";
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

/** Which of the envelope's two documents is open in the viewer, if either. */
const previewing = ref<"packet" | "handbook" | null>(null);
const previewDocument = computed<RenderedDocument | null>(() => {
  if (previewing.value === "packet") {
    return { path: `/api/recruitment/applications/${encodeURIComponent(props.invitationId)}/preview.pdf`, filename: "application-preview.pdf" };
  }
  if (previewing.value === "handbook") {
    return {
      path: `/api/recruitment/applicants/${encodeURIComponent(props.driverId)}/handbook/preview.pdf`,
      filename: "handbook-preview.pdf",
      source: "the carrier's handbook and the applicant's name on file",
    };
  }
  return null;
});

// The drawer swaps applicants without unmounting; one applicant's answer, or their document, must never
// greet the next.
watch(() => props.invitationId, () => {
  result.value = null;
  previewing.value = null;
});

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

      <div class="flex flex-wrap gap-2">
        <BaseButton size="sm" variant="ghost" @click="previewing = 'packet'">Preview the application</BaseButton>
        <BaseButton size="sm" variant="ghost" @click="previewing = 'handbook'">Preview the handbook</BaseButton>
      </div>

      <BaseButton v-if="canSend" size="sm" :variant="result || lastSend !== 'none' ? 'secondary' : 'primary'"
        :disabled="send.isPending.value" @click="press">
        {{ send.isPending.value ? "Sending…" : result || lastSend !== "none" ? "Send again" : "Send for signing" }}
      </BaseButton>
      <p v-else class="text-xs text-ink-muted">Somebody who manages recruitment sends it for signing.</p>
    </template>

    <!-- ⚠ Nested in this drawer body, never a sibling of the drawer: HeadlessUI gives Escape to the
         topmost dialog in the DOM tree, and a sibling viewer's Escape would close the applicant record
         too (B8; `AuthorizationsPanel` measured it). -->
    <DocumentPreview
      :open="previewDocument !== null"
      :label="previewing === 'handbook' ? 'Driver handbook, before signing' : 'Application, before signing'"
      :rendered="previewDocument"
      @close="previewing = null"
    />
  </section>
</template>
