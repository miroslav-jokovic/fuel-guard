<script setup lang="ts">
import { computed, reactive } from "vue";
import {
  MESSAGE_PART_LIMITS,
  STANDARD_WORDING,
  messagePartIssue,
  recruitingMessage,
  renderApplicantEmail,
  renderApplicantText,
  resolveMessageParts,
  textMessageParts,
  type MessageWording,
  type RecruitingMessageKey,
} from "@silvicom/shared";
import { AppButton as BaseButton, AppFormField as FormField, AppInput as BaseInput, AppTextarea } from "@silvicom/ui";

/**
 * One message's wording, with its preview (HIRING-WORKFLOW-AUDIT §12 MT2, D-MT2/D-MT7).
 *
 * The four parts a carrier may write; each field is empty for "the standard words" and shows those
 * words as its placeholder, from the catalogue (`standardParts`) — never typed here. The preview is
 * `renderApplicantEmail` / `renderApplicantText`, the functions the API sends with, on a sample name
 * and link, so what this shows is what the applicant gets. The fixed pieces (link, expiry, STOP) appear
 * in the preview and nowhere in the form, which is the point: they are not the carrier's to change.
 *
 * The rules (placeholders, one line, GSM-7) are `messagePartIssue`, the very check the PUT runs.
 */
const props = defineProps<{ messageKey: RecruitingMessageKey; saved: MessageWording; carrier: string; days: number; saving: boolean }>();
const emit = defineEmits<{ save: [wording: MessageWording]; cancel: [] }>();

const message = computed(() => recruitingMessage(props.messageKey));
const SAMPLE_LINK = `${typeof window === "undefined" ? "https://example.com" : window.location.origin}/apply/sample-link`;
const sampleVars = computed(() => ({
  carrier: props.carrier,
  firstName: "Pat",
  days: message.value.placeholders.includes("days") ? props.days : null,
}));
const standard = computed(() => resolveMessageParts(props.messageKey, sampleVars.value));
/** §12 MT3: the trip message's preview needs a trip; the others ignore it. */
const SAMPLE = { trip: { mode: "Bus", leaves: "11/10/2026 8:00 AM CST", arrives: "11/10/2026 2:30 PM CST", confirmation: "ABC123" } };

const form = reactive({
  emailSubject: props.saved.emailSubject ?? "",
  emailHeading: props.saved.emailHeading ?? "",
  emailParagraph: props.saved.emailParagraph ?? "",
  textLead: props.saved.textLead ?? "",
});
const PARTS = ["emailSubject", "emailHeading", "emailParagraph", "textLead"] as const;

const wording = computed<MessageWording>(() => {
  const out = { ...STANDARD_WORDING };
  for (const p of PARTS) out[p] = form[p].trim() === "" ? null : form[p].trim();
  return out;
});
const issues = computed(() => Object.fromEntries(PARTS.map((p) => {
  const v = wording.value[p];
  return [p, v === null ? null : messagePartIssue(props.messageKey, p, v)];
})) as Record<(typeof PARTS)[number], string | null>);
const valid = computed(() => PARTS.every((p) => issues.value[p] === null));

const email = computed(() => renderApplicantEmail(props.messageKey, sampleVars.value, SAMPLE_LINK, wording.value, SAMPLE));
const text = computed(() => renderApplicantText(props.messageKey, sampleVars.value, SAMPLE_LINK, wording.value, SAMPLE));
const parts = computed(() => textMessageParts(text.value));
const placeholders = computed(() => message.value.placeholders.map((p) => `{${p}}`).join(" "));
</script>

<template>
  <div class="space-y-4" :data-testid="`message-editor-${messageKey}`">
    <p class="text-xs text-ink-secondary">
      Leave a field empty to use the standard words shown in it. You can use {{ placeholders }} — {first_name} is the
      applicant's first name, or "there" when we do not have it. What the message is for — the link and how long it works, or the trip — and the STOP line are always added for you.
    </p>
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div class="space-y-3">
        <FormField v-slot="{ id }" label="Email subject" :error="issues.emailSubject ?? undefined">
          <BaseInput :id="id" v-model="form.emailSubject" :placeholder="standard.emailSubject" :maxlength="MESSAGE_PART_LIMITS.emailSubject" data-testid="part-emailSubject" />
        </FormField>
        <FormField v-slot="{ id }" label="Email heading" :error="issues.emailHeading ?? undefined">
          <BaseInput :id="id" v-model="form.emailHeading" :placeholder="standard.emailHeading ?? 'No heading'" :maxlength="MESSAGE_PART_LIMITS.emailHeading" data-testid="part-emailHeading" />
        </FormField>
        <FormField v-slot="{ id }" label="Email paragraph" :error="issues.emailParagraph ?? undefined">
          <AppTextarea :id="id" v-model="form.emailParagraph" :rows="4" :placeholder="standard.emailParagraph" :maxlength="MESSAGE_PART_LIMITS.emailParagraph" data-testid="part-emailParagraph" />
        </FormField>
        <FormField v-slot="{ id }" label="Text message, first sentence" hint="The link follows it." :error="issues.textLead ?? undefined">
          <BaseInput :id="id" v-model="form.textLead" :placeholder="standard.textLead" :maxlength="MESSAGE_PART_LIMITS.textLead" data-testid="part-textLead" />
        </FormField>
        <div class="flex gap-2">
          <BaseButton variant="primary" size="sm" :disabled="!valid || saving" data-testid="message-save" @click="emit('save', wording)">
            {{ saving ? "Saving…" : "Save" }}
          </BaseButton>
          <BaseButton variant="ghost" size="sm" :disabled="saving" @click="emit('cancel')">Cancel</BaseButton>
        </div>
      </div>
      <div class="space-y-3" data-testid="message-preview">
        <h4 class="text-xs font-semibold uppercase tracking-wide text-ink-secondary">Preview, for an applicant named Pat</h4>
        <div class="rounded-surface bg-surface-subtle p-3 ring-1 ring-edge">
          <p class="text-xs text-ink-secondary">Email</p>
          <p class="text-sm font-semibold text-ink" data-testid="preview-subject">{{ email.subject }}</p>
          <p class="mt-2 whitespace-pre-wrap text-sm text-ink" data-testid="preview-email">{{ email.text }}</p>
        </div>
        <div class="rounded-surface bg-surface-subtle p-3 ring-1 ring-edge">
          <p class="text-xs text-ink-secondary">
            Text message · {{ parts === 1 ? "1 part" : `${parts} parts` }}
          </p>
          <p class="mt-1 whitespace-pre-wrap text-sm text-ink" data-testid="preview-text">{{ text }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
