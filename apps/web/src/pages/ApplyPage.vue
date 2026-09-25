<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import {
  AppButton as BaseButton,
  AppCallout,
  AppCard as BaseCard,
} from "@silvicom/ui";
import ApplicantDetailsFields from "@/features/apply/ApplicantDetailsFields.vue";
import AddressHistoryFields from "@/features/apply/AddressHistoryFields.vue";
import LicenceFields from "@/features/apply/LicenceFields.vue";
import ApplyEmploymentFields from "@/features/apply/ApplyEmploymentFields.vue";
import SafetyHistoryFields from "@/features/apply/SafetyHistoryFields.vue";
import QuestionnaireFields from "@/features/apply/QuestionnaireFields.vue";
import DocumentCaptureFields from "@/features/apply/DocumentCaptureFields.vue";
import ReviewFields from "@/features/apply/ReviewFields.vue";
import ApplicationFiledCard from "@/features/apply/ApplicationFiledCard.vue";
import DraftUnlockGate from "@/features/apply/DraftUnlockGate.vue";
import DisclosurePanel from "@/features/apply/DisclosurePanel.vue";
import EsignConsentGate from "@/features/apply/EsignConsentGate.vue";
import IdentityFields from "@/features/apply/IdentityFields.vue";
import ApplyWaitScreen from "@/features/apply/ApplyWaitScreen.vue";
import SigningCeremony from "@/features/apply/signing/SigningCeremony.vue";
import SignOffScreen from "@/features/apply/SignOffScreen.vue";
import ApplyExpectations from "@/features/apply/ApplyExpectations.vue";
import ApplyProgress from "@/features/apply/ApplyProgress.vue";
import ApplyIssueList from "@/features/apply/ApplyIssueList.vue";
import { emptyDraft, fromDraftPayload, type ApplicationDraft } from "@/features/apply/draft";
import { linkHasBeenUsed, useApplyInvitationQuery } from "@/features/apply/useApplication";
import { useEsignConsentStep } from "@/features/apply/useEsignConsentStep";
import { draftStatusLabel, useApplicationDraft } from "@/features/apply/useApplicationDraft";
import { useApplicationSending } from "@/features/apply/useApplicationSending";
import { useApplicationWizard, type SectionIssue } from "@/features/apply/useApplicationWizard";
import { provideApplyIssues } from "@/features/apply/issues";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * The driver's own §391.21 application (H5b, a wizard since A3).
 *
 * ── THIS PAGE HAS NO SESSION, AND NOTHING ON IT MAY ASSUME ONE ─────────────────────────────────
 * No session store, no `apiFetch`, no toasts from the app shell — an applicant is not a user, and a
 * recruiter signed in on the same browser must not have their identity ride along. Feedback is
 * inline here rather than a toast for the same reason the rest of the app uses toasts: this is a
 * single-purpose page where the result IS the page, not an action inside a workspace.
 *
 * ── ONE SCREEN AT A TIME, BECAUSE OF WHERE IT IS FILLED IN ────────────────────────────────────
 * Roughly nine in ten of these are completed on a phone. The whole document on one page is a scroll
 * a driver abandons; the wizard shows one §391.21(b) paragraph at a time, saves after each, and puts
 * the whole thing back in front of them at `review` before they certify it — because (b)(12) has
 * them swear the entries are true and complete, and nobody can swear to what they cannot see.
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
 *
 * ── THE PHOTOGRAPHS ARE STAGED, NOT SAVED (A8, D-APP10) ───────────────────────────────────────
 * The documents screen writes to `application_captures` against the invitation, not into the draft:
 * a photograph is not an answer, and a candidate who never sends this application must leave nothing
 * in an evidence bucket. The submit transaction is what promotes them into the qualification file.
 *
 * ── IT SAVES ITSELF, AND SOMETIMES ASKS WHO IS READING (A2) ───────────────────────────────────
 * Coming back to a draft that already holds a date of birth costs one question — the date of birth
 * itself (D-APP16) — because the link is a session and A10 will re-send it by email, and an email is
 * forwarded and a phone is shared.
 *
 * ── VALIDATION IS THE SERVER'S SCHEMA, RUN LOCALLY ─────────────────────────────────────────────
 * `driverApplicationObject` is the same object the API validates with, picked one section at a time
 * (`useApplicationWizard`). Running it here turns a 400 into an inline list of what is missing, and
 * guarantees the two can never disagree about what §391.21 requires.
 */
