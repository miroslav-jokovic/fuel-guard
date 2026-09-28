<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { DEFAULT_ORG_TIMEZONE, todayInZone, type ApplicationSection } from "@silvicom/shared";
import {
  AppButton as BaseButton,
  AppCallout,
  AppCard as BaseCard,
} from "@silvicom/ui";
import ApplySection from "@/features/apply/ApplySection.vue";
import ApplyTaskHub from "@/features/apply/ApplyTaskHub.vue";
import { useTaskHub } from "@/features/apply/useTaskHub";
import DisclosurePanel from "@/features/apply/DisclosurePanel.vue";
import ApplyProgress from "@/features/apply/ApplyProgress.vue";
import ApplyIssueList from "@/features/apply/ApplyIssueList.vue";
import ApplyPhaseRouter from "@/features/apply/ApplyPhaseRouter.vue";
import { emptyDraft, fromDraftPayload, type ApplicationDraft } from "@/features/apply/draft";
import { linkHasBeenUsed, useApplyInvitationQuery, type Released } from "@/features/apply/useApplication";
import { applyPartOne } from "@/features/apply/partOneFacts";
import { useEsignConsentStep } from "@/features/apply/useEsignConsentStep";
import { usePartOneStep } from "@/features/apply/partOne/usePartOneStep";
import { draftStatusLabel, useApplicationDraft } from "@/features/apply/useApplicationDraft";
import DraftNotice from "@/features/apply/DraftNotice.vue";
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
 * ── WHICH SCREEN, IN WHAT ORDER (B7, A4, A5) ─────────────────────────────────────────────────
 * The expectations screen, the 7001(c) consent, Part 1 (a v2 link, C3a) or the identity step (a legacy
 * one), the permissions and the waiting screens come before the form, in an order `ApplyPhaseRouter.vue` holds and explains since C1
 * (2026-09-26). This page computes every condition that chain reads and performs every act it
 * reports; the router only chooses.
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
const released = ref<Released | null>(null);
/** A v2 link's Part 1 facts, released by the unlock (C3c2c2, Q-AW34) — shown read-only, laid into the draft. */
const partOneFacts = computed(() => released.value?.partOne ?? null);
const locked = computed(() => Boolean(invitation.data.value?.draft?.locked) && released.value === null);
const restored = ref(false);
const autosaveEnabled = ref(false);
const furthestSection = ref<string | null>(null);

/**
 * C3c1: on a v2 link, the carrier's day, so the form runs filing's own rules (`v2FilingIssues`) and judges
 * the three-year windows on the day filing does. Read lazily — `isPartOneLink` is set up further down.
 * ⚠ A bundle from an API older than C3c1 (the deploy window) has none: then the zone every carrier with no
 * `operating_hours` runs on, as the server would — never this device's, which is the viewer's day.
 */
const carrierToday = computed(
  () => invitation.data.value?.carrierToday ?? todayInZone(new Date(), DEFAULT_ORG_TIMEZONE),
);
const v2AsOf = (): string | null => (isPartOneLink.value ? carrierToday.value : null);
const wizard = useApplicationWizard(draft, furthestSection, v2AsOf);
/**
 * The two acts that end an application, and the validation in front of each (`useApplicationSending`).
 * It takes the wizard because a refused document has to land on the screen that owns the field.
 */
const { sendError, justSent, handedOver, sending, handingOver, sendForReview, send } =
  useApplicationSending(token, draft, wizard, v2AsOf);
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
  if (issue.section && (issue.section !== wizard.section.value || hub.showList.value)) {
    if (hub.inTask.value || hub.showList.value) hub.open(issue.section, true);
    else wizard.goTo(issue.section, true);
    await nextTick();
  }
  wizard.focusIssue(issue);
}
/** A "Fix" on the review screen: a task in Part 2's list, a screen in the legacy wizard. */
const goToSection = (section: ApplicationSection): void => (hub.inTask.value ? hub.open(section) : wizard.goTo(section));

/** C3d1b: the revision saves are checked against, taken with the body it describes — never from a later refetch. */
const draftRevision = ref<number | null>(null);
const autosave = useApplicationDraft(token, draft, {
  // Never before the consent: the server refuses those writes, and a "Not saved" banner on a screen
  // the driver has not been allowed to reach yet would be a lie about their signal.
  enabled: computed(
    () =>
      autosaveEnabled.value && !consentNeeded.value && !partOneNeeded.value && !ceremonyNeeded.value
      && !waitingForApplication.value,
  ),
  section: computed(() => wizard.furthestSection.value),
  revision: draftRevision,
  local: computed(() => {
    const inv = invitation.data.value;
    return inv?.localKey ? { key: inv.localKey, linkExpiresAt: inv.expiresAt } : null;
  }),
});

