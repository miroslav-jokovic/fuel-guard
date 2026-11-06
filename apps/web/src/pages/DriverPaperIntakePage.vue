<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { DQ_KIND_LABELS, PAPER_STACK_MAX_BYTES, type PaperIntakeItemDto, type PaperStackDto } from "@silvicom/shared";
import { AppCallout, AppCard as BaseCard, AppButton as BaseButton, DataTable, type DataTableColumn } from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import FileDropzone from "@/components/ui/FileDropzone.vue";
import SlideOver from "@/components/SlideOver.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { formatDate } from "@/lib/format";
import { useToastStore } from "@/stores/toast";
import { fetchPieceUrl, usePaperBatch, useUploadStack } from "@/features/roster/usePaperIntake";

/**
 * Drivers › Upload scanned files (DRIVER-PAPER-INTAKE-PLAN PI4). The office drops the PDFs the Brother
 * scanner saved — several driver folders each, every folder under its cover sheet (PI1) — and watches them
 * split (PI2) and read (PI3). What the reader found is listed per paper, on the scan's own page numbers,
 * with the pages a click away, so the person can see each proposal against the paper before anything is
 * filed. Filing and correcting are PI5's; nothing on this page writes to a driver's file.
 *
 * The drop's id is in the URL (`?batch=`), so a reload, a second tab or a link to a colleague shows the
 * same drop; a new drop on a page with no batch starts one.
 */
const route = useRoute();
const router = useRouter();
const toast = useToastStore();
const batchId = computed<string | null>(() => (typeof route.query.batch === "string" ? route.query.batch : null));
const batch = usePaperBatch(batchId);
const upload = useUploadStack();

async function onFiles(files: File[]): Promise<void> {
  const id = batchId.value ?? crypto.randomUUID();
  if (!batchId.value) await router.replace({ query: { ...route.query, batch: id } });
  for (const file of files) {
    if (file.size > PAPER_STACK_MAX_BYTES) {
      toast.error(`${file.name} is too large`, "A file can be up to 50 MB. Scan fewer folders at a time.");
      continue;
    }
    try {
      const { duplicate } = await upload.mutateAsync({ file, batchId: id });
      if (duplicate) toast.success(`${file.name} was already uploaded`, "It is shown with the drop it came in.");
    } catch (e) {
      toast.error(`Could not upload ${file.name}`, e instanceof Error ? e.message : undefined);
    }
  }
}

const stacks = computed<PaperStackDto[]>(() => batch.data.value?.stacks ?? []);
const items = computed<PaperIntakeItemDto[]>(() => batch.data.value?.items ?? []);
const fileNameOf = computed(() => new Map(stacks.value.map((s) => [s.id, s.fileName])));

/** What a stack is doing, in the office's words. */
function stackLine(s: PaperStackDto): { text: string; tone: string } {
  switch (s.status) {
    case "uploading":
      return { text: "Uploading…", tone: "neutral" };
    case "queued":
    case "splitting":
      return { text: "Finding the cover sheets…", tone: "neutral" };
    case "failed":
      return { text: s.failure ?? "Could not be split.", tone: "danger" };
    case "split": {
      const drivers = new Set(s.parts.flatMap((p) => (p.driverId ? [p.driverId] : []))).size;
      const unowned = s.parts.filter((p) => !p.driverId).reduce((n, p) => n + p.stackPages.length, 0);
      const bits = [`${s.pageCount} pages`, `${drivers} ${drivers === 1 ? "driver" : "drivers"}`];
      if (s.blankPageCount) bits.push(`${s.blankPageCount} blank ${s.blankPageCount === 1 ? "page" : "pages"} left out`);
      if (unowned) bits.push(`${unowned} ${unowned === 1 ? "page" : "pages"} with no cover sheet`);
      // Counted from the reading itself, never from the pieces list: the two are read at different moments
      // and a count that mixes them can read "4 of 3".
      const r = s.reading;
      const reading = r && r.pending > 0 ? `Reading ${r.done + r.failed} of ${r.done + r.pending + r.failed} pieces…` : null;
      return { text: [bits.join(" · "), reading].filter(Boolean).join(" — "), tone: r && r.failed > 0 ? "caution" : "neutral" };
    }
  }
}

/** "Pages 4–5" from the stack's own numbers, which may skip a blank page left out ("Pages 3, 5–6"). */
function pagesLabel(pages: number[]): string {
  const runs: Array<[number, number]> = [];
  for (const p of pages) {
    const last = runs[runs.length - 1];
    if (last && last[1] === p - 1) last[1] = p;
    else runs.push([p, p]);
  }
  const text = runs.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(", ");
  return `${pages.length === 1 ? "Page" : "Pages"} ${text}`;
}

const whoLabel = (i: PaperIntakeItemDto): string =>
  i.driverName ?? (i.driverId ? "A driver no longer on the roster" : "No driver yet");
const basisLabel = (i: PaperIntakeItemDto): string | null =>
  i.basis === "scope" ? "cover sheet" : i.basis === "cdl" ? "licence number" : i.basis === "name" ? "name on the paper" : null;
const kindLabel = (i: PaperIntakeItemDto): string =>
  i.kind ? (DQ_KIND_LABELS[i.kind] ?? i.kind) : i.unread ? "Could not be read" : "Not identified";