const route = useRoute();
const emit = defineEmits<{ carrier: [string | null]; wide: [boolean] }>();
const token = computed(() => String(route.params.token ?? ""));

const invitation = useApplyInvitationQuery(token);

// The layout's header shows the carrier's name once the link resolves.
watch(() => invitation.data.value?.carrier, (name) => emit("carrier", name ?? null), { immediate: true });

const draft = reactive<ApplicationDraft>(emptyDraft());

/**
 * Submitted is a fact about the link, not about this browser tab (D-APP1). Before 0225 it could only
 * ever be local state, because submitting killed the token and a reopened link answered "not valid".
 */
const submitted = computed(() => justSent.value || Boolean(invitation.data.value?.phases?.submittedAt));

/**
 * The two states the OFFICE puts the link into (F4, D-AX11).
 *
 * ⚠ Read in this order — the LAST thing that happened wins. Reading forwards ("has it been sent for
 * review?") answers with the first box ticked and gets every later state wrong, which is the classic
 * shape of this bug: an approved application has `reviewRequestedAt` set too, and is not waiting.
 */
const approved = computed(() => !submitted.value && Boolean(invitation.data.value?.phases?.approvedAt));
// AF5/D-AF3: approved, and signing not yet opened in the office. Only an explicit null counts — see
// `ApplyPhases.signingOpenedAt` — so a page meeting an API from before AF5 still signs on approval.
const awaitingOffice = computed(() => approved.value && invitation.data.value?.phases?.signingOpenedAt === null);
const awaitingSignature = computed(() => approved.value && !awaitingOffice.value);
const awaitingReview = computed(
  () =>
    !submitted.value
    && !approved.value
    && (handedOver.value || Boolean(invitation.data.value?.phases?.reviewRequestedAt)),
);

/**
 * The carrier's own packet, stop by stop (P5, D-PKT6), as the server served it.
 *
 * Passed through and not interpreted here: whether the walk is finished, and what holds the Send
 * button, belong to `SignOffScreen` — the only phase in which either question can be asked. ⚠ Empty
 * for a page loaded against an API older than 0339, which is what lets that screen tell "no packet
 * to walk" apart from "a packet nobody has walked yet".
 */
const packetStops = computed(() => invitation.data.value?.packet ?? []);
/** Q-PKT9: what this link already adopted, so a resumed walk does not ask the driver to retype it. */
const packetAdopted = computed(() => invitation.data.value?.packetAdopted ?? null);


// ── Resuming (A2) ─────────────────────────────────────────────────────────────────────────────
const released = ref<Record<string, unknown> | null>(null);
const locked = computed(() => Boolean(invitation.data.value?.draft?.locked) && released.value === null);
const restored = ref(false);
const autosaveEnabled = ref(false);
const furthestSection = ref<string | null>(null);

const wizard = useApplicationWizard(draft, furthestSection);
/**
 * The two acts that end an application, and the validation in front of each (`useApplicationSending`).
 * It takes the wizard because a refused document has to land on the screen that owns the field.
 */
const { sendError, justSent, handedOver, sending, handingOver, sendForReview, send } =
  useApplicationSending(token, draft, wizard);
/**
 * Every control on every screen reads this to mark itself (D-AX3). Provided once here rather than
 * threaded through seven components as a prop — see `issues.ts` for why.
 */
provideApplyIssues(wizard.issues);

/**
 * Take the driver to the field an entry in the summary is about.
 *
 * The summary at the Send button can name a field on any of the nine screens, so this may have to
 * change screen first — and `keepIssues` is what stops the list it was clicked from disappearing on
 * the way. `nextTick` because the control does not exist in the DOM until the new screen renders.
 */
