<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import {
  IN_SERVICE_VEHICLE_STATUSES,
  ROAD_TEST_EXAMINER_SECTION,
  ROAD_TEST_ITEMS,
  ROAD_TEST_ITEM_PHASES,
  ROAD_TEST_ITEM_PHASE_LABELS,
  ROAD_TEST_RATINGS,
  ROAD_TEST_RATING_LABELS,
  ROAD_TEST_TRAILER_LABELS,
  ROAD_TEST_TRAILER_TYPES,
  formatDisplayDate,
  formatDisplayDateTime,
  roadTestCounts,
  roadTestPassed,
  roadTestRecordSchema,
  validateRoadTest,
  type QualificationRecordRow,
  type RoadTestCertificateCopy,
  type RoadTestItemKey,
  type RoadTestRating,
  type RoadTestTrailerType,
} from "@silvicom/shared";
import {
  AppButton as BaseButton,
  AppCallout,
  AppCombobox as ComboSelect,
  AppDateField,
  AppFormField as FormField,
  AppInput as BaseInput,
  AppSegmentedControl,
  AppTextarea,
} from "@silvicom/ui";
import SignatoryAddForm from "@/features/recruitment/SignatoryAddForm.vue";
import ApplicantIdentityCorrection from "@/features/recruitment/ApplicantIdentityCorrection.vue";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { QueryState } from "@silvicom/ui";
import { ymd } from "@/lib/dateWindow";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useDocumentsQuery, useQualificationRecordsQuery } from "@/composables/useCompliance";
import {
  useRecordPaperCopy,
  useRecordRoadTest,
  useRoadTestCertificateCopies,
  useRoadTestExaminers,
} from "@/features/recruitment/useRoadTest";

/**
 * The §391.31 road test, recorded where the hire is worked — D2 (`ROAD-TEST-PLAN.md` RT3), reworked
 * by HIRING-WORKFLOW-AUDIT-2026-10-31 §9 P1 (RT-A1…A10, §4.2) after the owner called it "completely
 * broken". Each change below is named by its RT id so the audit's table can be read against it.
 *
 * ── WHAT THE OFFICE DOES HERE ─────────────────────────────────────────────────────────────────
 * Picks the examiner, the truck and the trailer, rates each of the nine items, gives the general
 * performance, and records it. The API files the carrier's form every time and the certificate only
 * on a pass (`roadTestPassed`, the same predicate the server uses — shown here so the office knows
 * BEFORE pressing what the press will produce).
 *
 * ── THE SCREEN ASKS WHAT THE SERVER WILL ASK, BEFORE THE PRESS ────────────────────────────────
 * RT-A1, RT-A4, RT-A8: every refusal the office used to meet after the press — a pass with no licence
 * number, miles the contract refuses, a future date — is now the same contract read here first
 * (`roadTestRecordSchema`, `validateRoadTest`), shown as "Still needed: …" under the button and as the
 * field's own error. The server still re-decides everything; this only stops it being a surprise.
 *
 * ── THE EXAMINER REGISTER IS SETTINGS' (Q-RT2, Q-AW19, D-5) ───────────────────────────────────
 * The owner ruled the examiner's signature is added from the dashboard and only by the admin
 * (`ROAD_TEST_EXAMINER_SECTION`). With no examiner on file the admin is offered the add form here,
 * once, because nothing else can be done on this step without one. A second examiner is a register
 * act, so it lives in Settings → Recruiting and this panel links there (D-5); anybody else is told to
 * ask an administrator (RT-A3).
 *
 * ── THE DRIVER'S COPY (G-10, Q-AW19, owner 2026-09-29) ───────────────────────────────────────
 * §391.31(g) owes the driver a copy of the certificate. Each certificate on file says whether they have
 * had it — downloaded from their link (RT4), or handed over on paper, which only the office can say,
 * so the office says it here. Nothing else reads it: it is not a hire gate, only a fact on file.
 */
const props = defineProps<{
  driverId: string;
  done: boolean;
  /** The live invitation — the licence correction writes through it (AF3/D-AF8). Null for a roster driver. */
  invitationId?: string | null;
  /** The driver row's licence, read by the page; null while it loads (RT-A1). */
  identity?: { date_of_birth?: string | null; cdl_number?: string | null; cdl_state?: string | null } | null;
  /** The step the checklist says should come first, by its label — the drug test today (RT-A10). */
  advisedFirst?: string | null;
}>();

