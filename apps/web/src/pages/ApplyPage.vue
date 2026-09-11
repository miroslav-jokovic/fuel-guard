<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import {
  AppButton as BaseButton,
  AppCallout,
  AppCard as BaseCard,
  AppDateField,
  AppFormField as FormField,
} from "@silvicom/ui";
import ApplicantDetailsFields from "@/features/apply/ApplicantDetailsFields.vue";
import AddressHistoryFields from "@/features/apply/AddressHistoryFields.vue";
import LicenceFields from "@/features/apply/LicenceFields.vue";
import ApplyEmploymentFields from "@/features/apply/ApplyEmploymentFields.vue";
import SafetyHistoryFields from "@/features/apply/SafetyHistoryFields.vue";
import QuestionnaireFields from "@/features/apply/QuestionnaireFields.vue";
import DocumentCaptureFields from "@/features/apply/DocumentCaptureFields.vue";
import ReviewFields from "@/features/apply/ReviewFields.vue";
import CertifyFields from "@/features/apply/CertifyFields.vue";
import DisclosurePanel from "@/features/apply/DisclosurePanel.vue";
import EsignConsentGate from "@/features/apply/EsignConsentGate.vue";
import SigningCeremony from "@/features/apply/signing/SigningCeremony.vue";
import ApplyProgress from "@/features/apply/ApplyProgress.vue";
import { emptyDraft, fromDraftPayload, toApplication, type ApplicationDraft } from "@/features/apply/draft";
import { driverApplicationSchema } from "@silvicom/shared";
import {
  fetchApplicantCopy,
  giveEsignConsent,
  unlockApplicationDraft,
  useApplyInvitationQuery,
  useSubmitApplication,
} from "@/features/apply/useApplication";
import { draftStatusLabel, useApplicationDraft } from "@/features/apply/useApplicationDraft";
import { issuesFromParse, useApplicationWizard, type SectionIssue } from "@/features/apply/useApplicationWizard";
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
 * ── NOTHING HAPPENS BEFORE THE 7001(c) CONSENT (A4) ───────────────────────────────────────────
 * §390.32(d) makes an electronic §391.21 application conditional on including proof that the driver
 * agreed to transact electronically, so that agreement is the first screen. While the wording is
 * still draft nothing is asked and the link behaves as it did before — the server says which, and
 * the page does not decide it for itself.
 *
 * ── THE AUTHORIZATIONS ARE SIGNED BEFORE THE FORM, NOT AFTER (A5, D-APP4) ─────────────────────
 * §391.21(b)'s certification is the LAST act of an application, and submitting is what makes the
 * application exist — so anything that has to happen with it has to happen before it, or it needs a
 * second link, and the market's whole finding is that a second touch loses people. The order on this
 * page is therefore: consent → the four instruments → the form → review → certify.
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
const emit = defineEmits<{ carrier: [string | null] }>();
const token = computed(() => String(route.params.token ?? ""));

const invitation = useApplyInvitationQuery(token);
const submit = useSubmitApplication(token);

// The layout's header shows the carrier's name once the link resolves.
watch(() => invitation.data.value?.carrier, (name) => emit("carrier", name ?? null), { immediate: true });

const draft = reactive<ApplicationDraft>(emptyDraft());
const sendError = ref<string | null>(null);
const justSent = ref(false);

/**
 * Submitted is a fact about the link, not about this browser tab (D-APP1). Before 0225 it could only
 * ever be local state, because submitting killed the token and a reopened link answered "not valid".
 */
const submitted = computed(() => justSent.value || Boolean(invitation.data.value?.phases?.submittedAt));

// ── Resuming (A2) ─────────────────────────────────────────────────────────────────────────────
const released = ref<Record<string, unknown> | null>(null);
const locked = computed(() => Boolean(invitation.data.value?.draft?.locked) && released.value === null);
const restored = ref(false);
const autosaveEnabled = ref(false);
const furthestSection = ref<string | null>(null);

const wizard = useApplicationWizard(draft, furthestSection);
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
  enabled: computed(() => autosaveEnabled.value && !consentNeeded.value && !ceremonyNeeded.value),
  section: computed(() => wizard.furthestSection.value),
});
const saveStatus = computed(() => draftStatusLabel(autosave.state.value));