async function showIssue(issue: SectionIssue): Promise<void> {
  if (issue.section && issue.section !== wizard.section.value) {
    wizard.goTo(issue.section, true);
    await nextTick();
  }
  wizard.focusIssue(issue);
}

watch(
  [() => invitation.data.value, released],
  ([inv, body]) => {
    if (!inv || restored.value) return;
    // Still gated: nothing to restore and nothing to save over. Autosave stays off, so a stranger
    // holding the link cannot overwrite the draft they are not allowed to read.
    if (inv.draft?.locked && !body) return;
    const payload = body ?? inv.draft?.payload ?? null;
    if (payload) Object.assign(draft, fromDraftPayload(payload));
    furthestSection.value = inv.draft?.furthestSection ?? null;
    wizard.resume();
    restored.value = true;
    // Next tick, so the restore assignment above does not itself schedule a save of what we just
    // loaded back to the server.
    void nextTick(() => { autosaveEnabled.value = true; });
  },
  { immediate: true },
);

const autosave = useApplicationDraft(token, draft, {
  // Never before the consent: the server refuses those writes, and a "Not saved" banner on a screen
  // the driver has not been allowed to reach yet would be a lie about their signal.
  enabled: computed(
    () => autosaveEnabled.value && !consentNeeded.value && !ceremonyNeeded.value && !waitingForApplication.value,
  ),
  section: computed(() => wizard.furthestSection.value),
});
const saveStatus = computed(() => draftStatusLabel(autosave.state.value));

// ── What it involves, before any of it is asked (B7) ──────────────────────────────────────────
// Shown to somebody who has not started, and nothing about that is remembered: "has this driver read
// it?" is not worth a column or a write on an unauthenticated route, and `linkHasBeenUsed` answers it
// from what the link already returns.
const begun = ref(false);
const expectationsNeeded = computed(() => !begun.value && !linkHasBeenUsed(invitation.data.value));

// ── The 7001(c) consent (A4) — its state and its act live in `useEsignConsentStep` ──────────────
const { consenting, consentFailed, esignConsent, consentNeeded, agree } =
  useEsignConsentStep(token, invitation.data);

/**
 * Is the carrier's wording still draft? (2026-08-23.)
 *
 * ⚠ **This is a mirror of a server rule, and it must stay a mirror.** `submitApplication` refuses
 * while any of the six instruments the applicant's path touches is unreviewed — that refusal is the
 * guarantee, and this is only the courtesy that stops a driver filling seven screens on a phone
 * before meeting it. Read from the payload the link already returns (`esignConsent.draft` and each
 * release's `draft`), so there is no second source of truth and no new endpoint.
 */
const wordingNotFinal = computed(() => {
  const inv = invitation.data.value;
  if (!inv) return false;
  return Boolean(inv.esignConsent?.draft) || inv.releases.some((r) => r.draft);
});

// ── The signing ceremony (A5) ─────────────────────────────────────────────────────────────────
const ceremonyDone = ref(false);
const releases = computed(() => invitation.data.value?.releases ?? []);
/**
 * Skipped while any instrument is draft: `POST /:token/release` refuses those with a 409, so a
 * ceremony gated on them would be a wall the driver could not get past. It opens by itself when A0
 * publishes, exactly like the consent gate.
 */
const ceremonyAvailable = computed(
  () => releases.value.length > 0 && releases.value.every((r) => !r.draft),
);
const ceremonyNeeded = computed(
  () =>
    ceremonyAvailable.value
    && !consentNeeded.value
    && !invitation.data.value?.phases?.releasesCompletedAt
    && !ceremonyDone.value,
);
// AF3/D-AF1: identity before the first permission (the server refuses a release without it); on the
// form the three are shown, not retyped (D-AF8). Once given, the draft holds a date of birth
// (D-APP16), so it is re-read through the unlock like any resumed draft.
const identityDone = ref(false);
const identityComplete = computed(() => Boolean(invitation.data.value?.identityComplete));
const identityNeeded = computed(() => ceremonyNeeded.value && !identityComplete.value && !identityDone.value);
const identityLockedBy = computed(() => (identityComplete.value ? invitation.data.value!.carrier : null));
// AF4: the permissions are in and the office has not sent the form. Only an explicit null counts —
// see `ApplyPhases.applicationSentAt` — and a ceremony just finished in this tab counts as "in".
const waitingForApplication = computed(() => {
  const phases = invitation.data.value?.phases;
  return phases?.applicationSentAt === null && Boolean(phases.releasesCompletedAt || ceremonyDone.value);
});
function identityRecorded(): void {
  [identityDone.value, restored.value, autosaveEnabled.value] = [true, false, false];
  void invitation.refetch();
}


