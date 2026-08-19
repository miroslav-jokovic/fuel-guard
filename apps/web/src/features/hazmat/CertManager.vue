<script setup lang="ts">
import { computed, reactive, toRef } from "vue";
import type { CertificationCreateRequest, CertificationRow, CertificationKind } from "@fuelguard/shared";
import { HAZMAT_TRAINING_TYPES } from "@fuelguard/shared";
import { AppButton as BaseButton } from "@fuelguard/ui";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { AppInput as BaseInput } from "@fuelguard/ui";
import { AppDateField } from "@fuelguard/ui";
import { AppCheckbox as BaseCheckbox } from "@fuelguard/ui";
import { AppFormField as FormField } from "@fuelguard/ui";
import { AppCombobox as ComboSelect } from "@fuelguard/ui";
import { useToastStore } from "@/stores/toast";
import { useCertificationsQuery, useCreateCertification } from "@/composables/useCompliance";

/** Reusable certifications editor for one subject (a driver, or the carrier organization). */
const props = defineProps<{ subjectType: "driver" | "organization"; subjectId: string }>();
const toast = useToastStore();

const subjectTypeRef = toRef(props, "subjectType");
const subjectIdRef = computed<string | null>(() => props.subjectId);
const { data: certs, isLoading, isError, error: loadError, isFetching, refetch } = useCertificationsQuery(subjectTypeRef, subjectIdRef);
const createCert = useCreateCertification();
const saving = computed(() => createCert.isPending.value);

const DRIVER_KINDS: CertificationKind[] = ["cdl", "medical_card", "endorsement", "hazmat_training", "twic"];
const ORG_KINDS: CertificationKind[] = ["phmsa_registration", "financial_responsibility", "insurance", "hazmat_safety_permit", "security_plan", "operating_authority"];
function labelForKind(k: string): string { return k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()); }
const kindOptions = computed(() => (props.subjectType === "organization" ? ORG_KINDS : DRIVER_KINDS).map((k) => ({ value: k, label: labelForKind(k) })));
const trainingTypeOptions = HAZMAT_TRAINING_TYPES.map((t) => ({ value: t, label: labelForKind(t) }));

// issuingAuthority + the two §172.704(d) fields + notes were accepted by the contract and the table
// from 0127 and capturable nowhere until D7 — this form and RequirementDrawer close that together.
const form = reactive({ kind: "", qualifier: "", trainingType: "", trainingProviderName: "", trainingProviderAddress: "", trainingMaterials: "", trainingCertified: false, identifier: "", issuingAuthority: "", issuedAt: "", effectiveFrom: "", expiresAt: "", notes: "" });
const isEndorsement = computed(() => form.kind === "endorsement");
const isTraining = computed(() => form.kind === "hazmat_training");
function resetForm() { form.kind = ""; form.qualifier = ""; form.trainingType = ""; form.trainingProviderName = ""; form.trainingProviderAddress = ""; form.trainingMaterials = ""; form.trainingCertified = false; form.identifier = ""; form.issuingAuthority = ""; form.issuedAt = ""; form.effectiveFrom = ""; form.expiresAt = ""; form.notes = ""; }

async function submit() {
  if (!form.kind) {
    toast.error("Choose a certification type", "Pick what this record proves before saving it.");
    return;
  }
  const body: CertificationCreateRequest = {
    id: crypto.randomUUID(),
    subjectType: props.subjectType,
    subjectId: props.subjectId,
    kind: form.kind as CertificationKind,
    qualifier: isEndorsement.value ? (form.qualifier.trim().toUpperCase() || null) : null,
    trainingType: isTraining.value ? (form.trainingType as (typeof HAZMAT_TRAINING_TYPES)[number]) : null,
    trainingProviderName: isTraining.value ? (form.trainingProviderName.trim() || null) : null,
    trainingProviderAddress: isTraining.value ? (form.trainingProviderAddress.trim() || null) : null,
    trainingMaterials: isTraining.value ? (form.trainingMaterials.trim() || null) : null,
    trainingCertified: isTraining.value ? form.trainingCertified : null,
    identifier: form.identifier.trim() || null,
    issuingAuthority: form.issuingAuthority.trim() || null,
    issuedAt: form.issuedAt || null,
    effectiveFrom: form.effectiveFrom || null,
    expiresAt: form.expiresAt || null,
    notes: form.notes.trim() || null,
  };
  try {
    const r = await createCert.mutateAsync(body);
    toast.success("Certification saved", r.supersededId ? "Replaced the previous current record." : undefined);
    resetForm();
  } catch (e) {
    toast.error("Could not save the certification", e instanceof Error ? e.message : undefined);
  }
}

const today = new Date().toISOString().slice(0, 10);

