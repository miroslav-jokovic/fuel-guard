<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import {
  AppButton as BaseButton,
  AppCombobox as ComboSelect,
  AppDateField,
  AppFormField as FormField,
  AppInput as BaseInput,
} from "@silvicom/ui";
import { applicantIdentitySchema, jurisdictionOptions, rolesThatManage } from "@silvicom/shared";
import { formatDate } from "@/lib/format";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { useCorrectApplicantIdentity } from "@/features/recruitment/useApplicantIdentity";

/**
 * The applicant's date of birth and licence, as the office sees and corrects them (AF3, D-AF8).
 *
 * ── WHY IT LIVES IN THE PERMISSIONS DRAWER ────────────────────────────────────────────────────
 * The applicant gives these on the same visit as the permissions (D-AF1), and they are what the
 * next three steps — PSP, the driving record, the Clearinghouse query — are run on. The office
 * looking at "permissions signed" is the office about to order those, so this is where a typo in a
 * licence number is caught: before money is spent on a PSP report for somebody else's licence.
 *
 * ── WHY A CORRECTION OVERWRITES, AND WHY IT GOES THROUGH THE SERVER'S ONE WRITER ──────────────
 * The applicant's own entry is fill-only; the office's is not. It is the one place the licence may
 * be CHANGED once given, and it changes `drivers` and the applicant's draft together, so the licence
 * screening runs on and the licence on the filed application cannot come apart. `PATCH` on the
 * driver row would change one of the two, which is the drift D-AF8 exists to remove.
 *
 * ⚠ `rolesThatManage("recruitment")`, the same test `ApplicationInviteCard` applies and the route
 * enforces. A reader sees the values and no button.
 */
const props = defineProps<{
  invitationId: string;
  driverId: string;
  identity: { date_of_birth?: string | null; cdl_number?: string | null; cdl_state?: string | null } | null;
}>();

const session = useSessionStore();
const toast = useToastStore();
const correct = useCorrectApplicantIdentity();
const JURISDICTIONS = jurisdictionOptions();

const canCorrect = computed(() => Boolean(session.role) && rolesThatManage("recruitment").includes(session.role!));
const editing = ref(false);
const form = reactive({ date_of_birth: "", cdl_number: "", cdl_state: "" });
const errors = ref<Partial<Record<keyof typeof form, string>>>({});

const onFile = computed(() => Boolean(props.identity?.date_of_birth && props.identity.cdl_number && props.identity.cdl_state));

function startEditing(): void {
  form.date_of_birth = props.identity?.date_of_birth ?? "";
  form.cdl_number = props.identity?.cdl_number ?? "";
  form.cdl_state = props.identity?.cdl_state ?? "";
  errors.value = {};
  editing.value = true;
}

// The drawer swaps applicants without unmounting; a half-typed correction must not carry over.
watch(() => props.invitationId, () => { editing.value = false; });

async function save(): Promise<void> {
  const parsed = applicantIdentitySchema.safeParse(form);
  if (!parsed.success) {
    const next: Partial<Record<keyof typeof form, string>> = {};
    for (const issue of parsed.error.issues) next[issue.path[0] as keyof typeof form] ??= issue.message;
    errors.value = next;
    return;
  }
  try {
    await correct.mutateAsync({ invitationId: props.invitationId, driverId: props.driverId, identity: parsed.data });
    editing.value = false;
    toast.success("Licence details corrected");
  } catch (e) {
    toast.error("Could not correct the licence details", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <section class="space-y-3 border-t border-edge pt-4">
    <div>
      <h3 class="text-xs font-semibold text-ink">Date of birth and licence</h3>
      <p class="mt-0.5 text-2xs text-ink-muted">
        PSP, the driving record and the Clearinghouse query run on these. A correction changes the
        applicant's record and their application together.
      </p>
    </div>

    <template v-if="!editing">
      <dl v-if="onFile" class="grid grid-cols-3 gap-3 text-xs">
        <div><dt class="text-ink-muted">Date of birth</dt><dd class="text-ink">{{ formatDate(identity?.date_of_birth) }}</dd></div>
        <div><dt class="text-ink-muted">Licence number</dt><dd class="font-mono text-ink">{{ identity?.cdl_number }}</dd></div>
        <div><dt class="text-ink-muted">State</dt><dd class="text-ink">{{ identity?.cdl_state }}</dd></div>
      </dl>
      <p v-else class="text-xs text-ink-muted">Not given yet. The applicant enters these before signing.</p>
      <BaseButton v-if="canCorrect" size="sm" variant="secondary" @click="startEditing">
        {{ onFile ? "Correct" : "Enter them" }}
      </BaseButton>
    </template>

    <template v-else>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FormField id="correct-dob" label="Date of birth" :error="errors.date_of_birth">
          <template #default="f">
            <AppDateField v-bind="f" v-model="form.date_of_birth" :invalid="Boolean(errors.date_of_birth)" />
          </template>
        </FormField>
        <FormField id="correct-number" label="Licence number" :error="errors.cdl_number">
          <template #default="f"><BaseInput v-bind="f" v-model="form.cdl_number" autocomplete="off" /></template>
        </FormField>
        <FormField id="correct-state" label="State" :error="errors.cdl_state">
          <template #default="f"><ComboSelect v-bind="f" v-model="form.cdl_state" :options="JURISDICTIONS" /></template>
        </FormField>
      </div>
      <div class="flex justify-end gap-2">
        <BaseButton size="sm" variant="ghost" @click="editing = false">Cancel</BaseButton>
        <BaseButton size="sm" variant="primary" :disabled="correct.isPending.value" @click="save">Save</BaseButton>
      </div>
    </template>
  </section>
</template>
