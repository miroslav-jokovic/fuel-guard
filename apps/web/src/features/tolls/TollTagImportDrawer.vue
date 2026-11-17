<script setup lang="ts">
import { computed, ref } from "vue";
import { TOLL_PROVIDER_LABEL, TollTagSheetError, dayInZone, type TollTagImportResult, type TransponderDto, type Vehicle } from "@silvicom/shared";
import { AppBadge, AppButton, AppCallout, AppIcon, DataTable, type DataTableColumn } from "@silvicom/ui";
import { ArrowDownTrayIcon } from "@silvicom/ui/icons";
import SlideOver from "@/components/SlideOver.vue";
import FileDropzone from "@/components/ui/FileDropzone.vue";
import { useOrgTimezone } from "@/composables/useOrgTimezone";
import { useToastStore } from "@/stores/toast";
import {
  TOLL_TAG_SHEET_ACCEPT,
  changingLines,
  downloadTollTagSheet,
  previewTollTagFile,
  useImportTollTags,
  type TagPreview,
  type TagPreviewLine,
} from "./useTollTagImport";

/**
 * Import toll tags from a spreadsheet (TOLLS-PER-TRUCK-PLAN.md TL2b). A drawer, as every upload in the
 * product is (D-FUI3), in three steps the office can see: download the sheet of its trucks, fill it
 * in, drop it back. Nothing is written until the preview has said, line by line, what will happen —
 * add, move, start earlier, already right, or what to fix — and the office presses Import.
 *
 * Lines to fix are never sent; the rest go in parts and each comes back with what the API did, which
 * replaces the preview's guess. Importing the same sheet again is safe: lines already right change
 * nothing, so "fix the five lines and import it all again" is the way to finish.
 */
const props = defineProps<{ open: boolean; vehicles: readonly Vehicle[]; tags: readonly TransponderDto[] }>();
const emit = defineEmits<{ close: [] }>();

const { zone } = useOrgTimezone();
const toast = useToastStore();
const importer = useImportTollTags();
const preview = ref<TagPreview | null>(null);
const results = ref<Map<number, TollTagImportResult> | null>(null);
const reading = ref(false);
const fileError = ref<string | null>(null);
const preparing = ref(false);

const day = (iso: string) => dayInZone(iso, zone.value);

type Status = "add" | "move" | "backdate" | "unchanged" | "fix" | "added" | "moved" | "backdated" | "refused";
const STATUS: Record<Status, { label: string; tone: "neutral" | "info" | "success" | "caution" | "danger" }> = {
  add: { label: "Add", tone: "info" },
  move: { label: "Move", tone: "info" },
  backdate: { label: "Start earlier", tone: "info" },
  unchanged: { label: "Already right", tone: "neutral" },
  fix: { label: "Fix in the file", tone: "danger" },
  added: { label: "Added", tone: "success" },
  moved: { label: "Moved", tone: "success" },
  backdated: { label: "Started earlier", tone: "success" },
  refused: { label: "Not imported", tone: "danger" },
};

function statusOf(l: TagPreviewLine): Status {
  const done = results.value?.get(l.row.line);
  if (done) return done.outcome;
  if (!l.plan) return "fix";
  const k = l.plan.verdict.kind;
  return k === "refused" ? "fix" : k;
}

function whatHappens(l: TagPreviewLine): string {
  const done = results.value?.get(l.row.line);
  if (done?.message) return done.message;
  if (!l.plan) return l.row.problem ?? "";
  const v = l.plan.verdict;
  const unit = l.row.unit;
  const from = day(l.plan.item.at);
  if (v.kind === "refused") return v.reason;
  if (v.kind === "add") return `New tag, on unit ${unit} from ${from}.`;
  if (v.kind === "move") return v.fromUnit ? `Moves from unit ${v.fromUnit} to unit ${unit} on ${from}.` : `Goes on unit ${unit} from ${from}.`;
  if (v.kind === "backdate") return `On unit ${unit} from ${from} instead of ${day(v.previousFrom)}.`;
  return `On unit ${unit} since ${day(v.since)}.`;
}

const ORDER: Record<Status, number> = { fix: 0, refused: 0, add: 1, move: 1, backdate: 1, added: 1, moved: 1, backdated: 1, unchanged: 2 };
const rows = computed(() =>
  (preview.value?.lines ?? [])
    .map((l) => ({
      id: l.row.line,
      line: l.row.line,
      unit: l.row.unit || "—",
      tag: l.row.provider ? `${TOLL_PROVIDER_LABEL[l.row.provider]} ${l.row.tagNumber ?? l.row.tagText}` : `${l.row.providerText || "?"} ${l.row.tagText}`,
      status: statusOf(l),
      what: whatHappens(l),
    }))
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.line - b.line),
);
const counts = computed(() => {
  const c: Partial<Record<Status, number>> = {};
  for (const r of rows.value) c[r.status] = (c[r.status] ?? 0) + 1;
  return c;
});
const toSend = computed(() => (preview.value && !results.value ? changingLines(preview.value) : []));
const summary = computed(() =>
  (Object.keys(STATUS) as Status[])
    .filter((s) => counts.value[s])
    .map((s) => ({ status: s, text: `${counts.value[s]} ${STATUS[s].label.toLowerCase()}` })),
);

const columns: DataTableColumn[] = [
  { key: "line", label: "Line", numeric: true, cellClass: "text-ink-tertiary" },
  { key: "unit", label: "Truck", cellClass: "font-medium text-ink" },
  { key: "tag", label: "Tag" },
  { key: "status", label: "" },
  { key: "what", label: "What happens", cellClass: "text-ink-secondary" },
];

