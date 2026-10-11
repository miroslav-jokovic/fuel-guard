<script setup lang="ts">
import { ref } from "vue";
import { AppIcon, AppCard as BaseCard } from "@silvicom/ui";
import { ArrowUpTrayIcon } from "@silvicom/ui/icons";
import { useRunReconciliation, ReconRejected } from "@/features/reconcile/useReconRuns";
import { readPivotSheet, readReportGrid } from "@/lib/reportGrid";
import { loadFuelReport, ReportLoadError, type LoadedReport } from "@/features/reconcile/loadFuelReport";
import { useSaveStatement, StatementRejected } from "@/features/reconcile/useSaveStatement";
import { useToastStore } from "@/stores/toast";
import { formatDate } from "@/lib/format";
import FileDropzone from "@/components/ui/FileDropzone.vue";

/**
 * Check an invoice: upload a Pilot / Flying J report and have the SERVER reconcile and record it.
 *
 * Any Pilot report is accepted — the weekly direct-bill statement PDF, or the monthly "All
 * Transactions" export as .xlsx/.csv/.xls. `loadFuelReport` normalises them; only the browser has
 * `pdfjs` and ExcelJS, so it decodes, and the server re-parses, gates, matches and writes (D-FX1).
 *
 * ── IT SHOWS NO RESULT, ON PURPOSE (FS3, D-FSV8) ────────────────────────────────────────────────
 * This used to render the reconciliation it got back, from a component ref, inside a drawer — so the
 * only copy anybody could see vanished when the drawer closed (W5). Now it emits the recorded run's id
 * and the page opens that saved check, read back from the server. What a person sees after an upload
 * is therefore exactly what anybody opening the check next month will see.
 */

const toast = useToastStore();
const saveStatement = useSaveStatement();
const runRecon = useRunReconciliation();
const emit = defineEmits<{ recorded: [runId: string] }>();
const parsing = ref(false);
const stage = ref<string | null>(null);

async function onFiles(files: File[]) {
  const file = files[0];
  if (!file) return;
  parsing.value = true;
  try {
    stage.value = "Reading the report…";
    const loaded = await loadFuelReport(file);
    for (const note of loaded.tieOut?.notes ?? []) toast.info("Statement note", note);
    // Keeping the statement is what makes week-over-week possible; the check runs either way, so a
    // save failure never costs the reader the check itself.
    let statementId: string | null = null;
    if (loaded.statementSource) {
      stage.value = "Saving the statement…";
      statementId = await persist(loaded);
    }
    // An export's PivotTable is a SECOND sheet, and it holds the printed total the server's tie-out
    // gate checks the parse against (L8).
    const pivotGrid = loaded.statementSource ? null : await readPivotSheet(file);
    stage.value = "Checking every line against our records…";
    await reconcile(loaded, file, statementId, pivotGrid);
  } catch (e) {
    if (e instanceof ReportLoadError) toast.error(e.message, e.detail);
    else toast.error("Could not read the report", e instanceof Error ? e.message : undefined);
  } finally {
    parsing.value = false;
    stage.value = null;
  }
}

/** Record the statement server-side. The server re-parses, so this can still be refused. */
async function persist(loaded: LoadedReport): Promise<string | null> {
  if (!loaded.statementSource) return null;
  try {
    const r = await saveStatement.mutateAsync({
      words: loaded.statementSource.words,
      bytes: loaded.statementSource.bytes,
      filename: loaded.fileName,
    });
    if (r.unresolvedSites?.length) {
      toast.warning(
        `${r.unresolvedSites.length} site${r.unresolvedSites.length === 1 ? "" : "s"} not in the station registry`,
        `Their lines are kept without a brand rather than guessed: ${r.unresolvedSites.slice(0, 5).join(", ")}`,
      );
    }
    return r.statementId ?? null;
  } catch (e) {
    if (e instanceof StatementRejected) toast.error("Statement not saved", [e.message, ...e.reasons].join(" "));
    else toast.error("Statement not saved", e instanceof Error ? e.message : undefined);
    return null;
  }
}

/**
 * Post the decoded report; on success hand the recorded run to the page.
 *
 * A refusal here is not a transport failure — it means the file did not reproduce its own printed
 * totals — so the gate's reasons are shown verbatim.
 */
async function reconcile(loaded: LoadedReport, file: File, statementId: string | null, pivotGrid: unknown[][] | null) {
  try {
    const r = await runRecon.mutateAsync({
      words: loaded.statementSource?.words ?? null,
      grid: loaded.statementSource ? null : ((await readReportGrid(file)) as unknown[][]),
      pivotGrid,
      filename: loaded.fileName,
      statementId,
    });
    for (const n of r.tieOutNotes ?? []) toast.info("Report note", n);
    if (r.linesError) toast.warning("The check was saved without its lines", r.linesError);
    const replaced = r.supersededRunId ? " · replaced the earlier check of this invoice" : "";
    toast.success("Invoice checked", `${formatDate(r.periodStart)} – ${formatDate(r.periodEnd)}${replaced}`);
    if (r.runId) emit("recorded", r.runId);
  } catch (e) {
    if (e instanceof ReconRejected) toast.error("That report didn't add up", [e.message, ...e.reasons].join(" "));
    else toast.error("Could not check the report", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <BaseCard>
    <div class="flex items-start gap-3">
      <AppIcon :icon="ArrowUpTrayIcon" class="mt-0.5 size-5 shrink-0 text-ink-tertiary" aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <h3 class="text-sm font-semibold text-ink">Pilot / Flying J report</h3>
        <p class="mt-1 text-sm text-ink-muted">
          The weekly invoice (PDF) or the monthly "All Transactions" export (.xlsx, .csv, or .xls). We match
          each fuel line to your recorded fills by card, date, gallons and amount, and keep the result.
        </p>
        <p class="mt-1 text-xs text-ink-tertiary">
          A weekly invoice is checked against the totals Pilot prints on it. If our reading doesn't
          reproduce them to the cent, we refuse the file rather than show numbers we can't stand behind.
        </p>
        <div class="mt-3">
          <FileDropzone accept=".pdf,.xls,.xlsx,.xlsm,.csv,.htm,.html" :disabled="parsing" @files="onFiles" />
        </div>
        <p v-if="stage" class="mt-3 text-sm text-ink-secondary" role="status">{{ stage }}</p>
      </div>
    </div>
  </BaseCard>
</template>