// ── The 7001(c) consent (A4) ──────────────────────────────────────────────────────────────────
const consenting = ref(false);
const consentFailed = ref(false);
const consentGiven = ref(false);
const esignConsent = computed(() => invitation.data.value?.esignConsent ?? null);
/**
 * Asked for only when the server says it can be recorded — `required` is false while counsel's
 * wording is outstanding, and the page must not ask for a consent the API would refuse.
 */
const consentNeeded = computed(
  () =>
    Boolean(esignConsent.value?.required)
    && !invitation.data.value?.phases?.consentedAt
    && !consentGiven.value,
);

async function agree(): Promise<void> {
  consenting.value = true;
  consentFailed.value = false;
  try {
    await giveEsignConsent(token.value);
    consentGiven.value = true;
  } catch {
    consentFailed.value = true;
  } finally {
    consenting.value = false;
  }
}

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

const unlockDob = ref("");
const unlockFailed = ref(false);
const unlocking = ref(false);

/** One question, one answer, and a wrong answer costs nothing but another try (D-APP16). */
async function unlock(): Promise<void> {
  if (!unlockDob.value) return;
  unlocking.value = true;
  unlockFailed.value = false;
  try {
    const res = await unlockApplicationDraft(token.value, unlockDob.value);
    if (res.draft.locked || !res.draft.payload) unlockFailed.value = true;
    else released.value = res.draft.payload;
  } catch {
    unlockFailed.value = true;
  } finally {
    unlocking.value = false;
  }
}

// ── The driver's own copy (X8, D-AX9) ─────────────────────────────────────────────────────────
const copyWorking = ref(false);
const copyFailed = ref(false);

/**
 * Ask for a fresh link and open it.
 *
 * `window.open` rather than an `<a download>` with a stored href: the URL is signed for five minutes
 * and is fetched at the moment of the press, so there is never a stale one on the page waiting to
 * disappoint somebody. A popup blocked by the browser is indistinguishable here from a failure, and
 * both get the same sentence — which names the other way to get the document.
 */
async function downloadCopy(): Promise<void> {
  copyWorking.value = true;
  copyFailed.value = false;
  try {
    const copy = await fetchApplicantCopy(token.value);
    const opened = globalThis.open(copy.url, "_blank", "noopener");
    if (!opened) copyFailed.value = true;
  } catch {
    copyFailed.value = true;
  } finally {
    copyWorking.value = false;
  }
}

