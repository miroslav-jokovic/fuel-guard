<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import {
  DQ_KIND_LABELS,
  hiringRecordedActKind,
  mvrJurisdictionOptions,
  type HiringRecordedActStep,
  type QualificationRecordRow,
} from "@silvicom/shared";
import { AppButton as BaseButton, AppIcon } from "@silvicom/ui";
import { AppInput as BaseInput } from "@silvicom/ui";
import { AppCombobox as ComboSelect, AppDateField, AppFormField as FormField } from "@silvicom/ui";
import { ClipboardDocumentCheckIcon } from "@silvicom/ui/icons";
import FileDropzone from "@/components/ui/FileDropzone.vue";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { useDocumentsQuery, useQualificationRecordsQuery } from "@/composables/useCompliance";
import { useRecordHiringAct } from "@/features/recruitment/useHiringEvidence";

/**
 * The MVR, the Clearinghouse query and the drug test, recorded where the hire is worked — D1, D-HM6.
 *
 * ── WHAT THIS REPLACES, AND WHY THE SIGNPOST WAS NOT GOOD ENOUGH ──────────────────────────────
 * Until D1 these three rows opened a drawer that named the artifact and offered a link to the
 * driver's §391.51 file. That was honest — `hiringStepDrawers.ts` says so in as many words — and it
 * was still a checklist whose most common next action happened on another page, in a section a
 * recruiter cannot write to. D-HUI5's second-order note is exactly this feature: *"a step completed
 * outside the product still checks — an MVR uploaded by hand, a Clearinghouse query recorded from
 * the FMCSA portal. That is what makes D-HM6's 'recorded acts, not integrations' liveable as a UI
 * rather than a nag."*
 *
 * ── THE FORM IS NOT OFFERED FOR A STEP THAT IS DONE ───────────────────────────────────────────
 * D-HUI5's first-order rule. `qualification_records` is append-only, so a correction and a second
 * pull are both new rows and both remain possible — behind *Record another*, which is a deliberate
 * second click rather than a form sitting open under a green row asking to be filled in again.
 *
 * ── AND A ROLE THAT MAY NOT FILE IS TOLD WHO DOES ─────────────────────────────────────────────
 * ⚠ `clearinghouse_full` and `drug_test` are `TESTING_RECORD_KINDS`: §382.401(a) keeps that file
 * with the admin and the safety manager, so a recruiter may neither read nor record them. The panel
 * says who does rather than rendering a form the API will refuse — the same rule
 * `QualificationSection`'s drop card follows, that an option must not offer a dead end.
 */
const props = defineProps<{
  driverId: string;
  step: HiringRecordedActStep;
  done: boolean;
  /** The declared licensing states with no MVR yet, from the fold (AF7). Empty for the other two. */
  outstandingJurisdictions?: readonly string[];
}>();

const session = useSessionStore();
const toast = useToastStore();
const record = useRecordHiringAct();

const driverId = computed(() => props.driverId);
const subjectType = ref("driver");
const recordsQ = useQualificationRecordsQuery(driverId);
const docsQ = useDocumentsQuery(subjectType, driverId);

/**
 * The kind this step files, from the catalogue rather than from a map in this file.
 *
 * ⚠ Total by construction — the prop's type is the three steps `hiringRecordedActKind` answers for —
 * but the fallback is still not `"other"`: a panel that filed a mis-keyed step as `other` would put
 * an unrestricted row where a restricted one belongs. It renders nothing instead.
 */
const kind = computed(() => hiringRecordedActKind(props.step));
const canRead = computed(() => (kind.value ? session.canReadKind(kind.value) : false));

/** Signed for minutes and re-signed on refetch — never stored, never rendered as a permanent link. */
const scanUrl = computed(() => {
  const m = new Map<string, string>();
  for (const d of docsQ.data.value ?? []) if (d.url) m.set(d.id, d.url);
  return m;
});

const filed = computed<QualificationRecordRow[]>(() =>
  (recordsQ.data.value ?? []).filter((r) => r.kind === kind.value),
);

