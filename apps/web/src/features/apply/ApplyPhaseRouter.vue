<script setup lang="ts">
import { AppCard as BaseCard } from "@silvicom/ui";
import ApplicationFiledCard from "@/features/apply/ApplicationFiledCard.vue";
import DraftUnlockGate from "@/features/apply/DraftUnlockGate.vue";
import EsignConsentGate from "@/features/apply/EsignConsentGate.vue";
import IdentityFields from "@/features/apply/IdentityFields.vue";
import ApplyWaitScreen from "@/features/apply/ApplyWaitScreen.vue";
import SigningCeremony from "@/features/apply/signing/SigningCeremony.vue";
import SignOffScreen from "@/features/apply/SignOffScreen.vue";
import ApplyExpectations from "@/features/apply/ApplyExpectations.vue";
import type { ApplicationDraft } from "@/features/apply/draft";
import type {
  ApplyEsignConsent,
  ApplyPacketStop,
  ApplyRelease,
  useApplyInvitationQuery,
} from "@/features/apply/useApplication";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * Which screen an application link is on — the phase chain `ApplyPage.vue` used to hold inline.
 *
 * ⚠ **Split out of `ApplyPage.vue` on 2026-09-26 (APPLICATION-FLOW-V2-PLAN §8.5, C1)**, at the page's
 * 450-line warning, and it DECIDES nothing. Every condition below is a value the page computed and
 * passes in, and every act a screen reports is emitted straight back for the page to perform — the
 * state (the draft, the consent, the ceremony, the unlock) stays where it was, so nothing about
 * setup order or reactivity moved. What moved is the ORDER of the `v-if` chain, which is the thing
 * the sections below are about. The form itself is the default slot, rendered in the page's own
 * scope, in the chain's last branch exactly where it stood.
 *
 * ⚠ `draft` is a `defineModel` passed through to `SignOffScreen`, the way `SignOffScreen` passes it to
 * its own fields: the same reactive object, mutated in place, never replaced.
 *
 * ── AND WHAT IT INVOLVES IS SAID BEFORE ANY OF IT IS ASKED (B7) ───────────────────────────────
 * An untouched link opens on how long this takes and what to have to hand, because the alternative is
 * that a driver finds out by walking it. It asks and writes nothing, which is why it can sit ahead of
 * the consent without disturbing the rule below — see `ApplyExpectations.vue`.
 *
 * ── NOTHING HAPPENS BEFORE THE 7001(c) CONSENT (A4) ───────────────────────────────────────────
 * §390.32(d) makes an electronic §391.21 application conditional on including proof that the driver
 * agreed to transact electronically, so that agreement is the first screen. While the wording is
 * still draft nothing is asked and the link behaves as it did before — the server says which, and
 * the page does not decide it for itself.
 *
 * ── THE AUTHORIZATIONS ARE SIGNED BEFORE THE FORM, NOT AFTER (A5, D-APP4) ─────────────────────
 * §391.21(b)'s certification is the LAST act of an application, and submitting is what makes the
 * application exist — so anything that has to happen with it has to happen before it. The order on
 * this page is therefore: consent → identity (AF3, D-AF1) → the permissions → the form → certify.
 *
 * While any instrument is still draft wording the ceremony is skipped entirely and the instruments
 * are shown read-only on the last screen, as they were before A5 — the server refuses those
 * signatures (Q-H3), and a ceremony nobody can complete would be a wall across the application.
 */
defineProps<{
  token: string;
  invitation: ReturnType<typeof useApplyInvitationQuery>;
  submitted: boolean;
  awaitingReview: boolean;
  expectationsNeeded: boolean;
  ceremonyAvailable: boolean;
  esignConsent: ApplyEsignConsent | null;
  consentNeeded: boolean;
  consenting: boolean;
  consentFailed: boolean;
  identityNeeded: boolean;
  ceremonyNeeded: boolean;
  releases: ApplyRelease[];
  waitingForApplication: boolean;
  awaitingOffice: boolean;
  locked: boolean;
  awaitingSignature: boolean;
  packetStops: ApplyPacketStop[];
  packetAdopted: { signature: string | null; initials: string | null } | null;
  sending: boolean;
  sendError: string | null;
}>();
const draft = defineModel<ApplicationDraft>("draft", { required: true });
const emit = defineEmits<{
  begin: [];
  agree: [];
  identityRecorded: [];
  ceremonyDone: [];
  unlocked: [payload: Record<string, unknown>];
  send: [];
}>();
</script>