watch(
  [() => invitation.data.value, released],
  async ([inv, body]) => {
    if (!inv || restored.value) return;
    // Still gated: nothing to restore and nothing to save over. Autosave stays off, so a stranger
    // holding the link cannot overwrite the draft they are not allowed to read.
    if (inv.draft?.locked && !body) return;
    restored.value = true;
    const payload = body?.payload ?? inv.draft?.payload ?? null;
    if (payload) Object.assign(draft, fromDraftPayload(payload));
    draftRevision.value = body ? body.revision : (inv.draft?.revision ?? null);
    // What the last visit could not send (C3d1b) — before Part 1's facts, which are laid over last.
    const replayed = await autosave.replay();
    if (body?.partOne) applyPartOne(draft, body.partOne);
    furthestSection.value = inv.draft?.furthestSection ?? null;
    wizard.resume();
    // Next tick, so the restore assignment above does not itself schedule a save of what we just
    // loaded back to the server — except answers put back from the phone, which the server lacks.
    void nextTick(() => {
      autosaveEnabled.value = true;
      if (replayed) void autosave.flushNow();
    });
  },
  { immediate: true },
);
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
// ── Part 1 (C3a, §6.2) — a v2 link's identity, address, licences, photographs and rights summary, before
// the permissions. The server refuses a v2 link's permissions until it is finished, so on a v2 link the
// legacy identity screen never shows: Part 1 is what writes the identity now (D-AW3).
const { isPartOneLink, partOneNeeded, partOneInputs, refreshPartOne, partOneFinished } =
  usePartOneStep(invitation, consentNeeded);
// C3c2a (§6.4, D-AW11): a v2 link's Part 2 is a task list over the same screens; a legacy link keeps the wizard.
const hub = useTaskHub(wizard, isPartOneLink);
const identityNeeded = computed(
  () => ceremonyNeeded.value && !isPartOneLink.value && !identityComplete.value && !identityDone.value,
);
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
  <ApplyPhaseRouter
    v-model:draft="draft"
    :token="token"
    :invitation="invitation"
    :submitted="submitted"
    :awaiting-review="awaitingReview"
    :expectations-needed="expectationsNeeded"
    :ceremony-available="ceremonyAvailable"
    :esign-consent="esignConsent"
    :consent-needed="consentNeeded"
    :consenting="consenting"
    :consent-failed="consentFailed"
    :part-one-needed="partOneNeeded"
    :part-one-inputs="partOneInputs"
    :refresh-part-one="refreshPartOne"
    :is-part-one-link="isPartOneLink"
    :identity-needed="identityNeeded"
    :ceremony-needed="ceremonyNeeded"
    :releases="releases"
    :waiting-for-application="waitingForApplication"
    :awaiting-office="awaitingOffice"
    :locked="locked"
    :awaiting-signature="awaitingSignature"
    :packet-stops="packetStops"
    :packet-adopted="packetAdopted"
    :sending="sending"
    :send-error="sendError"
    @begin="begun = true"
    @agree="agree"
    @part-one-done="partOneFinished"
    @identity-recorded="identityRecorded"
    @ceremony-done="ceremonyDone = true"
    @unlocked="released = $event"
    @send="send"
  >
    <div v-if="invitation.data.value" class="space-y-6">
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
      <DraftNotice :state="autosave.state.value" :notice="autosave.notice.value" />

      <!-- §391.21(b)(1): "The name and address of the employing motor carrier" belongs ON the application. -->
      <p v-if="invitation.data.value.carrierAddress" class="text-sm text-ink-muted">
        {{ APPLY_COPY.page.employingCarrier(invitation.data.value.carrier, invitation.data.value.carrierAddress) }}
      </p>
      <!-- C3c2a: a v2 link's Part 2 opens on its task list (§6.4), on every return. -->
      <ApplyTaskHub
        v-if="hub.showList.value"
        :draft="draft"
        :v2-as-of="v2AsOf()"
        :captures="invitation.data.value.captures ?? []"
        :save-status="saveStatus"
        @open="hub.open"
      />
      <template v-else>
        <ApplyProgress
          v-if="!hub.inTask.value"
          :index="wizard.index.value"
          :furthest="wizard.furthestIndex.value"
          :save-status="saveStatus"
          :save-trouble="autosave.state.value === 'failed' || autosave.state.value === 'conflict'"
          @go-to="wizard.goTo"
        />

        <ApplyIssueList
          :issues="wizard.issues.value"
          :send-error="sendError"
          :final="wizard.isLast.value"
          @show="showIssue"
        />

        <BaseCard>
          <ApplySection
            v-model="draft"
            :section="wizard.section.value"
            :token="token"
            :captures="invitation.data.value.captures ?? []"
            :as-of="carrierToday"
            :v2-as-of="v2AsOf()"
            :part-one="partOneFacts"
            :identity-locked-by="identityLockedBy"
            @go-to="goToSection"
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
          <BaseButton v-if="hub.inTask.value" variant="ghost" @click="hub.leave">{{ APPLY_COPY.hub.backToList }}</BaseButton>
          <BaseButton v-else-if="!wizard.isFirst.value" variant="ghost" @click="wizard.back">
            {{ APPLY_COPY.nav.back }}
          </BaseButton>
          <span v-else />
          <BaseButton
            variant="primary"
            :disabled="handingOver || (wizard.isLast.value && wordingNotFinal)"
            @click="wizard.isLast.value ? sendForReview() : hub.inTask.value ? hub.finish() : wizard.next()"
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
            <template v-else-if="hub.inTask.value">{{ APPLY_COPY.hub.saveAndContinue }}</template>
            <template v-else>
              {{ wizard.section.value === 'documents' ? APPLY_COPY.nav.review : APPLY_COPY.nav.next }}
            </template>
          </BaseButton>
        </div>
      </template>
    </div>
  </ApplyPhaseRouter>
</template>
