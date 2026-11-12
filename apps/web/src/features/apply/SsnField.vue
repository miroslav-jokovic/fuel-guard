<script setup lang="ts">
import { ref } from "vue";
import { AppButton as BaseButton, AppFormField as FormField, AppInput as BaseInput } from "@silvicom/ui";
import { applicantSsnSchema } from "@silvicom/shared";
import type { ApplicationDraft } from "@/features/apply/draft";
import { saveApplicantSsn } from "@/features/apply/ssnApi";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * §391.21(b)(2)'s Social Security number, asked in the form (Q-AM3, owner 2026-11-11; 0589).
 *
 * ── SAVED ON ITS OWN, AT A PRESS ──────────────────────────────────────────────────────────────
 * It never enters the draft (`toDraftPayload` leaves it out, the server refuses it there, D-APP3): it is
 * posted to its own route and held sealed (`application_ssns`), so the office can review it and filing
 * takes it from there. A press, not autosave, because the driver should know when nine digits leave the
 * phone — and the typed digits are cleared once saved, so the page holds them no longer than it must.
 *
 * Shown again at sign-off (`SignOffFields`), so a driver who skipped it on "About you" can still give
 * it; the same control in both places. What the page knows afterwards is the last four (`ssn_on_file`).
 */
const props = defineProps<{ token: string; id: string }>();
const draft = defineModel<ApplicationDraft>({ required: true });
const copy = APPLY_COPY.identity;

const changing = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);

async function save(): Promise<void> {
  error.value = null;
  const parsed = applicantSsnSchema.safeParse({ ssn: draft.value.ssn });
  if (!parsed.success) {
    error.value = copy.ssnInvalid;
    return;
  }
  saving.value = true;
  try {
    const saved = await saveApplicantSsn(props.token, parsed.data.ssn);
    draft.value.ssn_on_file = saved.last4;
    draft.value.ssn = "";
    changing.value = false;
  } catch {
    error.value = copy.ssnFailed;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="space-y-2" data-ssn-field>
    <div v-if="draft.ssn_on_file && !changing" class="flex flex-wrap items-center gap-3">
      <p class="text-sm text-ink">
        <span class="text-ink-muted">{{ copy.ssn }}:</span> {{ copy.ssnSaved(draft.ssn_on_file) }}
      </p>
      <BaseButton variant="link" @click="changing = true">{{ copy.ssnChange }}</BaseButton>
    </div>
    <template v-else>
      <FormField :id="id" :label="copy.ssn" :hint="copy.ssnHint" :error="error ?? undefined">
        <template #default="f">
          <BaseInput v-bind="f" v-model="draft.ssn" inputmode="numeric" autocomplete="off" />
        </template>
      </FormField>
      <BaseButton variant="secondary" :disabled="saving" @click="save">
        {{ saving ? copy.ssnSaving : copy.ssnSave }}
      </BaseButton>
    </template>
  </div>
</template>
