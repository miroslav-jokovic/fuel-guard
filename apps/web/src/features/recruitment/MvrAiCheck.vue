<script setup lang="ts">
import { computed } from "vue";
import { acceptFor, DOCUMENT_CONTENT_TYPES, toJurisdictionCode, printedDay, type MvrReport } from "@silvicom/shared";
import { AppButton as BaseButton, AppCallout, FactList, type Fact } from "@silvicom/ui";
import FileDropzone from "@/components/ui/FileDropzone.vue";
import { useToastStore } from "@/stores/toast";
import { useMvrCheck } from "@/features/recruitment/useMvrCheck";

/**
 * Check a driving record with AI, on the driving-record drawer (HIRING-WORKFLOW-AUDIT §14, OF6b; owner
 * 2026-11-03: *"we will use AI as checking layer"*).
 *
 * Drop the PDF SambaSafety gave you; the reader reads it (`mvr_report`) and `mvrReportFindings` says what to
 * look at — STOP for something that, if the paper is right, means the licence cannot be used today; CHECK for
 * something to read before deciding. Then "Use these values" fills the form below from what was read and
 * keeps the same file as its scan. The recruiter still presses Record: nothing is filed by the AI.
 *
 * ⚠ The findings say what the PAPER says. The PDF is the authority; the panel never hides it.
 */
const props = defineProps<{ driverId: string }>();
const emit = defineEmits<{
  use: [values: { documentId: string; occurredOn: string; jurisdiction: string; result: string; performedBy: string; reference: string }];
}>();

const toast = useToastStore();
const mvr = useMvrCheck(computed(() => props.driverId));
const state = computed(() => mvr.check.data.value ?? null);
const done = computed(() => (state.value?.status === "done" ? state.value : null));
const stops = computed(() => done.value?.findings.filter((f) => f.weight === "stop") ?? []);
const checks = computed(() => done.value?.findings.filter((f) => f.weight === "check") ?? []);
const reading = computed(() => mvr.start.isPending.value || (state.value?.status === "reading" && !mvr.timedOut.value) || (mvr.documentId.value !== null && !state.value));

async function drop(files: File[]): Promise<void> {
  const file = files[0];
  if (!file) return;
  mvr.reset();
  try {
    await mvr.start.mutateAsync(file);
  } catch (e) {
    toast.error("Could not check the record", e instanceof Error ? e.message : undefined);
  }
}

/** The short result the record carries: the status, and how much the record holds. */
function summary(r: MvrReport): string {
  const parts = [r.licenseStatus ?? "status not read"];
  if (r.licenseClass) parts.push(`class ${r.licenseClass}`);
  parts.push(`${r.violations.length} violation${r.violations.length === 1 ? "" : "s"}`);
  if (r.accidents.length) parts.push(`${r.accidents.length} crash${r.accidents.length === 1 ? "" : "es"}`);
  if (r.withdrawals.length) parts.push(`${r.withdrawals.length} withdrawal${r.withdrawals.length === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

function use(): void {
  const d = done.value;
  if (!d || !mvr.documentId.value) return;
  emit("use", {
    documentId: mvr.documentId.value,
    occurredOn: printedDay(d.report.reportDate) ?? "",
    jurisdiction: toJurisdictionCode(d.report.licenseState) ?? d.report.licenseState ?? "",
    result: summary(d.report),
    performedBy: d.report.issuer ?? "",
    reference: "",
  });
}

const rows = computed<Fact[]>(() => {
  const r = done.value?.report;
  if (!r) return [];
  return ([
    ["Name", r.driverName], ["Licence", [r.licenseNumber, r.licenseState].filter(Boolean).join(" · ") || null],
    ["Class", r.licenseClass], ["Status", r.licenseStatus], ["CDL status", r.commercialStatus], ["Expires", r.licenseExpires],
    ["Medical", [r.medicalCertificationStatus, r.medicalExpires && `until ${r.medicalExpires}`].filter(Boolean).join(" ") || null],
    ["Report date", r.reportDate],
  ] as Array<[string, string | null]>).filter(([, v]) => v).map(([label, value]) => ({ label, value }));
});
const accept = acceptFor(DOCUMENT_CONTENT_TYPES);
</script>

<template>
  <section class="space-y-3 rounded-surface p-4 ring-1 ring-inset ring-edge" aria-labelledby="mvr-ai-check" data-testid="mvr-ai-check">
    <div>
      <h3 id="mvr-ai-check" class="text-sm font-semibold text-ink">Check it with AI</h3>
      <p class="mt-0.5 text-xs text-ink-secondary">
        Drop the record SambaSafety gave you. It is read and checked against this applicant; you still record it below.
      </p>
    </div>
    <FileDropzone
      :accept="accept"
      :busy="reading"
      busy-label="Reading the record…"
      label="Drag & drop the driving record here"
      hint="PDF or photo, up to 10 pages."
      @files="drop"
    />

    <p v-if="mvr.timedOut.value" class="text-xs text-ink" data-testid="mvr-timeout">
      The reader did not answer. Read the record yourself and record it below — the file is already saved as its scan.
    </p>
    <p v-else-if="state?.status === 'failed'" class="text-xs text-ink" data-testid="mvr-failed">
      This record could not be read. Read it yourself and record it below.
    </p>

    <template v-if="done">
      <AppCallout v-if="stops.length" tone="danger" data-testid="mvr-stops">
        <p class="font-medium">Check before you go on</p>
        <ul class="mt-1 list-disc space-y-0.5 pl-5">
          <li v-for="f in stops" :key="f.code + f.message">{{ f.message }}</li>
        </ul>
      </AppCallout>
      <AppCallout v-if="checks.length" tone="caution" data-testid="mvr-checks">
        <ul class="list-disc space-y-0.5 pl-5">
          <li v-for="f in checks" :key="f.code + f.message">{{ f.message }}</li>
        </ul>
      </AppCallout>
      <p v-if="!stops.length && !checks.length" class="text-xs text-ink-secondary" data-testid="mvr-clear">
        Nothing to flag. Still read the record before you record it.
      </p>
      <FactList :facts="rows" :columns="2" />
      <BaseButton size="sm" variant="secondary" data-testid="mvr-use" @click="use">Use these values below</BaseButton>
    </template>
  </section>
</template>
