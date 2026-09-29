<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import {
  ROAD_TEST_ITEMS,
  ROAD_TEST_RATINGS,
  ROAD_TEST_RATING_LABELS,
  ROAD_TEST_TRAILER_LABELS,
  ROAD_TEST_TRAILER_TYPES,
  formatDisplayDate,
  formatDisplayDateTime,
  roadTestPassed,
  type RoadTestCertificateCopy,
  type RoadTestItemKey,
  type RoadTestRating,
  type RoadTestTrailerType,
} from "@silvicom/shared";
import {
  AppButton as BaseButton,
  AppCombobox as ComboSelect,
  AppDateField,
  AppFormField as FormField,
  AppInput as BaseInput,
  AppSegmentedControl,
  AppTextarea,
} from "@silvicom/ui";
import SignatoryAddForm from "@/features/recruitment/SignatoryAddForm.vue";
import { useToastStore } from "@/stores/toast";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useQualificationRecordsQuery } from "@/composables/useCompliance";
import {
  useRecordPaperCopy,
  useRecordRoadTest,
  useRoadTestCertificateCopies,
  useRoadTestExaminers,
} from "@/features/recruitment/useRoadTest";

/**
 * The §391.31 road test, recorded where the hire is worked — D2 (`ROAD-TEST-PLAN.md` RT3).
 *
 * ── WHAT THE OFFICE DOES HERE ─────────────────────────────────────────────────────────────────
 * Picks the examiner, the truck and the trailer, rates each of the nine items, gives the general
 * performance, and records it. The API files the carrier's form every time and the certificate only
 * on a pass (`roadTestPassed`, the same predicate the server uses — shown here so the office knows
 * BEFORE pressing what the press will produce).
 *
 * ── THE EXAMINER'S SIGNATURE IS ADDED HERE, ONCE (Q-RT2) ──────────────────────────────────────
 * The owner ruled the examiner's signature is added from the dashboard, as he used to sign on paper.
 * With no examiner on file the panel asks for one first; the filed documents then say who applied
 * the signature, so the office's act is visible on the paper. The form is `SignatoryAddForm`, the one
 * Settings → Recruiting also shows (Q-AW42), where an examiner can be added — and retired — before any
 * driver reaches this step.
 *
 * ── THE DRIVER'S COPY (G-10, Q-AW19, owner 2026-09-29) ───────────────────────────────────────
 * §391.31(g) owes the driver a copy of the certificate. Each certificate on file says whether they have
 * had it — downloaded from their link (RT4), or handed over on paper, which only the office can say,
 * so the office says it here. Nothing else reads it: it is not a hire gate, only a fact on file.
 */
const props = defineProps<{ driverId: string; done: boolean }>();

const toast = useToastStore();
const driverId = computed(() => props.driverId);
const examinersQ = useRoadTestExaminers();
const vehiclesQ = useVehiclesQuery();
const recordsQ = useQualificationRecordsQuery(driverId);
const record = useRecordRoadTest(driverId);

const examiners = computed(() => examinersQ.data.value ?? []);
const examinerOptions = computed(() => examiners.value.map((e) => ({ value: e.id, label: `${e.full_name} — ${e.title}` })));
const truckOptions = computed(() =>
  (vehiclesQ.data.value ?? [])
    .filter((v) => v.status === "active")
    .map((v) => ({ value: v.id, label: [`#${v.unit_number}`, v.year, v.make].filter(Boolean).join(" ") })),
);
const RATING_OPTIONS = ROAD_TEST_RATINGS.map((r) => ({ value: r, label: ROAD_TEST_RATING_LABELS[r] }));
const TRAILER_OPTIONS = ROAD_TEST_TRAILER_TYPES.map((t) => ({ value: t, label: ROAD_TEST_TRAILER_LABELS[t] }));

const filed = computed(() => (recordsQ.data.value ?? []).filter((r) => r.kind === "road_test"));

