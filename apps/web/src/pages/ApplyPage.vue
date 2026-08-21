<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { driverApplicationSchema } from "@fuelguard/shared";
import { AppButton as BaseButton, AppCard as BaseCard, AppCheckbox as BaseCheckbox, AppDateField, AppInput as BaseInput, AppFormField as FormField } from "@fuelguard/ui";
import ApplicantDetailsFields from "@/features/apply/ApplicantDetailsFields.vue";
import AddressHistoryFields from "@/features/apply/AddressHistoryFields.vue";
import ApplyEmploymentFields from "@/features/apply/ApplyEmploymentFields.vue";
import SafetyHistoryFields from "@/features/apply/SafetyHistoryFields.vue";
import DisclosurePanel from "@/features/apply/DisclosurePanel.vue";
import { emptyDraft, fromDraftPayload, toApplication, type ApplicationDraft } from "@/features/apply/draft";
import {
  unlockApplicationDraft,
  useApplyInvitationQuery,
  useSubmitApplication,
} from "@/features/apply/useApplication";
import { draftStatusLabel, useApplicationDraft } from "@/features/apply/useApplicationDraft";

/**
 * The driver's own §391.21 application (H5b).
 *
 * ── THIS PAGE HAS NO SESSION, AND NOTHING ON IT MAY ASSUME ONE ─────────────────────────────────
 * No session store, no `apiFetch`, no toasts from the app shell — an applicant is not a user, and a
 * recruiter signed in on the same browser must not have their identity ride along. Feedback is
 * inline here rather than a toast for the same reason the rest of the app uses toasts: this is a
 * single-purpose page where the result IS the page, not an action inside a workspace.
 *
 * ── IT SAVES ITSELF, AND SOMETIMES ASKS WHO IS READING (A2) ───────────────────────────────────
 * The form autosaves to `application_drafts` so a lost signal is not a lost application. Coming back
 * to a draft that already holds a date of birth costs one question — the date of birth itself
 * (D-APP16) — because the link is a session now and A10 will re-send it by email, and an email is
 * forwarded and a phone is shared. Before a date of birth is typed there is nothing to protect and
 * no question is asked.
 *
 * ── VALIDATION IS THE SERVER'S SCHEMA, RUN LOCALLY ─────────────────────────────────────────────
 * `driverApplicationSchema` is the same object the API validates with. Running it here turns a 400
 * into an inline list of what is missing, and guarantees the two can never disagree about what
 * §391.21 requires — a second opinion in the client is how a form comes to accept something the
 * server rejects.
 */
const route = useRoute();
const emit = defineEmits<{ carrier: [string | null] }>();
const token = computed(() => String(route.params.token ?? ""));

const invitation = useApplyInvitationQuery(token);
const submit = useSubmitApplication(token);

// The layout's header shows the carrier's name once the link resolves.
watch(() => invitation.data.value?.carrier, (name) => emit("carrier", name ?? null), { immediate: true });

const draft = reactive<ApplicationDraft>(emptyDraft());
const issues = ref<Array<{ path: string; message: string }>>([]);
const justSent = ref(false);

/**
 * Submitted is a fact about the link, not a fact about this browser tab (D-APP1).
 *
 * Until 0225 it could only ever be local state, because submitting killed the token and a reopened
 * link answered "not valid" — a driver who closed the tab and clicked their email again was told
 * their own application link was broken. The server now carries the phase, so reopening shows what
 * happened; `justSent` still exists because the same page must say it in the same moment, before the
 * query refetches.
 */
const submitted = computed(() => justSent.value || Boolean(invitation.data.value?.phases?.submittedAt));

const draftModel = computed({
  get: () => draft as ApplicationDraft,
  set: (v: ApplicationDraft) => Object.assign(draft, v),
});

// ── Resuming (A2) ─────────────────────────────────────────────────────────────────────────────
/** The body released by an unlock, when the saved draft was gated. */
const released = ref<Record<string, unknown> | null>(null);
const locked = computed(() => Boolean(invitation.data.value?.draft?.locked) && released.value === null);
const restored = ref(false);
const autosaveEnabled = ref(false);

watch(
  [() => invitation.data.value, released],
  ([inv, body]) => {
    if (!inv || restored.value) return;
    // Still gated: nothing to restore and nothing to save over. Autosave stays off, so a stranger
    // holding the link cannot overwrite the draft they are not allowed to read.
    if (inv.draft?.locked && !body) return;
    const payload = body ?? inv.draft?.payload ?? null;
    if (payload) Object.assign(draft, fromDraftPayload(payload));
    restored.value = true;
    // Next tick, so the restore assignment above does not itself schedule a save of what we just
    // loaded back to the server.
    void nextTick(() => { autosaveEnabled.value = true; });
  },
  { immediate: true },
);

const autosave = useApplicationDraft(token, draft, { enabled: autosaveEnabled });
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

