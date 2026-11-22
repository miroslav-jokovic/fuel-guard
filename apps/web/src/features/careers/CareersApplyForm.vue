<script setup lang="ts">
import { computed, nextTick, reactive, ref } from "vue";
import {
  AppButton as BaseButton,
  AppCheckbox as BaseCheckbox,
  AppFormField as FormField,
  AppInput as BaseInput,
  AppRadioGroup as RadioGroup,
} from "@silvicom/ui";
import { APPLY_HONEYPOT_FIELD, applySubmitSchema, type ApplyJobView, type ApplySubmit } from "@silvicom/shared";
import { CAREERS_PRIVACY_PATH, SMS_TERMS_PATH } from "@/lib/legalPaths";
import { sendApplication, type CareersError } from "./careersApi";
import { CAREERS_COPY } from "./careersCopy";
import TurnstileBox from "./TurnstileBox.vue";

/**
 * The careers page's form (APPLY-PAGE-PLAN AP3; D-AP3, D-AP4, D-AP5, D-AP7).
 *
 * ── WHAT IT ASKS ────────────────────────────────────────────────────────────────────────────────
 * Name, mobile, email, and the opening's own questions as the server sent them (`questions`: the Instant Form's
 * catalogue, in its words). Nothing else exists to fill: `applySubmitSchema` is strict, so a field added here that the
 * contract does not hold would be refused.
 *
 * ── THE SAME RULES AS THE SERVER, READ FROM THE SAME PLACE ──────────────────────────────────────
 * The form is checked with `applySubmitSchema` before it is sent, so a person reads the contract's own sentence under
 * the field it is about. The server checks again and its 400 names a field the same way (`fieldError`). An
 * unanswered question is named here by the question itself.
 *
 * ── THE TEXTING BOX (D-AP4) ─────────────────────────────────────────────────────────────────────
 * Unticked, optional, apart from every other control. Its words are the server's composed document, shown whole:
 * what is shown is what the consent row stores. The SMS Terms and Privacy Policy links sit beside the words, not
 * inside them, each in a new tab so the form is not lost. They are absolute, on the office host (`legalOrigin`,
 * D-AP9).
 *
 * ── THE CHECKS NEVER BLOCK (D-AP5) ──────────────────────────────────────────────────────────────
 * Turnstile's token, the honeypot and the fill time travel with the form and are judged on the server. Nothing here
 * waits for the robot check: sending without a token is allowed, and the server records it.
 *
 * ── ERRORS (WCAG 2.2 AA, D-AP7) ─────────────────────────────────────────────────────────────────
 * Each error is a sentence under its field, tied by `aria-describedby` (`AppFormField`), and focus moves to the first
 * one. A send that did not land keeps every answer.
 */
const props = defineProps<{ job: ApplyJobView }>();
const emit = defineEmits<{ sent: []; gone: [] }>();
const copy = CAREERS_COPY.form;

const form = reactive({ fullName: "", phone: "", email: "", smsOptIn: false, honeypot: "" });
const answers = reactive<Record<string, string>>({});
const turnstileToken = ref<string | null>(null);
const turnstile = ref<InstanceType<typeof TurnstileBox> | null>(null);
const errors = ref<Record<string, string>>({});
const failed = ref<string | null>(null);
const sending = ref(false);

const fieldId = (key: string) => `careers-${key}`;
const questionId = (key: string) => `careers-q-${key}`;
const legal = computed(() => ({
  smsTerms: `${props.job.legalOrigin}${SMS_TERMS_PATH}`,
  privacy: `${props.job.legalOrigin}${CAREERS_PRIVACY_PATH}`,
}));

function body(): ApplySubmit {
  return {
    formToken: props.job.formToken,
    fullName: form.fullName,
    phone: form.phone.trim() === "" ? null : form.phone,
    email: form.email.trim() === "" ? null : form.email,
    answers: { ...answers },
    smsOptIn: form.smsOptIn,
    turnstileToken: turnstileToken.value,
    [APPLY_HONEYPOT_FIELD]: form.honeypot,
  };
}

/** The contract's issues, one sentence per field, the first for each; unanswered questions by name. */
function check(b: ApplySubmit): Record<string, string> {
  const out: Record<string, string> = {};
  const parsed = applySubmitSchema.safeParse(b);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key && !(key in out)) out[key] = issue.message;
    }
  }
  for (const q of props.job.questions) if (!b.answers[q.key]) out[`q:${q.key}`] = copy.chooseOne;
  return out;
}

const ORDER = (): string[] => ["fullName", "phone", "email", ...props.job.questions.map((q) => `q:${q.key}`)];
async function focusFirstError(): Promise<void> {
  await nextTick();
  const first = ORDER().find((k) => errors.value[k]);
  if (!first) return;
  const el = first.startsWith("q:")
    ? document.querySelector<HTMLElement>(`#${questionId(first.slice(2))} input`)
    : document.getElementById(fieldId(first));
  el?.focus();
}