async function download() {
  preparing.value = true;
  try {
    await downloadTollTagSheet(props.vehicles, props.tags, zone.value);
  } catch (e) {
    toast.error("Could not make the sheet", e instanceof Error ? e.message : undefined);
  } finally {
    preparing.value = false;
  }
}

async function onFiles(files: File[]) {
  const file = files[0];
  if (!file) return;
  reading.value = true;
  fileError.value = null;
  results.value = null;
  try {
    preview.value = await previewTollTagFile(file, { tags: props.tags, vehicles: props.vehicles, zone: zone.value });
    if (preview.value.lines.length === 0) fileError.value = "No line in this sheet has a tag number. Fill in the tag numbers and import it again.";
  } catch (e) {
    preview.value = null;
    fileError.value = e instanceof TollTagSheetError ? e.message : "Could not read this file. Save it as Excel (.xlsx) or CSV and try again.";
  } finally {
    reading.value = false;
  }
}

async function runImport() {
  const lines = toSend.value;
  if (!lines.length) return;
  const done = await importer.run(lines);
  results.value = new Map(done.map((r) => [r.line, r]));
  const ok = done.filter((r) => r.outcome !== "refused" && r.outcome !== "unchanged").length;
  const refused = done.filter((r) => r.outcome === "refused").length;
  if (ok) toast.success(`${ok} ${ok === 1 ? "tag" : "tags"} saved`, refused ? `${refused} not imported; see the list.` : undefined);
  else if (refused) toast.error("Nothing was imported", "See each line for why.");
}

function close() {
  if (importer.running.value) return;
  preview.value = null;
  results.value = null;
  fileError.value = null;
  emit("close");
}
</script>

<template>
  <SlideOver
    :open="open"
    size="xl"
    title="Import toll tags"
    description="Many trucks at once, from a spreadsheet. Each line says which tag is on which truck, and from which day."
    @close="close"
  >
    <div class="space-y-6">
      <ol class="space-y-4 text-sm text-ink-secondary">
        <li class="flex flex-wrap items-center justify-between gap-3">
          <span><span class="font-medium text-ink">1. Download the sheet.</span> It lists every truck in service, with the tags already on file.</span>
          <AppButton size="sm" :disabled="preparing" data-test="tag-sheet-download" @click="download">
            <AppIcon :icon="ArrowDownTrayIcon" class="size-4" aria-hidden="true" />
            {{ preparing ? "Preparing…" : "Download the sheet" }}
          </AppButton>
        </li>
        <li>
          <span class="font-medium text-ink">2. Fill it in.</span> Provider, tag number and the day each tag went on the truck.
          Use the real day, even months back: tolls before it are not charged to that truck.
        </li>
        <li><span class="font-medium text-ink">3. Drop it here.</span> Nothing is saved until you have seen what each line does.</li>
      </ol>

      <FileDropzone
        :accept="TOLL_TAG_SHEET_ACCEPT"
        :busy="reading"
        :disabled="importer.running.value"
        label="Drop the filled-in sheet here"
        hint="Excel (.xlsx or .xls), OpenDocument (.ods) or CSV. Your own list works too, if it has Truck, Provider, Tag number and On truck since columns."
        @files="onFiles"
      />

      <AppCallout v-if="fileError" tone="danger" role="alert" data-test="tag-sheet-error">{{ fileError }}</AppCallout>

      <section v-if="preview && rows.length" aria-labelledby="tag-import-preview" class="space-y-3">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="tag-import-preview" class="text-sm font-semibold text-ink">{{ preview.fileName }}</h3>
          <p class="flex flex-wrap gap-1.5" data-test="tag-import-summary">
            <AppBadge v-for="s in summary" :key="s.status" :tone="STATUS[s.status].tone">{{ s.text }}</AppBadge>
          </p>
        </div>
        <p v-if="preview.trucksWithoutTag" class="text-xs text-ink-tertiary">
          {{ preview.trucksWithoutTag }} {{ preview.trucksWithoutTag === 1 ? "truck line has" : "truck lines have" }} no tag number and {{ preview.trucksWithoutTag === 1 ? "was" : "were" }} skipped.
        </p>
        <p v-if="(counts.fix ?? 0) > 0 && !results" class="text-xs text-ink-secondary">
          Lines to fix are left out. Fix them in the file and import it again; lines already right are not repeated.
        </p>
        <DataTable :columns="columns" :rows="rows" row-key="id" data-test="tag-import-lines">
          <template #cell-status="{ row }">
            <AppBadge :tone="STATUS[row.status as Status].tone" class="whitespace-nowrap">{{ STATUS[row.status as Status].label }}</AppBadge>
          </template>
        </DataTable>
      </section>
    </div>
    <template #footer>
      <AppButton variant="ghost" :disabled="importer.running.value" @click="close">{{ results ? "Done" : "Cancel" }}</AppButton>
      <AppButton v-if="!results" variant="primary" :disabled="toSend.length === 0 || importer.running.value" data-test="tag-import-run" @click="runImport">
        {{
          importer.running.value
            ? `Importing ${importer.sent.value} of ${toSend.length}…`
            : toSend.length
              ? `Import ${toSend.length} ${toSend.length === 1 ? "change" : "changes"}`
              : "Nothing to import"
        }}
      </AppButton>
    </template>
  </SlideOver>
</template>