/**
 * The signing surface asks the layout for room (C1).
 *
 * ⚠ Emitted from HERE rather than from the ceremony, and the reason is that it is the same two
 * facts the screen is chosen by — an approved application with places still to sign — so there is
 * no third condition that could disagree with the `v-else-if` in the template.
 *
 * ⚠ **It sits at the END of setup, and the first version did not.** `awaitingSignature` reads
 * `submitted`, which reads `justSent` — destructured from `useApplicationSending` sixty lines below
 * where the watcher was — so `immediate: true` evaluated it inside the temporal dead zone and every
 * one of ApplyPage's 31 tests failed with *Cannot access 'justSent' before initialization*. An
 * `immediate` watcher is setup-order-sensitive in a way a computed is not, because nothing else
 * reads these until render.
 *
 * ⚠ Everything on that screen that is a form or prose keeps `max-w-3xl` of its own accord, so the
 * extra width reaches only the packet page and its rail. `SignOffScreen`'s template says so too.
 */
watch(
  () => awaitingSignature.value && packetStops.value.length > 0,
  (roomy) => emit("wide", roomy),
  { immediate: true },
);
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
  />

  <!-- F4/D-AX11: handed over, and not yet approved. The driver has done everything they can do for
       the moment, and the screen says so rather than leaving them on a form with a spent button. -->
  <BaseCard v-else-if="awaitingReview">
    <ApplyWaitScreen :heading="APPLY_COPY.handoff.waitingHeading" :note="APPLY_COPY.handoff.waitingNote"
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
      @start="begun = true"
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
      @agree="agree"
    />
  </BaseCard>

  <BaseCard v-else-if="identityNeeded">
    <IdentityFields :token="token" :carrier="invitation.data.value?.carrier ?? ''"
      :captures="invitation.data.value?.captures ?? []" @done="identityRecorded" />
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
      @done="ceremonyDone = true"
    />
  </BaseCard>

  <!-- AF4 (plan §3.1 row 5): permissions in, form not sent. Before the unlock gate: nothing is shown. -->
  <BaseCard v-else-if="waitingForApplication">
    <ApplyWaitScreen :heading="APPLY_COPY.permissionsReceived.heading" :note="APPLY_COPY.permissionsReceived.note"
      :body="APPLY_COPY.permissionsReceived.body(invitation.data.value?.carrier ?? '')" />
  </BaseCard>

  <!-- AF5 (plan §3.1 row 9): approved, and signing happens in the office. Before the unlock gate: it
       prints nothing of the application. -->
  <BaseCard v-else-if="awaitingOffice">
    <ApplyWaitScreen :heading="APPLY_COPY.signInOffice.heading" :note="APPLY_COPY.signInOffice.note"
      :body="APPLY_COPY.signInOffice.body(invitation.data.value?.carrier ?? '')" />
  </BaseCard>

  <!-- A2/D-APP16: the draft holds a date of birth, so the bare link does not read it back. One
       question, asked only when there is something to protect. -->
  <DraftUnlockGate
    v-else-if="locked"
    :token="token"
    :carrier="invitation.data.value?.carrier ?? ''"
    @unlocked="released = $event"
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
      @send="send"
    />
  </BaseCard>

  <div v-else-if="invitation.data.value" class="space-y-6">
    <div>
      <h1 class="text-2xl font-semibold text-ink">{{ APPLY_COPY.page.title }}</h1>
      <p class="mt-1 text-sm text-ink-muted">
        {{ APPLY_COPY.page.subtitle(invitation.data.value.carrier) }}
      </p>
      <!-- Said on the FIRST screen, not discovered at the Send button. The server refuses the
           submission while the wording is draft, and a driver who learns that after filling seven
           screens on a phone has been wasted. Their answers are saved either way — autosave is a
           separate path and has never been gated. -->
      <AppCallout v-if="wordingNotFinal" tone="caution" class="mt-3">
        {{ APPLY_COPY.notOpen.banner(invitation.data.value.carrier) }}
      </AppCallout>
    </div>

    <ApplyProgress
      :index="wizard.index.value"
      :furthest="wizard.furthestIndex.value"
      :save-status="saveStatus"
      @go-to="wizard.goTo"
    />

    <ApplyIssueList
      :issues="wizard.issues.value"
      :send-error="sendError"
      :final="wizard.isLast.value"
      @show="showIssue"
    />

    <BaseCard>
      <ApplicantDetailsFields v-if="wizard.section.value === 'identity'" v-model="draft" :locked-by="identityLockedBy" />
      <AddressHistoryFields v-else-if="wizard.section.value === 'addresses'" v-model="draft" />
      <LicenceFields v-else-if="wizard.section.value === 'licence'" v-model="draft" :locked-by="identityLockedBy" />
      <ApplyEmploymentFields v-else-if="wizard.section.value === 'employment'" v-model="draft" />
      <SafetyHistoryFields v-else-if="wizard.section.value === 'safety'" v-model="draft" />
      <!-- A9: the carrier's own questions, which discharge no CFR paragraph and block nothing. -->
      <QuestionnaireFields v-else-if="wizard.section.value === 'questions'" v-model="draft" />
      <!-- A8: photographs, not answers. They are staged against the invitation rather than saved into
           the draft, which is why this screen takes the token and not the form. -->
      <DocumentCaptureFields
        v-else-if="wizard.section.value === 'documents'"
        :token="token"
        :captures="invitation.data.value.captures ?? []"
      />
      <ReviewFields
        v-else
        :draft="draft"
        :captures="invitation.data.value.captures ?? []"
        @go-to="wizard.goTo"
      />
    </BaseCard>

    <!-- Shown read-only on the last screen ONLY while the ceremony cannot run (Q-H3: the wording is
         still draft and the server refuses those signatures). Nobody should be asked weeks later to
         sign four documents they have never seen; once A0 publishes, they are signed up front
         instead and this disappears. -->
    <BaseCard v-if="wizard.isLast.value && !ceremonyAvailable">
      <DisclosurePanel :releases="invitation.data.value.releases" />
      <!-- The panel says the instruments are not final; this says what that costs the driver
           standing in front of it, which the panel has no way to know. -->
      <p v-if="wordingNotFinal" class="mt-4 text-sm text-ink-secondary">
        {{ APPLY_COPY.notOpen.cannotSend }}
      </p>
    </BaseCard>

    <div class="flex items-center justify-between gap-4">
      <BaseButton v-if="!wizard.isFirst.value" variant="ghost" @click="wizard.back">
        {{ APPLY_COPY.nav.back }}
      </BaseButton>
      <span v-else />
      <BaseButton
        variant="primary"
        :disabled="handingOver || (wizard.isLast.value && wordingNotFinal)"
        @click="wizard.isLast.value ? sendForReview() : wizard.next()"
      >
        <template v-if="wizard.isLast.value">
          <!-- Disabled rather than hidden: the driver has reached the end of their application and
               the control they came for should still be where they expect it, saying why it will
               not go. A missing button reads as a bug in the page.

               ⚠ It SENDS rather than certifies since F4. The signature is asked for on the second
               visit, on the document as the office leaves it — see `sendForReview`. -->
          {{ wordingNotFinal
            ? APPLY_COPY.notOpen.sendLabel
            : handingOver
              ? APPLY_COPY.handoff.sending
              : APPLY_COPY.handoff.send(invitation.data.value.carrier) }}
        </template>
        <template v-else>
          {{ wizard.section.value === 'documents' ? APPLY_COPY.nav.review : APPLY_COPY.nav.next }}
        </template>
      </BaseButton>
    </div>
  </div>
</template>