async function submit(): Promise<void> {
  if (sending.value) return;
  failed.value = null;
  const b = body();
  errors.value = check(b);
  if (Object.keys(errors.value).length > 0) return void focusFirstError();
  sending.value = true;
  try {
    await sendApplication(props.job.handle, props.job.opening.id, b);
    emit("sent");
  } catch (e) {
    const err = e as CareersError;
    if (err.status === 404) return void emit("gone");
    if (err.status === 400 && err.field && err.field !== "answers") {
      errors.value = { [err.field]: err.message };
      return void focusFirstError();
    }
    // Anything that reached the server may have spent the token; a fresh one for the next try.
    if (err.status !== 400) turnstile.value?.reset();
    failed.value = err.code === "offline" ? copy.offline : err.status === 400 ? err.message : copy.failed;
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <form class="space-y-6" novalidate data-careers-form @submit.prevent="submit">
    <div>
      <h2 class="text-lg font-semibold text-ink">{{ copy.heading }}</h2>
      <p class="mt-1 text-sm text-ink-muted">{{ copy.lead }}</p>
    </div>

    <FormField :id="fieldId('fullName')" :label="copy.fullName" :error="errors.fullName" required>
      <template #default="f">
        <BaseInput v-bind="f" v-model="form.fullName" autocomplete="name" :invalid="Boolean(errors.fullName)" />
      </template>
    </FormField>
    <FormField :id="fieldId('phone')" :label="copy.phone" :hint="copy.phoneHint" :error="errors.phone">
      <template #default="f">
        <BaseInput v-bind="f" v-model="form.phone" type="tel" inputmode="tel" autocomplete="tel" class="max-w-xs" :invalid="Boolean(errors.phone)" />
      </template>
    </FormField>
    <FormField :id="fieldId('email')" :label="copy.email" :error="errors.email">
      <template #default="f">
        <BaseInput v-bind="f" v-model="form.email" type="email" inputmode="email" autocomplete="email" :invalid="Boolean(errors.email)" />
      </template>
    </FormField>

    <div v-for="q in job.questions" :key="q.key" class="space-y-1">
      <RadioGroup
        :id="questionId(q.key)"
        v-model="answers[q.key]"
        :legend="q.label"
        :options="q.options.map((o) => ({ value: o.key, label: o.label }))"
        variant="cards"
        :columns="q.options.length === 2 ? 2 : 1"
        :aria-describedby="errors[`q:${q.key}`] ? `${questionId(q.key)}-error` : undefined"
        :data-question="q.key"
      />
      <p v-if="errors[`q:${q.key}`]" :id="`${questionId(q.key)}-error`" class="text-sm text-danger-700">{{ errors[`q:${q.key}`] }}</p>
    </div>

    <!-- The honeypot (D-AP5): out of sight, out of the tab order and out of the accessibility tree, so no person
         fills it; a form-filling bot does. Its label says what to do in case anything ever shows it. -->
    <div class="absolute -left-[10000px] h-px w-px overflow-hidden" aria-hidden="true">
      <label :for="fieldId('hp')">{{ copy.honeypot }}</label>
      <BaseInput :id="fieldId('hp')" v-model="form.honeypot" :name="APPLY_HONEYPOT_FIELD" type="text" tabindex="-1" autocomplete="off" />
    </div>

    <fieldset class="space-y-2 rounded-surface border border-edge p-4" data-sms-box>
      <legend class="px-1 text-sm font-semibold text-ink">{{ copy.smsHeading }}</legend>
      <BaseCheckbox v-model="form.smsOptIn" data-sms-opt-in :aria-describedby="fieldId('sms-words')">
        <span class="font-medium text-ink">{{ job.consent.title }}</span>
      </BaseCheckbox>
      <p :id="fieldId('sms-words')" class="whitespace-pre-line text-sm leading-relaxed text-ink-secondary" data-sms-words>{{ job.consent.body }}</p>
      <p class="text-sm text-ink-muted">
        <a :href="legal.smsTerms" target="_blank" rel="noopener" class="inline-flex min-h-11 items-center text-link underline hover:text-link-hover">{{ copy.smsTerms }}</a>
        <span aria-hidden="true"> · </span>
        <a :href="legal.privacy" target="_blank" rel="noopener" class="inline-flex min-h-11 items-center text-link underline hover:text-link-hover">{{ copy.privacy }}</a>
        <span class="sr-only"> {{ copy.opensNewTab }}</span>
      </p>
    </fieldset>

    <TurnstileBox v-if="job.turnstileSiteKey" ref="turnstile" :site-key="job.turnstileSiteKey" @token="turnstileToken = $event" />

    <p v-if="failed" class="text-sm text-danger-700" role="alert" data-send-failed>{{ failed }}</p>
    <BaseButton type="submit" variant="primary" :disabled="sending" data-send>
      {{ sending ? copy.sending : copy.send }}
    </BaseButton>
  </form>
</template>
