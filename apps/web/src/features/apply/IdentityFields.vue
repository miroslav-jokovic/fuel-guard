<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import {
  AppButton as BaseButton,
  AppCallout,
  AppCombobox as ComboSelect,
  AppDateField,
  AppFormField as FormField,
  AppInput as BaseInput,
} from "@silvicom/ui";
import {
  applicantIdentitySchema,
  jurisdictionOptions,
  type ApplicationCaptureSlot,
  type ApplicationCaptureView,
} from "@silvicom/shared";
import DocumentCaptureFields from "@/features/apply/DocumentCaptureFields.vue";
import { recordApplicantIdentity } from "@/features/apply/useApplication";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * The date of birth and licence, taken with the permissions (AF3, D-AF1).
 *
 * ── WHY THIS COMES BEFORE THE PERMISSIONS AND NOT IN THE FORM ─────────────────────────────────
 * The carrier orders PSP, the driving record and the Clearinghouse query BEFORE it sends the
 * application (the owner's order, 2026-09-24), and PSP is matched on exactly these three facts. When
 * they arrived only with the filed application, the office could not screen anybody it had not
 * already asked to fill in the whole form. So they are asked here, once, and the form later shows
 * them and does not let them be retyped (D-AF8: one writer).
 *
 * ── VALIDATED WITH THE SERVER'S SCHEMA, RUN HERE ──────────────────────────────────────────────
 * `applicantIdentitySchema` is what `POST /:token/identity` validates with. Running it before the
 * request turns a 400 into a sentence beside the field, and the two cannot disagree.
 *
 * ── THE PHOTOGRAPHS ARE OPTIONAL, FOR THE DOCUMENTS SCREEN'S REASON ───────────────────────────
 * A driver whose camera will not open must still be able to go on; the office can ask for a picture
 * by email. The licence NUMBER is what screening runs on, and that is not optional.
 */
const props = defineProps<{ token: string; carrier: string; captures: ApplicationCaptureView[] }>();
const emit = defineEmits<{ done: [] }>();

const copy = APPLY_COPY.identityStep;
const JURISDICTIONS = jurisdictionOptions();
const LICENCE_SIDES: readonly ApplicationCaptureSlot[] = ["cdl_front", "cdl_back"];

const form = reactive({ date_of_birth: "", cdl_number: "", cdl_state: "" });
const errors = ref<Partial<Record<keyof typeof form, string>>>({});
const working = ref(false);
const failed = ref(false);
const kept = ref(false);

const canSend = computed(() => !working.value);

async function send(): Promise<void> {
  failed.value = false;
  const parsed = applicantIdentitySchema.safeParse(form);
  if (!parsed.success) {
    const next: Partial<Record<keyof typeof form, string>> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof typeof form;
      // A blank field gets a sentence; a filled one keeps the rule that refused it (under 18, not a
      // real date, too long) — that is the part the applicant can act on.
      next[key] ??= form[key].trim() === "" ? copy.missing[key] : issue.message;
    }
    errors.value = next;
    return;
  }
  errors.value = {};
  working.value = true;
  try {
    const result = await recordApplicantIdentity(props.token, parsed.data);
    // Fill-only on the server: a value the carrier already held wins. Said once, before moving on,
    // rather than silently — the applicant typed something that was not used.
    if (result.keptExisting.length > 0 && !kept.value) {
      kept.value = true;
      return;
    }
    emit("done");
  } catch {
    failed.value = true;
  } finally {
    working.value = false;
  }
}
</script>

<template>
  <section class="space-y-5">
    <div>
      <h1 class="text-lg font-semibold text-ink">{{ copy.heading }}</h1>
      <p class="mt-2 text-sm text-ink-muted">{{ copy.intro(carrier) }}</p>
    </div>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <FormField id="identity-dob" :label="copy.dateOfBirth" :error="errors.date_of_birth">
        <template #default="f">
          <AppDateField v-bind="f" v-model="form.date_of_birth" :invalid="Boolean(errors.date_of_birth)" />
        </template>
      </FormField>
      <FormField id="identity-number" :label="copy.number" :error="errors.cdl_number">
        <template #default="f">
          <BaseInput v-bind="f" v-model="form.cdl_number" autocomplete="off" />
        </template>
      </FormField>
      <FormField id="identity-state" :label="copy.state" :hint="copy.stateHint" :error="errors.cdl_state">
        <template #default="f">
          <ComboSelect v-bind="f" v-model="form.cdl_state" :options="JURISDICTIONS" />
        </template>
      </FormField>
    </div>

    <div class="space-y-2">
      <h2 class="text-sm font-semibold text-ink">{{ copy.photosHeading }}</h2>
      <p class="text-sm text-ink-muted">{{ copy.photosIntro }}</p>
      <DocumentCaptureFields :token="token" :captures="captures" :only="LICENCE_SIDES" />
    </div>

    <AppCallout v-if="kept" tone="info">{{ copy.kept(carrier) }}</AppCallout>
    <p v-if="failed" class="text-sm text-danger-700" role="alert">{{ copy.failed }}</p>

    <div class="flex justify-end">
      <BaseButton variant="primary" :disabled="!canSend" @click="kept ? emit('done') : send()">
        {{ working ? copy.working : copy.action }}
      </BaseButton>
    </div>
  </section>
</template>