const form = reactive({ occurredOn: "", result: "", performedBy: "", reference: "", jurisdiction: "" });
const scan = ref<File | null>(null);
const adding = ref(false);

function reset(): void {
  Object.assign(form, { occurredOn: "", result: "", performedBy: "", reference: "", jurisdiction: "" });
  scan.value = null;
  adding.value = false;
}
watch(() => props.step, reset);

/** Open unless the step is already green — D-HUI5. `adding` is the deliberate second click. */
const showForm = computed(() => canRead.value && (!props.done || adding.value));

/**
 * An MVR asks which state it came from (AF7, §391.23(a)(1)), and cannot be saved without one.
 *
 * ⚠ Required here although the API admits it blank, because an MVR with no jurisdiction covers no
 * declared licence: saving one would put a row in the file and leave the step exactly as open as it
 * was, with nothing on screen saying why.
 *
 * ⚠ A PICKER, not a text box (Q-AF5): the same catalogue the applicant's licence-state field writes
 * through, so a state is stored as its code like every other state in the product. The jurisdictions
 * still owed lead the list, and they are the only way to pick an authority the catalogue cannot
 * place ("Indiana BMV") — `mvrJurisdictionOptions` says why.
 */
const asksJurisdiction = computed(() => props.step === "mvr");
const jurisdictionOptions = computed(() => mvrJurisdictionOptions(props.outstandingJurisdictions ?? []));
const jurisdictionHint = computed(() =>
  props.outstandingJurisdictions?.length
    ? `Where the record came from. Still needed: ${props.outstandingJurisdictions.join(", ")}.`
    : "Where the record came from.",
);
const ready = computed(
  () => Boolean(form.occurredOn) && (!asksJurisdiction.value || form.jurisdiction.trim() !== ""),
);

/** The state a filed MVR was recorded for, off `detail` (`hiringEvidenceDetail`); null when none. */
const jurisdictionOf = (row: QualificationRecordRow): string | null =>
  typeof row.detail?.jurisdiction === "string" ? row.detail.jurisdiction : null;

async function save(): Promise<void> {
  try {
    await record.mutateAsync({
      driverId: props.driverId,
      step: props.step,
      occurredOn: form.occurredOn,
      result: form.result.trim() || null,
      performedBy: form.performedBy.trim() || null,
      reference: form.reference.trim() || null,
      jurisdiction: asksJurisdiction.value ? form.jurisdiction.trim() || null : null,
      file: scan.value,
    });
    toast.success(`${label.value} recorded`, "It is in the driver's qualification file.");
    reset();
  } catch (e) {
    toast.error(`Could not record the ${label.value.toLowerCase()}`, e instanceof Error ? e.message : undefined);
  }
}

/** The row's own words for the kind, so the toast and the history read as the §391.51 file does. */
const label = computed(() => (kind.value ? (DQ_KIND_LABELS[kind.value] ?? "record") : "record"));
</script>