// ── the driver's copy of each certificate ──────────────────────────────────────────────────────
const copiesQ = useRoadTestCertificateCopies(driverId);
const paperCopy = useRecordPaperCopy(driverId);
/** Only certificates this product issued are listed; a roster-entered road test has no entry. */
const copyOf = (recordId: string): RoadTestCertificateCopy | undefined =>
  (copiesQ.data.value ?? []).find((c) => c.recordId === recordId);
function howGiven(copy: RoadTestCertificateCopy): string {
  const ways: string[] = [];
  if (copy.handedOverAt) ways.push(`paper copy handed over ${formatDisplayDateTime(copy.handedOverAt)}`);
  if (copy.downloadedAt) ways.push(`downloaded from their link ${formatDisplayDateTime(copy.downloadedAt)}`);
  return ways.join("; ");
}
async function handedPaperCopy(recordId: string): Promise<void> {
  try {
    await paperCopy.mutateAsync(recordId);
  } catch (e) {
    toast.error("Could not record the copy", e instanceof Error ? e.message : undefined);
  }
}

// ── the examiner, when none is on file ─────────────────────────────────────────────────────────
const addingExaminer = ref(false);
function examinerAdded(examiner: { id: string }): void {
  form.examinerId = examiner.id;
  addingExaminer.value = false;
}

// ── the test ───────────────────────────────────────────────────────────────────────────────────
const form = reactive({
  examinerId: "",
  vehicleId: "",
  trailerType: "dry_van" as RoadTestTrailerType,
  testedOn: "",
  miles: "",
  general: "" as RoadTestRating | "",
  remarks: "",
  qualifiedFor: "",
});
const items = reactive<Partial<Record<RoadTestItemKey, RoadTestRating>>>({});
const adding = ref(false);

const complete = computed(
  () =>
    Boolean(form.examinerId && form.vehicleId && form.testedOn && form.general) &&
    Number(form.miles) > 0 &&
    ROAD_TEST_ITEMS.every((i) => items[i.key]),
);
/** What pressing Record will file — said before the press, from the server's own predicate. */
const willPass = computed(() =>
  complete.value
    ? roadTestPassed({ items: items as Record<RoadTestItemKey, RoadTestRating>, general_performance: form.general as RoadTestRating })
    : null,
);

async function save(): Promise<void> {
  try {
    const result = await record.mutateAsync({
      examiner_id: form.examinerId,
      vehicle_id: form.vehicleId,
      trailer_type: form.trailerType,
      tested_on: form.testedOn,
      miles: Number(form.miles),
      items: items as Record<RoadTestItemKey, RoadTestRating>,
      general_performance: form.general as RoadTestRating,
      remarks: form.remarks.trim() || null,
      qualified_for: form.qualifiedFor.trim() || null,
    });
    if (result.passed) toast.success("Road test recorded", "The form and the certificate are in the driver's file.");
    else toast.success("Road test recorded", "Not passed: the form is filed and no certificate was issued.");
    adding.value = false;
  } catch (e) {
    toast.error("Could not record the road test", e instanceof Error ? e.message : undefined);
  }
}

const showForm = computed(() => !props.done || adding.value);
</script>

