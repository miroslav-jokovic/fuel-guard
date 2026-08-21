<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { driverApplicationSchema } from "@fuelguard/shared";
import { AppButton as BaseButton, AppCard as BaseCard, AppCheckbox as BaseCheckbox, AppInput as BaseInput, AppFormField as FormField } from "@fuelguard/ui";
import ApplicantDetailsFields from "@/features/apply/ApplicantDetailsFields.vue";
import AddressHistoryFields from "@/features/apply/AddressHistoryFields.vue";
import ApplyEmploymentFields from "@/features/apply/ApplyEmploymentFields.vue";
import SafetyHistoryFields from "@/features/apply/SafetyHistoryFields.vue";
import DisclosurePanel from "@/features/apply/DisclosurePanel.vue";
import { emptyDraft, toApplication, type ApplicationDraft } from "@/features/apply/draft";
import { useApplyInvitationQuery, useSubmitApplication } from "@/features/apply/useApplication";

/**
 * The driver's own §391.21 application (H5b).
 *
 * ── THIS PAGE HAS NO SESSION, AND NOTHING ON IT MAY ASSUME ONE ─────────────────────────────────
 * No session store, no `apiFetch`, no toasts from the app shell — an applicant is not a user, and a
 * recruiter signed in on the same browser must not have their identity ride along. Feedback is
 * inline here rather than a toast for the same reason the rest of the app uses toasts: this is a
 * single-purpose page where the result IS the page, not an action inside a workspace.
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

  <div v-else-if="invitation.data.value" class="space-y-8">
    <div>
      <h1 class="text-2xl font-semibold text-ink">Driver application</h1>
      <p class="mt-1 text-sm text-ink-muted">
        For {{ invitation.data.value.carrier }}, under 49 CFR §391.21. You can only submit this once,
        so check your answers before you send it.
      </p>
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