// ── Sending ───────────────────────────────────────────────────────────────────────────────────
async function send(): Promise<void> {
  sendError.value = null;
  // The WHOLE document, through the server's own schema — not the union of the per-screen checks.
  // The last screen being valid is not the same thing as the application being complete, and the
  // driver is one tap from certifying that it is. Each issue is attributed to the screen that owns
  // the field, so "employers" reads as somewhere to go back to.
  const candidate = toApplication(draft);
  const parsed = driverApplicationSchema.safeParse(candidate);
  if (!parsed.success) {
    // The candidate travels with the issues: `messageFor` needs the VALUE that failed to tell an
    // empty box ("This is needed") from a two-character one ("This is too short").
    wizard.setIssues(issuesFromParse(parsed.error.issues, candidate));
    globalThis.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  try {
    await submit.mutateAsync({
      application: parsed.data,
      // D-APP3: the one field that never entered a draft goes straight from the form to `sealSsn`.
      ssn: draft.ssn.trim() === "" ? null : draft.ssn.trim(),
    });
    justSent.value = true;
  } catch (e) {
    sendError.value = e instanceof Error ? e.message : APPLY_COPY.issues.sendFailed;
  }
}
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
  <BaseCard v-else-if="submitted">
    <h1 class="text-lg font-semibold text-ink">{{ APPLY_COPY.done.heading }}</h1>
    <p class="mt-2 text-sm text-ink-muted">{{ APPLY_COPY.done.body(invitation.data.value?.carrier ?? "") }}</p>
    <p class="mt-2 text-sm text-ink-muted">{{ APPLY_COPY.done.reopen }}</p>

    <!-- X8/D-AX9. The consent the driver gave promises a copy at no charge; until now the only way
         to get one was to ask the carrier. -->
    <div class="mt-6 space-y-2">
      <BaseButton variant="secondary" :disabled="copyWorking" @click="downloadCopy">
        {{ copyWorking ? APPLY_COPY.done.downloading : APPLY_COPY.done.download }}
      </BaseButton>
      <p class="text-xs text-ink-muted">{{ APPLY_COPY.done.downloadNote }}</p>
      <p v-if="copyFailed" class="text-sm text-ink-secondary">{{ APPLY_COPY.done.downloadFailed }}</p>
    </div>
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

  <!-- A5/D-APP7: four instruments, four screens, four acts. FCRA §604(b)(2) requires each
       disclosure to stand alone, so there is nothing else on screen while one is showing. -->
  <BaseCard v-else-if="ceremonyNeeded">
    <SigningCeremony
      :token="token"
      :releases="releases"
      :already-signed="invitation.data.value?.releasesSigned ?? []"
      :carrier="invitation.data.value?.carrier ?? ''"
      @done="ceremonyDone = true"
    />
  </BaseCard>

  <!-- A2/D-APP16: the draft holds a date of birth, so the bare link does not read it back. One
       question, asked only when there is something to protect. -->
  <BaseCard v-else-if="locked">
    <h1 class="text-lg font-semibold text-ink">{{ APPLY_COPY.unlock.heading }}</h1>
    <p class="mt-2 text-sm text-ink-muted">{{ APPLY_COPY.unlock.body(invitation.data.value?.carrier ?? "") }}</p>
    <div class="mt-4 max-w-xs">
      <FormField v-slot="{ id }" :label="APPLY_COPY.unlock.label">
        <AppDateField :id="id" v-model="unlockDob" />
      </FormField>
    </div>
    <p v-if="unlockFailed" class="mt-2 text-sm text-ink-secondary">{{ APPLY_COPY.unlock.failed }}</p>
    <div class="mt-6 flex justify-end">
      <BaseButton variant="primary" :disabled="unlocking || !unlockDob" @click="unlock">
        {{ unlocking ? APPLY_COPY.unlock.checking : APPLY_COPY.unlock.action }}
      </BaseButton>
    </div>
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

    <BaseCard v-if="wizard.issues.value.length || sendError">
      <h2 class="text-sm font-semibold text-ink">
        {{ wizard.isLast.value ? APPLY_COPY.issues.headingFinal : APPLY_COPY.issues.heading }}
      </h2>
      <!-- ⚠ This used to render `issue.key` — the Zod path, which is the contract key — so a driver
           read `equipment_experience` beside "Too small: expected string to have >=1 characters".
           `label` is the field in the words printed above the box, and `say` is a sentence addressed
           to the person reading it (D-AX3).

           Each entry is a control rather than a line of text, because on the employment screen the
           field it names can be two thousand pixels below the fold. It is `BaseButton variant="link"`
           and not a bare `<button>`: a raw button in a page or a feature fails `lint:ui-adoption`. -->
      <ul class="mt-2 space-y-1 text-sm text-ink-secondary">
        <li v-if="sendError">{{ sendError }}</li>
        <li v-for="issue in wizard.issues.value" :key="issue.fieldId + issue.message">
          <BaseButton variant="link" @click="showIssue(issue)">
            <span class="font-medium text-ink">{{ issue.label }}</span>
          </BaseButton>
          — {{ issue.say }}
        </li>
      </ul>
    </BaseCard>

    <BaseCard>
      <ApplicantDetailsFields v-if="wizard.section.value === 'identity'" v-model="draft" />
      <AddressHistoryFields v-else-if="wizard.section.value === 'addresses'" v-model="draft" />
      <LicenceFields v-else-if="wizard.section.value === 'licence'" v-model="draft" />
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
        v-else-if="wizard.section.value === 'review'"
        :draft="draft"
        :captures="invitation.data.value.captures ?? []"
        @go-to="wizard.goTo"
      />
      <CertifyFields v-else v-model="draft" />
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
        :disabled="submit.isPending.value || (wizard.isLast.value && wordingNotFinal)"
        @click="wizard.isLast.value ? send() : wizard.next()"
      >
        <template v-if="wizard.isLast.value">
          <!-- Disabled rather than hidden: the driver has reached the end of their application and
               the control they came for should still be where they expect it, saying why it will
               not go. A missing button reads as a bug in the page. -->
          {{ wordingNotFinal
            ? APPLY_COPY.notOpen.sendLabel
            : submit.isPending.value ? APPLY_COPY.nav.sending : APPLY_COPY.nav.send }}
        </template>
        <template v-else>
          {{ wizard.section.value === 'documents' ? APPLY_COPY.nav.review : APPLY_COPY.nav.next }}
        </template>
      </BaseButton>
    </div>
  </div>
</template>
