<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { AppButton as BaseButton, AppCard as BaseCard, AppDateField, AppFormField as FormField } from "@fuelguard/ui";
import { APPLICATION_SECTION_CITATIONS, APPLICATION_SECTION_LABELS } from "@fuelguard/shared";
import ApplicantDetailsFields from "@/features/apply/ApplicantDetailsFields.vue";
import AddressHistoryFields from "@/features/apply/AddressHistoryFields.vue";
import LicenceFields from "@/features/apply/LicenceFields.vue";
import ApplyEmploymentFields from "@/features/apply/ApplyEmploymentFields.vue";
import SafetyHistoryFields from "@/features/apply/SafetyHistoryFields.vue";
import ReviewFields from "@/features/apply/ReviewFields.vue";
import CertifyFields from "@/features/apply/CertifyFields.vue";
import DisclosurePanel from "@/features/apply/DisclosurePanel.vue";
import { emptyDraft, fromDraftPayload, toApplication, type ApplicationDraft } from "@/features/apply/draft";
import { driverApplicationSchema } from "@fuelguard/shared";
import {
  unlockApplicationDraft,
  useApplyInvitationQuery,
  useSubmitApplication,
} from "@/features/apply/useApplication";
import { draftStatusLabel, useApplicationDraft } from "@/features/apply/useApplicationDraft";
import { issuesFromParse, useApplicationWizard } from "@/features/apply/useApplicationWizard";
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
  enabled: autosaveEnabled,
  section: computed(() => wizard.furthestSection.value),
});
const saveStatus = computed(() => draftStatusLabel(autosave.state.value));

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

// ── Sending ───────────────────────────────────────────────────────────────────────────────────
async function send(): Promise<void> {
  sendError.value = null;
  // The WHOLE document, through the server's own schema — not the union of the per-screen checks.
  // The last screen being valid is not the same thing as the application being complete, and the
  // driver is one tap from certifying that it is. Each issue is attributed to the screen that owns
  // the field, so "employers" reads as somewhere to go back to.
  const parsed = driverApplicationSchema.safeParse(toApplication(draft));
  if (!parsed.success) {
    wizard.setIssues(issuesFromParse(parsed.error.issues));
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
      <p v-if="saveStatus" class="mt-2 text-xs text-ink-muted">{{ saveStatus }}</p>
    </div>

    <!-- Where they are, in words and as a bar. The citation is shown because this is a regulated
         form and a driver asked for their address history deserves to see who is asking. -->
    <div class="space-y-2">
      <div class="flex items-baseline justify-between gap-4">
        <h2 class="text-base font-semibold text-ink">{{ APPLICATION_SECTION_LABELS[wizard.section.value] }}</h2>
        <span class="text-xs text-ink-muted">{{ APPLY_COPY.page.stepOf(wizard.index.value + 1, wizard.total) }}</span>
      </div>
      <div class="h-1 w-full overflow-hidden rounded-detail bg-surface-muted">
        <div
          class="h-full bg-brand-500 transition-all"
          :style="{ width: `${((wizard.index.value + 1) / wizard.total) * 100}%` }"
        />
      </div>
      <p v-if="APPLICATION_SECTION_CITATIONS[wizard.section.value]" class="text-xs text-ink-muted">
        {{ APPLICATION_SECTION_CITATIONS[wizard.section.value] }}
      </p>
    </div>

    <BaseCard v-if="wizard.issues.value.length || sendError">
      <h2 class="text-sm font-semibold text-ink">
        {{ wizard.isLast.value ? APPLY_COPY.issues.headingFinal : APPLY_COPY.issues.heading }}
      </h2>
      <ul class="mt-2 space-y-1 text-sm text-ink-secondary">
        <li v-if="sendError">{{ sendError }}</li>
        <li v-for="issue in wizard.issues.value" :key="`${issue.key}-${issue.message}`">
          <span class="font-medium text-ink">{{ issue.key }}</span> — {{ issue.message }}
        </li>
      </ul>
    </BaseCard>

    <BaseCard>
      <ApplicantDetailsFields v-if="wizard.section.value === 'identity'" v-model="draft" />
      <AddressHistoryFields v-else-if="wizard.section.value === 'addresses'" v-model="draft" />
      <LicenceFields v-else-if="wizard.section.value === 'licence'" v-model="draft" />
      <ApplyEmploymentFields v-else-if="wizard.section.value === 'employment'" v-model="draft" />
      <SafetyHistoryFields v-else-if="wizard.section.value === 'safety'" v-model="draft" />
      <ReviewFields v-else-if="wizard.section.value === 'review'" :draft="draft" @go-to="wizard.goTo" />
      <CertifyFields v-else v-model="draft" />
    </BaseCard>

    <!-- The instruments are shown on the last screen, unsigned. Q-H3: nothing here can record a
         signature while the wording is draft, and A5 gives them their own ceremony. -->
    <BaseCard v-if="wizard.isLast.value">
      <DisclosurePanel :releases="invitation.data.value.releases" />
    </BaseCard>

    <div class="flex items-center justify-between gap-4">
      <BaseButton v-if="!wizard.isFirst.value" variant="ghost" @click="wizard.back">
        {{ APPLY_COPY.nav.back }}
      </BaseButton>
      <span v-else />
      <BaseButton
        variant="primary"
        :disabled="submit.isPending.value"
        @click="wizard.isLast.value ? send() : wizard.next()"
      >
        <template v-if="wizard.isLast.value">
          {{ submit.isPending.value ? APPLY_COPY.nav.sending : APPLY_COPY.nav.send }}
        </template>
        <template v-else>
          {{ wizard.section.value === 'safety' ? APPLY_COPY.nav.review : APPLY_COPY.nav.next }}
        </template>
      </BaseButton>
    </div>
  </div>
</template>