<template>
  <div class="space-y-6">
    <p class="text-xs text-ink-secondary">
      Recorded rather than fetched: a record pulled anywhere else still counts, and files the same
      way.
    </p>

    <!-- What is on file. Shown before the form, because the first question a recruiter opening this
         has is whether somebody already did it. -->
    <div v-if="canRead">
      <p class="text-sm font-medium text-ink">On file</p>
      <p v-if="recordsQ.isLoading.value" class="mt-1 text-xs text-ink-muted">Loading…</p>
      <p v-else-if="filed.length === 0" class="mt-1 text-xs text-ink-muted">
        Nothing yet. Record it below once you have it.
      </p>
      <!-- ⚠ Two lines, not one, and each optional value carries a WORD. Rendered at 1440 on
           2026-09-19 the row read `2026-09-10  clean  SambaSafety  MVR-771` — four unlabelled
           values in a line, where a reader has to guess which is the result and which is the
           agency. The date and what came back are the answer; who did it and its number are
           metadata, which is what `text-2xs` is for (D-DS6). -->
      <ul v-else class="mt-2 space-y-3">
        <li v-for="row in filed" :key="row.id">
          <p class="text-xs">
            <span class="font-medium text-ink">{{ row.occurred_on }}</span>
            <span v-if="jurisdictionOf(row)" class="text-ink"> · {{ jurisdictionOf(row) }}</span>
            <span v-if="row.result" class="text-ink-secondary"> · {{ row.result }}</span>
          </p>
          <p class="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-2xs text-ink-secondary">
            <span v-if="row.performed_by">By {{ row.performed_by }}</span>
            <span v-if="row.reference" class="font-mono">Ref {{ row.reference }}</span>
            <!-- Three states, `PspRecordsSection`'s reasoning: a document can be on file with no
                 link this minute, because `signDocumentRows` degrades a row to `url: null` rather
                 than failing the page. "Unavailable" is the honest word; a dead link and an em dash
                 are both lies about evidence. -->
            <a
              v-if="row.document_id && scanUrl.get(row.document_id)"
              :href="scanUrl.get(row.document_id)"
              target="_blank"
              rel="noopener noreferrer"
              class="font-medium hover:text-link"
            >
              Open the scan
            </a>
            <span v-else-if="row.document_id && docsQ.isLoading.value" class="text-ink-muted">Loading…</span>
            <span v-else-if="row.document_id" class="text-ink-muted">Scan unavailable</span>
            <span v-else class="text-ink-muted">No scan</span>
          </p>
        </li>
      </ul>
    </div>

    <!-- ⚠ §382.401(a). Not a permission apology — it names who holds the file, because the recruiter
         reading this needs to know who to ask, not that they were refused. -->
    <p v-else class="text-sm text-ink-muted">
      A safety manager or an admin records this one and holds the file it goes into. You can see
      whether the step is done; the result itself stays with them.
    </p>

    <BaseButton v-if="canRead && done && !adding" size="sm" @click="adding = true">
      Record another
    </BaseButton>

    <div v-if="showForm" class="space-y-4">
      <FormField v-if="asksJurisdiction" v-slot="{ id }" label="State or authority" :hint="jurisdictionHint">
        <ComboSelect :id="id" v-model="form.jurisdiction" :options="jurisdictionOptions" />
      </FormField>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField v-slot="{ id }" label="Date" hint="The date on the record itself.">
          <AppDateField :id="id" v-model="form.occurredOn" />
        </FormField>
        <FormField v-slot="{ id }" label="Result" hint="What came back. Optional.">
          <BaseInput :id="id" v-model="form.result" placeholder="Optional" />
        </FormField>
      </div>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField v-slot="{ id }" label="Performed by" hint="The agency, lab or person. Optional.">
          <BaseInput :id="id" v-model="form.performedBy" placeholder="Optional" />
        </FormField>
        <FormField v-slot="{ id }" label="Reference" hint="Confirmation or report number. Optional.">
          <BaseInput :id="id" v-model="form.reference" placeholder="Optional" />
        </FormField>
      </div>

      <div>
        <p class="text-sm font-medium text-ink">Scan</p>
        <p class="mt-1 text-sm text-ink-muted">
          Optional — you can attach it later from the driver's file.
        </p>
        <div class="mt-2">
          <FileDropzone
            accept=".pdf,.jpg,.jpeg,.png,.webp,.heic"
            :busy="record.isPending.value"
            busy-label="Uploading…"
            :label="scan ? scan.name : 'Drag & drop the scan here'"
            hint="PDF or photo. Uploads straight to storage and is never publicly reachable."
            @files="scan = $event[0] ?? null"
          />
        </div>
      </div>

      <div class="flex items-center gap-3">
        <BaseButton
          variant="primary"
          size="sm"
          :disabled="!ready || record.isPending.value"
          @click="save"
        >
          <AppIcon :icon="ClipboardDocumentCheckIcon" class="size-4" aria-hidden="true" />
          {{ record.isPending.value ? "Saving…" : "Record it" }}
        </BaseButton>
        <BaseButton v-if="adding" variant="ghost" size="sm" :disabled="record.isPending.value" @click="reset">
          Cancel
        </BaseButton>
      </div>
    </div>
  </div>
</template>
