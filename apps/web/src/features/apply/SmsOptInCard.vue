<script setup lang="ts">
import { computed, ref, toRef } from "vue";
import {
  AppBadge,
  AppButton as BaseButton,
  AppCheckbox as BaseCheckbox,
  AppFormField as FormField,
  AppIcon,
  AppInput as BaseInput,
} from "@silvicom/ui";
import { CheckCircleIcon } from "@silvicom/ui/icons";
import { SMS_MAX_NUMBERS_PER_LINK, normaliseUsPhone, type SmsConfirmation } from "@silvicom/shared";
import { SMS_PRIVACY_PATH, SMS_TERMS_PATH } from "@/lib/legalPaths";
import { useSmsOptIn } from "@/features/apply/useSmsOptIn";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * The optional agreement to be texted, on the applicant's waiting screens (SMS-OPT-IN-PLAN SMS2).
 *
 * ── WHERE IT SITS, AND WHY THAT IS THE LEGAL POINT ────────────────────────────────────────────
 * Under a screen that already says "nothing more to do for now" — never as a step. 47 CFR
 * §64.1200(f)(9)(i)(B) forbids making it a condition of anything, and a carrier reviewing the opt-in
 * screenshot rejects one that is required, pre-ticked or bundled with other terms (D-SMS1, D-SMS2).
 * So: the box starts unticked, the consent is shown in full beside it and nowhere else, the heading
 * says "Optional", and there is no Continue button anywhere on it — declining is not doing anything.
 *
 * ── WHAT IS SHOWN IS WHAT IS STORED ──────────────────────────────────────────────────────────
 * The body and the intent are the server's composed document, the same words `recordSmsConsent`
 * writes onto the row. The page adds a frame and two links; it never paraphrases the instrument.
 *
 * ── THE NUMBER IS TYPED, NOT OFFERED (D-SMS3) ─────────────────────────────────────────────────
 * `autocomplete="tel"` makes it one tap on most phones. The number on file is never served here:
 * consent attaches to a number the person gave, and the link is not a place for personal data.
 *
 * Renders nothing until the server says it may be offered — `offered` is false while the wording is
 * draft (D-SMS8) — and nothing on a failed read, because an offer that cannot load is simply absent.
 */
const props = defineProps<{ token: string; carrier: string }>();
const copy = APPLY_COPY.sms;

const { query, agree, withdraw } = useSmsOptIn(toRef(props, "token"));
const card = computed(() => (query.data.value?.status?.offered ? query.data.value : null));
const state = computed(() => card.value?.status.state ?? "none");

const phone = ref("");
const ticked = ref(false);
const touched = ref(false);
const confirmation = ref<SmsConfirmation>(null);
/** What went wrong, in the card's words — null while nothing has. */
const failed = ref<string | null>(null);

/** The server refuses a number for two reasons worth naming (G-2); anything else is the generic line. */
const REFUSALS: Record<string, string> = {
  number_stopped: copy.numberStopped,
  too_many_numbers: copy.tooManyNumbers(SMS_MAX_NUMBERS_PER_LINK),
};

// The same US-only rule the server applies when agreeing (`normaliseUsPhone`, G-2).
const phoneValid = computed(() => normaliseUsPhone(phone.value) !== null);
const phoneError = computed(() => (touched.value && phone.value !== "" && !phoneValid.value ? copy.phoneInvalid : undefined));
const canSubmit = computed(() => ticked.value && phoneValid.value && !agree.isPending.value);

async function turnOn(): Promise<void> {
  touched.value = true;
  if (!canSubmit.value) return;
  failed.value = null;
  try {
    confirmation.value = (await agree.mutateAsync(phone.value)).confirmation;
    [phone.value, ticked.value, touched.value] = ["", false, false];
  } catch (e) {
    failed.value = REFUSALS[(e as { code?: string }).code ?? ""] ?? copy.failed;
  }
}

async function turnOff(): Promise<void> {
  failed.value = null;
  try {
    await withdraw.mutateAsync();
    confirmation.value = null;
  } catch {
    failed.value = copy.failed;
  }
}
</script>

<template>
  <section v-if="card" class="mt-6 space-y-4 border-t border-edge pt-5" aria-labelledby="sms-opt-in-heading">
    <!-- Agreed: what will happen, and the way out, as prominent as the way in was (D-SMS6). -->
    <template v-if="state === 'agreed'">
      <div class="flex items-start gap-2">
        <AppIcon :icon="CheckCircleIcon" class="mt-0.5 size-5 shrink-0 text-brand-600" />
        <div class="space-y-1">
          <h2 id="sms-opt-in-heading" class="text-sm font-semibold text-ink">{{ copy.onHeading }}</h2>
          <p class="text-sm text-ink-muted">{{ copy.onBody(card.status.phoneLast4 ?? "") }}</p>
          <p v-if="confirmation === 'sent'" class="text-sm text-ink-muted">{{ copy.confirmationSent }}</p>
          <p v-else-if="confirmation === 'held'" class="text-sm text-ink-muted">{{ copy.confirmationHeld }}</p>
          <p class="text-xs text-ink-muted">{{ copy.stopHint }}</p>
        </div>
      </div>
      <p v-if="failed" class="text-sm text-danger-700" role="alert">{{ failed }}</p>
      <div class="flex justify-end">
        <BaseButton variant="secondary" size="sm" :disabled="withdraw.isPending.value" @click="turnOff">
          {{ withdraw.isPending.value ? copy.stopping : copy.stop }}
        </BaseButton>
      </div>
    </template>

    <template v-else>
      <div class="space-y-1">
        <div class="flex items-center gap-2">
          <h2 id="sms-opt-in-heading" class="text-sm font-semibold text-ink">
            {{ state === "stopped" ? copy.offHeading : copy.heading }}
          </h2>
          <AppBadge v-if="state !== 'stopped'" tone="neutral">{{ copy.optional }}</AppBadge>
        </div>
        <p class="text-sm text-ink-muted">{{ state === "stopped" ? copy.offBody : copy.intro(carrier) }}</p>
      </div>

      <FormField v-slot="f" :label="copy.phoneLabel" :hint="copy.phoneHint" :error="phoneError">
        <BaseInput
          v-bind="f"
          v-model="phone"
          type="tel"
          inputmode="tel"
          autocomplete="tel"
          class="max-w-xs"
          @blur="touched = true"
        />
      </FormField>

      <!-- The instrument, served, in full — never a summary of it (SmsConsentDocument.body). -->
      <div class="space-y-1">
        <p class="text-xs font-medium text-ink-secondary">{{ copy.consentLabel }}</p>
        <p class="whitespace-pre-line rounded-surface bg-surface-muted p-3 text-xs leading-relaxed text-ink-secondary">
          {{ card.document.body }}
        </p>
        <p class="text-xs text-ink-muted">
          <a :href="SMS_TERMS_PATH" target="_blank" rel="noopener" class="text-link hover:text-link-hover">{{ copy.terms }}</a>
          <span aria-hidden="true"> · </span>
          <a :href="SMS_PRIVACY_PATH" target="_blank" rel="noopener" class="text-link hover:text-link-hover">{{ copy.privacy }}</a>
        </p>
      </div>

      <BaseCheckbox v-model="ticked">{{ card.document.intent }}</BaseCheckbox>

      <p v-if="failed" class="text-sm text-danger-700" role="alert">{{ failed }}</p>
      <div class="flex justify-end">
        <BaseButton variant="secondary" size="sm" :disabled="!canSubmit" @click="turnOn">
          {{ agree.isPending.value ? copy.working : copy.action }}
        </BaseButton>
      </div>
    </template>
  </section>
</template>