const toast = useToastStore();
const session = useSessionStore();
const canAddExaminer = computed(() => session.can(ROAD_TEST_EXAMINER_SECTION));
const driverId = computed(() => props.driverId);
const examinersQ = useRoadTestExaminers();
const vehiclesQ = useVehiclesQuery();
const recordsQ = useQualificationRecordsQuery(driverId);
const documentsQ = useDocumentsQuery(ref("driver"), driverId);
const record = useRecordRoadTest(driverId);

const examiners = computed(() => examinersQ.data.value ?? []);
const examinerOptions = computed(() => examiners.value.map((e) => ({ value: e.id, label: `${e.full_name} — ${e.title}` })));

// RT-A6: a truck in the shop is still the carrier's truck — the shared in-service set, not `active`.
const truckOptions = computed(() =>
  (vehiclesQ.data.value ?? [])
    .filter((v) => (IN_SERVICE_VEHICLE_STATUSES as readonly string[]).includes(v.status ?? ""))
    .map((v) => ({
      value: v.id,
      label: [`#${v.unit_number}`, v.year, v.make, v.status === "maintenance" ? "(in the shop)" : null].filter(Boolean).join(" "),
    })),
);
const truckHint = computed(() => {
  if (vehiclesQ.isError?.value) return "Could not load the trucks. Close this step and open it again.";
  if (!vehiclesQ.isLoading?.value && truckOptions.value.length === 0) return "No trucks on the roster yet. Add one under Equipment.";
  return "From the roster. Prints as the power unit.";
});

/** RT-A9: the carrier's printed words, in the screen's sentence case ("Needs Training" → "Needs training"). */
const sentenceCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
const RATING_OPTIONS = ROAD_TEST_RATINGS.map((r) => ({ value: r, label: sentenceCase(ROAD_TEST_RATING_LABELS[r]) }));
const TRAILER_OPTIONS = ROAD_TEST_TRAILER_TYPES.map((t) => ({ value: t, label: ROAD_TEST_TRAILER_LABELS[t] }));
const ITEM_GROUPS = ROAD_TEST_ITEM_PHASES.map((phase) => ({
  phase,
  label: ROAD_TEST_ITEM_PHASE_LABELS[phase],
  items: ROAD_TEST_ITEMS.filter((i) => i.phase === phase),
}));

// ── what is on file (RT-A5, RT-A7) ─────────────────────────────────────────────────────────────
const roadTestRows = computed(() => (recordsQ.data.value ?? []).filter((r) => r.kind === "road_test"));
/** RT-A7: a row is labelled by what the checklist does with it — the same `roadTestCounts` it reads. */
function rowLabel(row: QualificationRecordRow): string {
  const detail = row.detail as { source?: string | null; passed?: string | boolean | null };
  if (detail.source === "road_test") return "Passed";
  return roadTestCounts(detail) ? "Passed (entered by hand)" : "Entered by hand — not counted as a pass";
}
const passOnFile = computed(() =>
  roadTestRows.value.some((r) => roadTestCounts(r.detail as { source?: string | null; passed?: string | boolean | null })),
);
const equivalency = computed(() => (recordsQ.data.value ?? []).find((r) => r.kind === "cdl_equivalency") ?? null);

/**
 * RT-A5: a failed test files its form (§391.31(g) keeps it) and no record, so it never reached this
 * screen. It is the `road_test` document no record points at — neither as the certificate
 * (`document_id`) nor as the pass's form (`detail.form_document_id`). "Form only" is true of it
 * whichever way it got there.
 */
