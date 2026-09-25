<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import {
  ROAD_TEST_ITEMS,
  ROAD_TEST_RATINGS,
  ROAD_TEST_RATING_LABELS,
  ROAD_TEST_TRAILER_LABELS,
  ROAD_TEST_TRAILER_TYPES,
  formatDisplayDate,
  roadTestPassed,
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
import FileDropzone from "@/components/ui/FileDropzone.vue";
import { useToastStore } from "@/stores/toast";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useQualificationRecordsQuery } from "@/composables/useCompliance";
import {
  pngDataUrl,
  useAddRoadTestExaminer,
  useRecordRoadTest,
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
 * the signature, so the office's act is visible on the paper.
 */
const props = defineProps<{ driverId: string; done: boolean }>();

const toast = useToastStore();
const driverId = computed(() => props.driverId);
const examinersQ = useRoadTestExaminers();
const vehiclesQ = useVehiclesQuery();
const recordsQ = useQualificationRecordsQuery(driverId);
const addExaminer = useAddRoadTestExaminer();
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

// ── the examiner, when none is on file ─────────────────────────────────────────────────────────
const examinerForm = reactive({ fullName: "", title: "" });
const signature = ref<File | null>(null);
const addingExaminer = ref(false);
const canAddExaminer = computed(
  () => examinerForm.fullName.trim().length >= 2 && examinerForm.title.trim().length >= 2 && Boolean(signature.value),
);

async function saveExaminer(): Promise<void> {
  if (!signature.value) return;
  try {
    const created = await addExaminer.mutateAsync({
      full_name: examinerForm.fullName.trim(),
      title: examinerForm.title.trim(),
      signature_png: await pngDataUrl(signature.value),
    });
    toast.success("Examiner added", `${created.full_name}'s signature will print on the road tests they give.`);
    form.examinerId = created.id;
    Object.assign(examinerForm, { fullName: "", title: "" });
    signature.value = null;
    addingExaminer.value = false;
  } catch (e) {
    toast.error("Could not add the examiner", e instanceof Error ? e.message : undefined);
  }
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
        </li>
      </ul>
    </div>

    <BaseButton v-if="done && !adding" size="sm" @click="adding = true">Record another</BaseButton>

    <template v-if="showForm">
      <!-- The examiner first: without one there is nobody to sign the form (Q-RT2). -->
      <div v-if="examiners.length === 0 || addingExaminer" class="space-y-4 rounded-surface border border-edge p-4">
        <p class="text-sm font-medium text-ink">Add the examiner</p>
        <p class="text-xs text-ink-secondary">
          Their signature prints on every road test they give. Upload a PNG of it — a scan or a photo of
          them signing on white paper.
        </p>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField v-slot="{ id }" label="Name">
            <BaseInput :id="id" v-model="examinerForm.fullName" />
          </FormField>
          <FormField v-slot="{ id }" label="Title" hint="Printed on the certificate.">
            <BaseInput :id="id" v-model="examinerForm.title" placeholder="Maintenance manager" />
          </FormField>
        </div>
        <FileDropzone
          accept=".png"
          :busy="addExaminer.isPending.value"
          busy-label="Saving…"
          :label="signature ? signature.name : 'Drag & drop the signature (PNG)'"
          hint="PNG only. Stored privately with the carrier's files."
          @files="signature = $event[0] ?? null"
        />
        <div class="flex gap-3">
          <BaseButton variant="primary" size="sm" :disabled="!canAddExaminer || addExaminer.isPending.value" @click="saveExaminer">
            Add examiner
          </BaseButton>
          <BaseButton v-if="examiners.length > 0" variant="ghost" size="sm" @click="addingExaminer = false">Cancel</BaseButton>
        </div>
      </div>

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