async function send(): Promise<void> {
  issues.value = [];
  const parsed = driverApplicationSchema.safeParse(toApplication(draft));
  if (!parsed.success) {
    issues.value = parsed.error.issues.map((i) => ({
      path: i.path.join(" › ") || "form",
      message: i.message,
    }));
    // Back to the top: the list of what is missing is above the button that was just pressed.
    globalThis.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  try {
    await submit.mutateAsync(parsed.data);
    justSent.value = true;
  } catch (e) {
    issues.value = [{ path: "form", message: e instanceof Error ? e.message : "Could not send the application." }];
  }
}
</script>

<template>
  <div v-if="invitation.isLoading.value" class="text-sm text-ink-muted">Opening your application…</div>

  <!-- Every dead link answers identically by design; the page repeats what it was told and offers
       the only action that can help, which is to ask the carrier for a new link. -->
  <BaseCard v-else-if="invitation.isError.value">
    <h1 class="text-lg font-semibold text-ink">This link is not valid</h1>
    <p class="mt-2 text-sm text-ink-muted">
      It may have expired, or the carrier may have replaced it. Ask the carrier who invited you for a
      new one.
    </p>
  </BaseCard>

  <!-- What happened, not what will (A1). The old copy promised signing that this page could not
       deliver — submitting killed the link the promise was made on — and D-APP4 moves the signing
       ahead of the certification, so there is no longer a later step to promise. -->
  <BaseCard v-else-if="submitted">
    <h1 class="text-lg font-semibold text-ink">Your application is in</h1>
    <p class="mt-2 text-sm text-ink-muted">
      {{ invitation.data.value?.carrier }} has it, certified in your name under 49 CFR §391.21(b).
      They will contact you about what happens next.
    </p>
    <p class="mt-2 text-sm text-ink-muted">
      You can close this page. Your link still opens to this message, and it cannot be used to send a
      second application.
    </p>
  </BaseCard>

  <!-- A2/D-APP16: the draft holds a date of birth, so the bare link does not read it back. One
       question, asked only when there is something to protect. -->
  <BaseCard v-else-if="locked">
    <h1 class="text-lg font-semibold text-ink">Pick up where you left off</h1>
    <p class="mt-2 text-sm text-ink-muted">
      You have already started this application for {{ invitation.data.value?.carrier }}. Confirm your
      date of birth and your answers come back.
    </p>
    <div class="mt-4 max-w-xs">
      <FormField v-slot="{ id }" label="Your date of birth">
        <AppDateField :id="id" v-model="unlockDob" />
      </FormField>
    </div>
    <p v-if="unlockFailed" class="mt-2 text-sm text-ink-secondary">
      That does not match this application. Try again, or ask the carrier for a new link and start
      fresh.
    </p>
    <div class="mt-6 flex justify-end">
      <BaseButton variant="primary" :disabled="unlocking || !unlockDob" @click="unlock">
        {{ unlocking ? "Checking…" : "Continue" }}
      </BaseButton>
    </div>
  </BaseCard>

  <div v-else-if="invitation.data.value" class="space-y-8">
    <div>
      <h1 class="text-2xl font-semibold text-ink">Driver application</h1>
      <p class="mt-1 text-sm text-ink-muted">
        For {{ invitation.data.value.carrier }}, under 49 CFR §391.21. Your answers save as you go —
        you can close this page and come back. You can only send it once, so check it before you do.
      </p>
      <p v-if="saveStatus" class="mt-2 text-xs text-ink-muted">{{ saveStatus }}</p>
    </div>

    <BaseCard v-if="issues.length">
      <h2 class="text-sm font-semibold text-ink">Before you can send this</h2>
      <ul class="mt-2 space-y-1 text-sm text-ink-secondary">
        <li v-for="issue in issues" :key="`${issue.path}-${issue.message}`">
          <span class="font-medium text-ink">{{ issue.path }}</span> — {{ issue.message }}
        </li>
      </ul>
    </BaseCard>

    <BaseCard><ApplicantDetailsFields v-model="draftModel" /></BaseCard>
    <BaseCard><AddressHistoryFields v-model="draftModel" /></BaseCard>
    <BaseCard><ApplyEmploymentFields v-model="draftModel" /></BaseCard>
    <BaseCard><SafetyHistoryFields v-model="draftModel" /></BaseCard>
    <BaseCard><DisclosurePanel :releases="invitation.data.value.releases" /></BaseCard>

    <BaseCard>
      <h2 class="text-base font-semibold text-ink">Your certification</h2>
      <p class="mt-1 text-sm text-ink-muted">
        §391.21(b) requires you to certify this. Typing your name is your signature.
      </p>
      <div class="mt-4 space-y-4">
        <BaseCheckbox v-model="draft.certified">
          I certify that all entries on this application are true and complete to the best of my
          knowledge.
        </BaseCheckbox>
        <FormField v-slot="{ id }" label="Your full name">
          <BaseInput :id="id" v-model="draft.signed_name" autocomplete="name" />
        </FormField>
      </div>
      <div class="mt-6 flex justify-end">
        <BaseButton variant="primary" :disabled="submit.isPending.value" @click="send">
          {{ submit.isPending.value ? "Sending…" : "Send my application" }}
        </BaseButton>
      </div>
    </BaseCard>
  </div>
</template>