<template>
  <div class="space-y-6">
    <div>
      <p class="text-sm font-medium text-ink">On file</p>
      <p v-if="recordsQ.isLoading.value" class="mt-1 text-xs text-ink-muted">Loading…</p>
      <p v-else-if="filed.length === 0" class="mt-1 text-xs text-ink-muted">No road test passed yet.</p>
      <ul v-else class="mt-2 space-y-2">
        <li v-for="row in filed" :key="row.id" class="text-xs">
          <span class="font-medium text-ink">{{ formatDisplayDate(row.occurred_on, "") }}</span>
          <span class="text-ink-secondary"> · Passed · {{ row.performed_by }}</span>
          <template v-if="copyOf(row.id)">
            <p v-if="copyOf(row.id)!.given" class="mt-0.5 text-ink-secondary" data-testid="copy-given">
              Copy given: {{ howGiven(copyOf(row.id)!) }}
            </p>
            <div v-else class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span class="text-ink">The driver has not had their copy of this certificate yet.</span>
              <BaseButton
                variant="link"
                size="sm"
                :disabled="paperCopy.isPending.value"
                @click="handedPaperCopy(row.id)"
              >
                Handed a paper copy
              </BaseButton>
            </div>
          </template>
        </li>
      </ul>
    </div>

    <BaseButton v-if="done && !adding" size="sm" @click="adding = true">Record another</BaseButton>

    <template v-if="showForm">
      <!-- The examiner first: without one there is nobody to sign the form (Q-RT2). -->
      <SignatoryAddForm
        v-if="examiners.length === 0 || addingExaminer"
        kind="examiner"
        :cancellable="examiners.length > 0"
        @added="examinerAdded"
        @cancel="addingExaminer = false"
      />

      <div v-if="examiners.length > 0" class="space-y-5">
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField v-slot="{ id }" label="Examiner">
            <ComboSelect :id="id" v-model="form.examinerId" :options="examinerOptions" />
          </FormField>
          <FormField v-slot="{ id }" label="Date of the test">
            <AppDateField :id="id" v-model="form.testedOn" />
          </FormField>
          <FormField v-slot="{ id }" label="Truck" hint="From the roster. Prints as the power unit.">
            <ComboSelect :id="id" v-model="form.vehicleId" :options="truckOptions" />
          </FormField>
          <FormField v-slot="{ id }" label="Trailer">
            <ComboSelect :id="id" v-model="form.trailerType" :options="TRAILER_OPTIONS" />
          </FormField>
          <FormField v-slot="{ id }" label="Miles driven" hint="Approximately.">
            <BaseInput :id="id" v-model="form.miles" type="number" min="1" inputmode="numeric" />
          </FormField>
        </div>
        <BaseButton v-if="!addingExaminer" variant="link" size="sm" @click="addingExaminer = true">
          Add another examiner
        </BaseButton>

        <div>
          <p class="text-sm font-medium text-ink">The road test given includes</p>
          <p class="mt-1 text-xs text-ink-secondary">Rate every item. All nine must be Satisfactory for a certificate.</p>
          <ul class="mt-3 divide-y divide-edge border-y border-edge">
            <li v-for="item in ROAD_TEST_ITEMS" :key="item.key" class="grid gap-2 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <span class="text-xs text-ink">{{ item.text }}</span>
              <AppSegmentedControl
                :model-value="items[item.key] ?? ''"
                :options="RATING_OPTIONS"
                :label="item.text"
                @update:model-value="items[item.key] = $event as RoadTestRating"
              />
            </li>
          </ul>
        </div>

        <FormField v-slot="{ id }" label="General performance">
          <AppSegmentedControl :id="id" v-model="form.general" :options="RATING_OPTIONS" label="General performance" />
        </FormField>
        <FormField v-slot="{ id }" label="Remarks" hint="Optional.">
          <AppTextarea :id="id" v-model="form.remarks" rows="2" />
        </FormField>
        <FormField v-slot="{ id }" label="Qualified for" hint="Optional — for example, tractor-trailer.">
          <BaseInput :id="id" v-model="form.qualifiedFor" />
        </FormField>

        <p v-if="willPass === true" class="text-xs text-ink-secondary">
          Recording files the road-test form and the certificate.
        </p>
        <p v-else-if="willPass === false" class="text-xs text-ink">
          Not a pass: recording files the form only, issues no certificate, and leaves this step open.
        </p>

        <BaseButton variant="primary" size="sm" :disabled="!complete || record.isPending.value" @click="save">
          {{ record.isPending.value ? "Saving…" : "Record the road test" }}
        </BaseButton>
      </div>
    </template>
  </div>
</template>