const columns: DataTableColumn[] = [
  { key: "driver", label: "Driver", width: "xl" },
  { key: "paper", label: "Paper", width: "xl" },
  { key: "pages", label: "Pages", headerClass: "w-40", cellClass: "text-ink-secondary" },
  { key: "dates", label: "Dates", headerClass: "w-48", cellClass: "text-ink-secondary" },
  { key: "view", label: "Scan", headerClass: "w-24" },
];

// ── the pages of one row, in the browser's own PDF viewer, opened at the row's first page ────────────
const viewing = ref<{ title: string; url: string } | null>(null);
async function view(i: PaperIntakeItemDto): Promise<void> {
  try {
    const url = await fetchPieceUrl(i.stackId, i.partIndex);
    viewing.value = { title: `${fileNameOf.value.get(i.stackId) ?? "Scan"} — ${pagesLabel(i.pages)}`, url: `${url}#page=${i.pieceFrom}` };
  } catch (e) {
    toast.error("Could not open those pages", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      description="Upload the PDFs the scanner saved: several driver folders per file, each under its cover sheet. Each paper is found and listed for you to check. Nothing is filed until somebody does."
    />

    <BaseCard>
      <FileDropzone
        accept="application/pdf,.pdf"
        multiple
        :busy="upload.isPending.value"
        busy-label="Uploading…"
        label="Drag & drop the scanned PDFs here"
        hint="PDF only, up to 50 MB a file — about five to ten folders. Print cover sheets from Drivers first."
        @files="onFiles"
      />
    </BaseCard>

    <BaseCard v-if="stacks.length" padding="none">
      <ul class="divide-y divide-edge" data-testid="stacks">
        <li v-for="s in stacks" :key="s.id" class="flex flex-wrap items-baseline justify-between gap-2 px-6 py-3">
          <span class="text-sm font-medium text-ink">{{ s.fileName }}</span>
          <span :class="['text-sm', stackLine(s).tone === 'danger' ? 'text-danger-600' : stackLine(s).tone === 'caution' ? 'text-warning-700' : 'text-ink-secondary']">
            {{ stackLine(s).text }}
          </span>
        </li>
      </ul>
    </BaseCard>

    <AppCallout v-if="items.length" tone="info">
      Check each paper against its pages. Filing them into the drivers' files comes next; nothing here has been filed yet.
    </AppCallout>

    <template v-if="batchId">
      <!-- ui-adoption: unpaged — one drop is a few folders' papers (PLAN §5: five to ten folders a file), well under one page (D-US8). -->
      <DataTable
        :columns="columns"
        :rows="items"
        row-key="id"
        :loading="batch.isLoading.value"
        :error="batch.isError.value ? 'Could not load the uploads.' : null"
        :retrying="batch.isFetching.value"
        empty-text="No papers found yet. They appear here as each piece is read."
        @retry="batch.refetch()"
      >
        <template #cell-driver="{ row }">
          <span class="text-ink">{{ whoLabel(row as PaperIntakeItemDto) }}</span>
          <span v-if="basisLabel(row as PaperIntakeItemDto)" class="mt-0.5 block text-xs text-ink-muted">by {{ basisLabel(row as PaperIntakeItemDto) }}</span>
        </template>
        <template #cell-paper="{ row }">
          <span :class="[(row as PaperIntakeItemDto).kind ? 'text-ink' : 'text-ink-muted']">{{ kindLabel(row as PaperIntakeItemDto) }}</span>
          <span v-if="(row as PaperIntakeItemDto).title" class="mt-0.5 block text-xs text-ink-muted">“{{ (row as PaperIntakeItemDto).title }}”</span>
          <span v-if="(row as PaperIntakeItemDto).status !== 'pending'" :class="['mt-1', BADGE_BASE, toneClass('neutral')]">{{ (row as PaperIntakeItemDto).status }}</span>
        </template>
        <template #cell-pages="{ row }">{{ pagesLabel((row as PaperIntakeItemDto).pages) }}</template>
        <template #cell-dates="{ row }">
          <span v-if="(row as PaperIntakeItemDto).issuedOn">{{ formatDate((row as PaperIntakeItemDto).issuedOn) }}</span>
          <span v-if="(row as PaperIntakeItemDto).expiresOn" class="block">until {{ formatDate((row as PaperIntakeItemDto).expiresOn) }}</span>
          <span v-if="!(row as PaperIntakeItemDto).issuedOn && !(row as PaperIntakeItemDto).expiresOn" class="text-ink-tertiary">—</span>
        </template>
        <template #cell-view="{ row }">
          <BaseButton variant="ghost" size="sm" class="px-0 font-medium text-link hover:text-link-hover" :aria-label="`View ${pagesLabel((row as PaperIntakeItemDto).pages)}`" @click="view(row as PaperIntakeItemDto)">View</BaseButton>
        </template>
      </DataTable>
    </template>

    <SlideOver :open="viewing !== null" size="xl" :title="viewing?.title ?? 'Scan'" @close="viewing = null">
      <iframe v-if="viewing" :src="viewing.url" title="Scanned pages" class="h-[80vh] w-full rounded-control ring-1 ring-edge" />
    </SlideOver>
  </div>
</template>
