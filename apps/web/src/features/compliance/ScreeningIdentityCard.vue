<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { dateOfBirthIssue, type DriverDetail } from "@fuelguard/shared";
import { AppCard as BaseCard } from "@fuelguard/ui";
import { AppButton as BaseButton } from "@fuelguard/ui";
import { AppDateField } from "@fuelguard/ui";
import { AppFormField as FormField } from "@fuelguard/ui";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { useUpdateDriverProfile } from "@/composables/useDrivers";

/**
 * The four values a driver-screening lookup matches on (PSP-PLAN.md P0).
 *
 * WHY THIS CARD EXISTS. FMCSA PSP matches last name, licence number, licence state and DATE OF BIRTH
 * — all four, exactly (guide v3.9 §8.1) — and a SambaSafety MVR and a §382.701 Clearinghouse query
 * need the same identity. On 2026-08-19 the roster held a licence for 166 of 266 drivers and a date
 * of birth for **none**, because the field is in the API contract and the database and has never had
 * a place in the UI. Nothing could be screened, and no page said why.
 *
 * So the card is diagnostic first and a form second: it names what is missing before it offers the
 * input, on the driver's qualification file where somebody is already asking whether this person may
 * drive. Licence number and state are shown read-only — the Samsara sync owns them (D6, enrich-never-
 * clobber) and this is not the surface to fight it from; a wrong licence is a roster edit.
 *
 * The write goes through `PATCH /api/roster/drivers/:id` rather than PostgREST, so it is validated
 * against `driverUpdateSchema` and audited. `date_of_birth` is deliberately NOT in the route's
 * `AUDITED_VALUE_FIELDS`: the audit row records that the field was edited, never the value, because
 * a personal-file value copied into a log every admin can read is a second, less protected copy of
 * the driver's file.
 */
const props = defineProps<{ driver: DriverDetail | null }>();

const session = useSessionStore();
const toast = useToastStore();
const save = useUpdateDriverProfile();

const dob = ref("");
const editing = ref(false);
// Reset the field whenever the driver loads or changes — a stale draft on a different person is the
// one mistake this form must not make.
watch(
  () => props.driver?.id,
  () => {
    dob.value = props.driver?.date_of_birth ?? "";
    editing.value = false;
  },
  { immediate: true },
);

const today = new Date().toISOString().slice(0, 10);
const error = computed(() => (dob.value ? dateOfBirthIssue(dob.value, today) : null));

/** What is still missing before this driver can be screened at all. Named, not counted. */
const missing = computed(() => {
  const d = props.driver;
  if (!d) return [];
  const gaps: string[] = [];
  if (!d.date_of_birth) gaps.push("date of birth");
  if (!d.cdl_number) gaps.push("licence number");
  if (!d.cdl_state) gaps.push("licence state");
  return gaps;
});

const showForm = computed(() => editing.value || !props.driver?.date_of_birth);

async function submit(): Promise<void> {
  if (!props.driver || error.value) return;
  try {
    await save.mutateAsync({ id: props.driver.id, input: { date_of_birth: dob.value || null } });
    editing.value = false;
    toast.success("Date of birth saved");
  } catch (e) {
    toast.error("Could not save the date of birth", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <BaseCard v-if="driver">
    <div class="flex items-start justify-between gap-4">
      <div>
        <h3 class="text-sm font-semibold text-ink">Screening identity</h3>
        <p class="mt-1 text-sm text-ink-muted">
          <template v-if="missing.length">
            A driving-record lookup matches on all four of last name, licence number, licence state
            and date of birth. This driver is missing
            {{ missing.length === 1 ? "a" : "" }} {{ missing.join(", ") }}.
          </template>
          <template v-else>
            Complete — this driver can be screened against a driving record.
          </template>
        </p>
      </div>
      <BaseButton
        v-if="session.canManage && driver.date_of_birth && !editing"
        variant="ghost"
        @click="editing = true"
      >
        Edit
      </BaseButton>
    </div>

    <dl class="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
      <div>
        <dt class="text-ink-muted">Licence number</dt>
        <dd class="font-medium" :class="driver.cdl_number ? 'text-ink' : 'text-ink-muted'">
          {{ driver.cdl_number ?? "Not recorded" }}
        </dd>
      </div>
      <div>
        <dt class="text-ink-muted">Licence state</dt>
        <dd class="font-medium" :class="driver.cdl_state ? 'text-ink' : 'text-ink-muted'">
          {{ driver.cdl_state ?? "Not recorded" }}
        </dd>
      </div>
      <div v-if="!showForm">
        <dt class="text-ink-muted">Date of birth</dt>
        <dd class="font-medium text-ink">{{ driver.date_of_birth }}</dd>
      </div>
    </dl>

    <form v-if="showForm && session.canManage" class="mt-4 space-y-3" @submit.prevent="submit">
      <FormField v-slot="{ id }" label="Date of birth" :error="error ?? undefined">
        <AppDateField :id="id" v-model="dob" :invalid="Boolean(error)" />
      </FormField>
      <div class="flex justify-end gap-3">
        <BaseButton v-if="editing" type="button" @click="editing = false">Cancel</BaseButton>
        <BaseButton
          type="submit"
          variant="primary"
          :disabled="!dob || Boolean(error) || save.isPending.value"
        >
          {{ save.isPending.value ? "Saving…" : "Save" }}
        </BaseButton>
      </div>
    </form>
    <p v-else-if="showForm" class="mt-4 text-sm text-ink-muted">
      A fleet manager can add the missing date of birth.
    </p>
  </BaseCard>
</template>