function statusOf(c: CertificationRow): { label: string; tone: string } {
  if (!c.expires_at) return { label: "no expiry", tone: "neutral" };
  const exp = c.expires_at.slice(0, 10);
  if (exp < today) return { label: "expired", tone: "danger" };
  const soon = new Date(today + "T00:00:00.000Z");
  soon.setUTCDate(soon.getUTCDate() + 30);
  if (exp <= soon.toISOString().slice(0, 10)) return { label: "due soon", tone: "warning" };
  return { label: "valid", tone: "success" };
}

const columns: DataTableColumn[] = [
  { key: "kind", label: "Type", headerClass: "min-w-[10rem]", cellClass: "font-medium text-ink" },
  { key: "qualifier", label: "Qualifier", headerClass: "min-w-[9rem]", cellClass: "text-ink-secondary" },
  { key: "expires_at", label: "Expires", headerClass: "w-32", cellClass: "text-ink-secondary" },
  { key: "status", label: "Status", headerClass: "w-32" },
];
</script>

<template>
  <div class="space-y-6">
    <div>
      <h3 class="text-sm font-semibold text-ink">Current records</h3>
      <div class="mt-3">
        <DataTable
          :columns="columns"
          :rows="certs ?? []"
          row-key="id"
          :loading="isLoading"
          :error="isError ? (loadError?.message ?? 'Could not load certifications.') : null"
          :retrying="isFetching"
          :sticky-header="false"
          empty-text="No records on file yet."
          @retry="refetch"
        >
          <template #cell-kind="{ row }">{{ labelForKind(row.kind) }}</template>
          <template #cell-qualifier="{ row }">
            <span v-if="row.qualifier">{{ row.qualifier }}</span>
            <span v-else-if="row.training_type">{{ labelForKind(row.training_type) }}</span>
            <span v-else class="text-ink-tertiary">—</span>
          </template>
          <template #cell-expires_at="{ row }">
            <span v-if="row.expires_at">{{ row.expires_at }}</span>
            <span v-else class="text-ink-tertiary">—</span>
          </template>
          <template #cell-status="{ row }">
            <span :class="[BADGE_BASE, toneClass(statusOf(row).tone)]">{{ statusOf(row).label }}</span>
          </template>
        </DataTable>
      </div>
    </div>

    <div class="border-t border-edge pt-5">
      <h3 class="text-sm font-semibold text-ink">Add record</h3>
      <div class="mt-3 space-y-4">
        <FormField v-slot="{ id }" label="Type">
          <ComboSelect :id="id" v-model="form.kind" :options="kindOptions" placeholder="Certification type…" />
        </FormField>
        <FormField v-if="isEndorsement" v-slot="{ id }" label="Endorsement letter" hint="H or X for hazmat; N or X for cargo tank.">
          <BaseInput :id="id" v-model="form.qualifier" placeholder="H" />
        </FormField>
        <FormField v-if="isTraining" v-slot="{ id }" label="Training type">
          <ComboSelect :id="id" v-model="form.trainingType" :options="trainingTypeOptions" placeholder="Training type…" />
        </FormField>
        <FormField v-if="isTraining" v-slot="{ id }" label="Training provider">
          <BaseInput :id="id" v-model="form.trainingProviderName" placeholder="Provider name" />
        </FormField>
        <FormField v-if="isTraining" v-slot="{ id }" label="Provider address" hint="§172.704(d) requires it on the record.">
          <BaseInput :id="id" v-model="form.trainingProviderAddress" placeholder="Street, city, state" />
        </FormField>
        <FormField v-if="isTraining" v-slot="{ id }" label="Training materials" hint="Description or location of the materials used (§172.704(d)).">
          <BaseInput :id="id" v-model="form.trainingMaterials" placeholder="Course name, manual, module…" />
        </FormField>
        <FormField v-slot="{ id }" label="Identifier" hint="Licence / policy / certificate number (optional).">
          <BaseInput :id="id" v-model="form.identifier" placeholder="Optional" />
        </FormField>
        <FormField v-slot="{ id }" label="Issuing authority" hint="Optional.">
          <BaseInput :id="id" v-model="form.issuingAuthority" placeholder="Optional" />
        </FormField>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField v-slot="{ id }" label="Issued"><AppDateField :id="id" v-model="form.issuedAt" /></FormField>
          <FormField v-slot="{ id }" label="Effective from" hint="Defaults to today."><AppDateField :id="id" v-model="form.effectiveFrom" /></FormField>
          <FormField v-slot="{ id }" label="Expires"><AppDateField :id="id" v-model="form.expiresAt" /></FormField>
        </div>
        <BaseCheckbox v-if="isTraining" v-model="form.trainingCertified">
          I certify this training record is complete (§172.704(d)).
        </BaseCheckbox>
        <FormField v-slot="{ id }" label="Notes" hint="Optional.">
          <BaseInput :id="id" v-model="form.notes" placeholder="Optional" />
        </FormField>
        <div>
          <BaseButton variant="primary" :disabled="saving" @click="submit">
            {{ saving ? "Saving…" : "Add record" }}
          </BaseButton>
        </div>
      </div>
    </div>
  </div>
</template>