const attempts = computed(() => {
  const cited = new Set<string>();
  for (const r of roadTestRows.value) {
    if (r.document_id) cited.add(r.document_id);
    const form = (r.detail as { form_document_id?: unknown }).form_document_id;
    if (typeof form === "string") cited.add(form);
  }
  return (documentsQ.data.value ?? [])
    .filter((d) => d.kind === "road_test" && d.variant === "original" && !cited.has(d.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
});

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
function examinerAdded(examiner: { id: string }): void {
  form.examinerId = examiner.id;
}

// ── the test ───────────────────────────────────────────────────────────────────────────────────
const blankForm = () => ({
  examinerId: "",
  vehicleId: "",
  trailerType: "dry_van" as RoadTestTrailerType,
  testedOn: "",
  miles: "",
  general: "" as RoadTestRating | "",
  remarks: "",
  qualifiedFor: "",
});
const form = reactive(blankForm());
const items = reactive<Partial<Record<RoadTestItemKey, RoadTestRating>>>({});
const adding = ref(false);
const today = ymd(new Date());

/** RT-A2: after ANY record the form starts empty — a second attempt never inherits the first's answers. */
function resetForm(): void {
  Object.assign(form, blankForm());
  for (const key of Object.keys(items) as RoadTestItemKey[]) delete items[key];
}

/** RT-A8: one press for the common case, every item Satisfactory; any item can then be changed. */
function markAllSatisfactory(): void {
  for (const item of ROAD_TEST_ITEMS) items[item.key] = "satisfactory";
}

/** The body as it would be posted — what both the contract check and the press read. */
const body = computed(() => ({
  examiner_id: form.examinerId,
  vehicle_id: form.vehicleId,
  trailer_type: form.trailerType,
  tested_on: form.testedOn,
  miles: form.miles === "" ? Number.NaN : Number(form.miles),
  // A copy, not the reactive object: `resetForm` empties `items` after the press (RT-A2).
  items: { ...items } as Record<RoadTestItemKey, RoadTestRating>,
  general_performance: form.general as RoadTestRating,
  remarks: form.remarks.trim() || null,
  qualified_for: form.qualifiedFor.trim() || null,
}));

/** RT-A4: the field errors the contract would give, in its words — only for a field that has a value. */
const fieldErrors = computed(() => {
  const errors: { miles?: string; tested_on?: string } = {};
  if (form.miles !== "") {
    const miles = roadTestRecordSchema.shape.miles.safeParse(body.value.miles);
    if (!miles.success) errors.miles = miles.error.issues[0]?.message;
  }
  if (form.testedOn) {
    const parsed = roadTestRecordSchema.safeParse(body.value);
    const issue = parsed.success ? validateRoadTest(parsed.data, today).find((i) => i.field === "tested_on") : undefined;
    if (issue) errors.tested_on = issue.message;
  }
  return errors;
});

const ratedAll = computed(() => ROAD_TEST_ITEMS.every((i) => items[i.key]));
/** What pressing Record will file — said before the press, from the server's own predicate. */
const willPass = computed(() =>
  ratedAll.value && form.general
    ? roadTestPassed({ items: items as Record<RoadTestItemKey, RoadTestRating>, general_performance: form.general as RoadTestRating })
    : null,
);
/** RT-A1: the certificate prints the licence number, so a pass waits on it; a fail does not. */
const licenceMissing = computed(() => props.identity != null && !props.identity.cdl_number?.trim());
const fixingLicence = ref(false);

/** RT-A8: which inputs are still empty, in the office's words, so a disabled button says why. */
const stillNeeded = computed(() => {
  const missing: string[] = [];
  if (!form.examinerId) missing.push("examiner");
  if (!form.testedOn) missing.push("date");
  if (!form.vehicleId) missing.push("truck");
  if (form.miles === "") missing.push("miles");
  const unrated = ROAD_TEST_ITEMS.filter((i) => !items[i.key]).length;
  if (unrated > 0) missing.push(unrated === 1 ? "1 item to rate" : `${unrated} items to rate`);
  if (!form.general) missing.push("general performance");
  if (willPass.value && licenceMissing.value) missing.push("the licence number");
  return missing;
});
const canRecord = computed(
  () => stillNeeded.value.length === 0 && !fieldErrors.value.miles && !fieldErrors.value.tested_on,
);

async function save(): Promise<void> {
  try {
    const result = await record.mutateAsync(body.value);
    if (result.passed) toast.success("Road test recorded", "The form and the certificate are in the driver's file.");
    else toast.success("Road test recorded", "Not passed: the form is filed under Attempts and no certificate was issued.");
    adding.value = false;
    resetForm();
  } catch (e) {
    const message = e instanceof Error ? e.message : undefined;
    // RT-A3: the examiner was retired or their signature is unreadable — the list the office picks from
    // is stale, so ask again and clear the pick rather than leave a choice that will be refused again.
    if (message && /examiner/i.test(message)) {
      form.examinerId = "";
      void examinersQ.refetch();
    }
    toast.error("Could not record the road test", message);
  }
}

// The drawer swaps applicants without unmounting; a half-rated test must not carry over.
watch(() => props.driverId, () => {
  resetForm();
  adding.value = false;
  fixingLicence.value = false;
});

/** RT-A2: a second pass is refused (one per application), so "Record another" is offered only when the
 *  step is done by something other than a pass on file — the §391.33 equivalency. */
const offerAnother = computed(() => props.done && !passOnFile.value && !adding.value);
const showForm = computed(() => !props.done || adding.value);
</script>

<template>
  <div class="space-y-6">
    <section>
      <h3 class="text-sm font-semibold text-ink">On file</h3>
      <div class="mt-1">
        <QueryState
          :loading="recordsQ.isLoading.value"
          :error="recordsQ.isError.value ? recordsQ.error.value : null"
          :retrying="recordsQ.isFetching.value"
          loading-text="Loading the road tests on file…"
          error-text="Could not load the road tests on file."
          compact
          @retry="recordsQ.refetch()"
        >
          <p v-if="equivalency && !passOnFile" class="text-xs text-ink-secondary" data-testid="equivalency">
            Done by the licence equivalency (§391.33), recorded {{ formatDisplayDate(equivalency.occurred_on, "") }}.
            No road test is needed.
          </p>
          <p v-else-if="roadTestRows.length === 0" class="text-xs text-ink-muted">No road test passed yet.</p>
          <ul v-if="roadTestRows.length > 0" class="mt-1 space-y-2">
            <li v-for="row in roadTestRows" :key="row.id" class="text-xs" data-testid="road-test-row">
              <span class="font-medium text-ink">{{ formatDisplayDate(row.occurred_on, "") }}</span>
              <span class="text-ink-secondary"> · {{ rowLabel(row) }} · {{ row.performed_by }}</span>
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
        </QueryState>
      </div>
    </section>

    <!-- RT-A5: a failed test is a filed form, so it is shown, with the form to open. -->
    <section v-if="attempts.length > 0" data-testid="attempts">
      <h3 class="text-sm font-semibold text-ink">Attempts</h3>
      <ul class="mt-1 space-y-1">
        <li v-for="doc in attempts" :key="doc.id" class="flex flex-wrap items-center gap-x-3 text-xs">
          <span class="font-medium text-ink">{{ formatDisplayDate(doc.createdAt, "") }}</span>
          <span class="text-ink-secondary">Not passed — form filed, no certificate</span>
          <a
            v-if="doc.url"
            :href="doc.url"
            target="_blank"
            rel="noopener noreferrer"
            class="font-medium text-action-primary underline"
          >Open the form</a>
        </li>
      </ul>
    </section>

    <BaseButton v-if="offerAnother" size="sm" @click="adding = true">Record a road test</BaseButton>

    <template v-if="showForm">
      <!-- RT-A10 (Q-WF2 (a), assumed in §8.3): advised, not refused — the form below still records. -->
      <AppCallout v-if="advisedFirst" tone="caution" data-testid="advised-first">
        The {{ advisedFirst.toLowerCase() }} result is not in yet. You can still give the road test now if the
        driver is here.
      </AppCallout>

      <!-- The examiner first: without one there is nobody to sign the form (Q-RT2). -->
      <template v-if="examiners.length === 0 && !examinersQ.isLoading.value">
        <SignatoryAddForm v-if="canAddExaminer" kind="examiner" :cancellable="false" @added="examinerAdded" />
        <AppCallout v-else tone="caution">
          No road-test examiner is on file. Ask an administrator to add one in Settings → Recruiting.
        </AppCallout>
      </template>

      <div v-if="examiners.length > 0" class="space-y-5">
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField v-slot="{ id }" label="Examiner">
            <ComboSelect :id="id" v-model="form.examinerId" :options="examinerOptions" />
          </FormField>
          <FormField v-slot="{ id }" label="Date of the test" :error="fieldErrors.tested_on">
            <AppDateField :id="id" v-model="form.testedOn" :max-date="today" :invalid="Boolean(fieldErrors.tested_on)" />
          </FormField>
          <FormField v-slot="{ id }" label="Truck" :hint="truckHint">
            <ComboSelect :id="id" v-model="form.vehicleId" :options="truckOptions" />
          </FormField>
          <FormField v-slot="{ id }" label="Trailer">
            <ComboSelect :id="id" v-model="form.trailerType" :options="TRAILER_OPTIONS" />
          </FormField>
          <FormField v-slot="{ id }" label="Miles driven" hint="Approximately, up to 1,000." :error="fieldErrors.miles">
            <BaseInput :id="id" v-model="form.miles" type="number" min="1" max="1000" step="1" inputmode="numeric" />
          </FormField>
        </div>
        <!-- D-5 / RT-A3: the examiner register is Settings' — linked for the admin, named for anybody else. -->
        <p class="text-xs text-ink-secondary">
          Examiner not listed?
          <BaseButton v-if="canAddExaminer" variant="link" size="sm" to="/settings/recruiting">
            Add one in Settings → Recruiting
          </BaseButton>
          <template v-else>Ask an administrator to add them in Settings → Recruiting.</template>
        </p>

        <div class="space-y-4">
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h3 class="text-sm font-semibold text-ink">The road test given includes</h3>
              <p class="mt-0.5 text-xs text-ink-secondary">Rate every item. All nine must be Satisfactory for a certificate.</p>
            </div>
            <BaseButton size="sm" variant="secondary" @click="markAllSatisfactory">Mark all satisfactory</BaseButton>
          </div>
          <div v-for="group in ITEM_GROUPS" :key="group.phase" :data-testid="`group-${group.phase}`">
            <h4 class="text-xs font-semibold text-ink-secondary">{{ group.label }}</h4>
            <ul class="mt-1 divide-y divide-edge border-y border-edge">
              <li v-for="item in group.items" :key="item.key" class="grid gap-2 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
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
        </div>

        <!-- RT-A9: a segmented control is a group, not an input — it names itself through `label`, so a
             heading stands above it rather than a <label for> pointing at a div. -->
        <div>
          <h3 class="text-sm font-semibold text-ink">General performance</h3>
          <AppSegmentedControl v-model="form.general" class="mt-1" :options="RATING_OPTIONS" label="General performance" />
        </div>
        <FormField v-slot="{ id }" label="Remarks" hint="Optional.">
          <AppTextarea :id="id" v-model="form.remarks" rows="2" />
        </FormField>
        <FormField v-slot="{ id }" label="Qualified for" hint="Optional — for example, tractor-trailer.">
          <BaseInput :id="id" v-model="form.qualifiedFor" />
        </FormField>

        <!-- RT-A1: the certificate prints the licence number — fixed here, in place, not in another drawer. -->
        <AppCallout v-if="willPass === true && licenceMissing" tone="caution" data-testid="licence-missing">
          <p>Add the licence number first. The road-test certificate prints it.</p>
          <BaseButton v-if="!fixingLicence && invitationId" class="mt-2" size="sm" variant="secondary" @click="fixingLicence = true">
            Add the licence number
          </BaseButton>
          <p v-else-if="!invitationId" class="mt-1">Add it on the driver's page, then record the test.</p>
        </AppCallout>
        <ApplicantIdentityCorrection
          v-if="fixingLicence && invitationId && licenceMissing"
          :invitation-id="invitationId"
          :driver-id="driverId"
          :identity="identity ?? null"
        />

        <p v-if="willPass === true && !licenceMissing" class="text-xs text-ink-secondary">
          Recording files the road-test form and the certificate.
        </p>
        <p v-else-if="willPass === false" class="text-xs text-ink">
          Not a pass: recording files the form only, issues no certificate, and leaves this step open.
        </p>

        <div>
          <BaseButton variant="primary" size="sm" :disabled="!canRecord || record.isPending.value" @click="save">
            {{ record.isPending.value ? "Saving…" : "Record the road test" }}
          </BaseButton>
          <p v-if="stillNeeded.length > 0" class="mt-1 text-xs text-ink-muted" data-testid="still-needed">
            Still needed: {{ stillNeeded.join(", ") }}.
          </p>
        </div>
      </div>
    </template>
  </div>
</template>