<template>
  <div v-if="invitation.isLoading.value" class="text-sm text-ink-muted">{{ APPLY_COPY.page.opening }}</div>

  <!-- Every dead link answers identically by design; the page repeats what it was told and offers
       the only action that can help, which is to ask the carrier for a new link. -->
  <BaseCard v-else-if="invitation.isError.value">
    <h1 class="text-lg font-semibold text-ink">{{ APPLY_COPY.dead.heading }}</h1>
    <p class="mt-2 text-sm text-ink-muted">{{ APPLY_COPY.dead.body }}</p>
  </BaseCard>

  <!-- What happened, not what will (A1). The old copy promised signing that this page could not
       deliver — submitting killed the link the promise was made on — and D-APP4 moves the signing
       ahead of the certification, so there is no longer a later step to promise. -->
  <ApplicationFiledCard
    v-else-if="submitted"
    :token="token"
    :carrier="invitation.data.value?.carrier ?? ''"
    :road-test-certificate="invitation.data.value?.roadTestCertificate ?? null"
    :handbook="invitation.data.value?.handbook ?? null"
  />

  <!-- F4/D-AX11: handed over, and not yet approved. The driver has done everything they can do for
       the moment, and the screen says so rather than leaving them on a form with a spent button. -->
  <BaseCard v-else-if="awaitingReview">
    <ApplyWaitScreen :token="token" :carrier="invitation.data.value?.carrier ?? ''" :heading="APPLY_COPY.handoff.waitingHeading" :note="APPLY_COPY.handoff.waitingNote"
      :body="APPLY_COPY.handoff.waitingBody(invitation.data.value?.carrier ?? '')" />
  </BaseCard>

  <!-- B7. ⚠ Ahead of the consent gate below, and this does not disturb D-APP5: A4's ruling is that
       nothing is ASKED and nothing is WRITTEN before the 7001(c) consent, and this screen does
       neither. `signFirst` covers both things signed before the form — the consent and the ceremony
       flip together, because both are gated on the same wording being published. -->
  <BaseCard v-else-if="expectationsNeeded">
    <ApplyExpectations
      :carrier="invitation.data.value?.carrier ?? ''"
      :sign-first="ceremonyAvailable || Boolean(esignConsent?.required)"
      @start="emit('begin')"
    />
  </BaseCard>

  <!-- A4/D-APP5: §390.32(d) requires proof of 15 U.S.C. 7001(c) consent behind an electronic
       §391.21 application, so this is the first thing on the link and nothing writes before it. -->
  <BaseCard v-else-if="consentNeeded && esignConsent">
    <EsignConsentGate
      :consent="esignConsent"
      :carrier="invitation.data.value?.carrier ?? ''"
      :working="consenting"
      :failed="consentFailed"
      @agree="emit('agree')"
    />
  </BaseCard>

  <BaseCard v-else-if="identityNeeded">
    <IdentityFields :token="token" :carrier="invitation.data.value?.carrier ?? ''"
      :captures="invitation.data.value?.captures ?? []" @done="emit('identityRecorded')" />
  </BaseCard>

  <!-- A5/D-APP7: one instrument per screen, one act each. FCRA §604(b)(2) requires each
       disclosure to stand alone, so there is nothing else on screen while one is showing. -->
  <BaseCard v-else-if="ceremonyNeeded">
    <SigningCeremony
      :token="token"
      :releases="releases"
      :already-signed="invitation.data.value?.releasesSigned ?? []"
      :carrier="invitation.data.value?.carrier ?? ''"
      :captures="invitation.data.value?.captures ?? []"
      @done="emit('ceremonyDone')"
    />
  </BaseCard>

  <!-- AF4 (plan §3.1 row 5): permissions in, form not sent. Before the unlock gate: nothing is shown. -->
  <BaseCard v-else-if="waitingForApplication">
    <ApplyWaitScreen :token="token" :carrier="invitation.data.value?.carrier ?? ''" :heading="APPLY_COPY.permissionsReceived.heading" :note="APPLY_COPY.permissionsReceived.note"
      :body="APPLY_COPY.permissionsReceived.body(invitation.data.value?.carrier ?? '')" />
  </BaseCard>

  <!-- AF5 (plan §3.1 row 9): approved, and signing happens in the office. Before the unlock gate: it
       prints nothing of the application. -->
  <BaseCard v-else-if="awaitingOffice">
    <ApplyWaitScreen :token="token" :carrier="invitation.data.value?.carrier ?? ''" :heading="APPLY_COPY.signInOffice.heading" :note="APPLY_COPY.signInOffice.note"
      :body="APPLY_COPY.signInOffice.body(invitation.data.value?.carrier ?? '')" />
  </BaseCard>

  <!-- A2/D-APP16: the draft holds a date of birth, so the bare link does not read it back. One
       question, asked only when there is something to protect. -->
  <DraftUnlockGate
    v-else-if="locked"
    :token="token"
    :carrier="invitation.data.value?.carrier ?? ''"
    @unlocked="emit('unlocked', $event)"
  />

  <!-- F4/D-AX12: approved, and waiting for the signature. ⚠ After the date-of-birth gate above, not
       before it: this screen prints the whole application, and D-APP16 exists because an application
       link is forwarded in email and read on a shared phone. -->
  <BaseCard v-else-if="awaitingSignature">
    <SignOffScreen
      v-model="draft"
      :token="token"
      :carrier="invitation.data.value?.carrier ?? ''"
      :edits="invitation.data.value?.edits ?? []"
      :captures="invitation.data.value?.captures ?? []"
      :stops="packetStops"
      :adopted-marks="packetAdopted"
      :sending="sending"
      :error="sendError"
      @send="emit('send')"
    />
  </BaseCard>

  <!-- The form itself — the chain's last branch, rendered in the page's scope (see the header). -->
  <template v-else-if="invitation.data.value">
    <slot />
  </template>
</template>
