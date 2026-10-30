<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import {
  AppCard as BaseCard,
  AppSegmentedControl,
  QueryState,
  DataTable,
  type DataTableColumn,
  DataWorkspace,
  FilterBar,
  TablePagination,
  useQueryState,
} from "@silvicom/ui";
import type { LabelPresetId } from "@silvicom/qr";
import type { LabelTarget } from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import WalkActions, { type WalkAction } from "@/components/WalkActions.vue";
import LabelSheetPreview from "@/features/inventory/LabelSheetPreview.vue";
import LabelStockControls from "@/features/inventory/LabelStockControls.vue";
import UnitLabelTable from "@/features/inventory/UnitLabelTable.vue";
import { ASSETS_PAGE_SIZE, useAssetsQuery } from "@/features/inventory/useAssets";
import { STOCK_PAGE_SIZE, useStockPageQuery } from "@/features/inventory/useInventory";
import { fetchLabelSheet, useLabelFaces, useLabelPresetsQuery } from "@/features/inventory/useLabels";
import { DEFAULT_LABEL_PRESET, pickLabelPreset, rememberLabelPreset } from "@/features/inventory/labelStockChoice";
import { useToastStore } from "@/stores/toast";
import { jobStatusText, usePrintDefaultsQuery, usePrintersQuery, usePrintJob, usePrintLabels } from "@/composables/usePrinting";

/**
 * Printing labels (INVENTORY-PLAN.md I10 PR 2; D-INV25, research §5.15).
 *
 * ── THE PAGE PICKS ITS OWN THINGS, AND THAT WAS A DECISION ────────────────────────────────────
 * The obvious flow is to tick rows on Parts or Assets and carry the selection here. It was rejected
 * on a measurement rather than on taste: a run may be 240 targets, each a uuid, which is roughly
 * 9 KB of query string — past what browsers and proxies will carry — and the alternatives are a
 * Pinia store holding a selection across a navigation, or a route that only works when you arrived
 * from one particular screen. Both are a second place the selection lives. So the picker is here,
 * the source toggle swaps which list you are ticking, and Parts and Assets link across with no
 * state at all. A single row IS carried, as one id in the query, because a detail page's "print
 * this one" is a real want and one id in a URL is not a workaround.
 *
 * ── IT IS A DESK SCREEN, NOT A `ShopLayout` ONE ───────────────────────────────────────────────
 * The scan and count screens are `layout: "shop"` because they are a phone held standing up in a
 * bay. This is somebody at a computer next to a printer with a sheet of blank stock in their hand,
 * which is the app shell's posture exactly.
 *
 * ── THE PREVIEW IS DRAWN FROM THE FACES THE SERVER ISSUED, NEVER FROM A GUESS ─────────────────
 * `useLabelFaces` is a mutation, and asking for faces ISSUES a tag code to anything without one —
 * the API's `labels.ts` carries that argument. It means the preview shows the codes that will
 * actually be printed, which is the only version of a preview worth having. It also means the
 * preview is re-requested when the SELECTION changes and not when the stock does: which sheet you
 * print onto has no bearing on what a label says.
 *
 * ── ON THE ROLL, PRINT GOES STRAIGHT TO THE LABEL PRINTER ─────────────────────────────────────
 * The owner's rule (PRINTERS-AND-SCANNERS-PLAN.md, 2026-10-28): a printer chosen once in Settings is
 * used without asking. So when the stock is the 2" roll and a default label printer exists, Print
 * sends the job to it — from any device, no dialog — and the button's line says where it went and how
 * it came out. A SHEET stock still opens the PDF: a sheet is paper for an office printer, which the
 * label printer cannot feed, and that is the stock choosing the destination rather than a fallback.
 */

const route = useRoute();
const toast = useToastStore();

const printDefaults = usePrintDefaultsQuery();
const printerList = usePrintersQuery();
const printLabels = usePrintLabels();
const defaultPrinter = computed(
  () => printerList.data.value?.find((p) => p.id === printDefaults.data.value?.effectivePrinterId) ?? null,
);
const lastJobId = ref<string | null>(null);
const lastJob = usePrintJob(lastJobId);
watch(
  () => lastJob.data.value?.status,
  (status) => {
    const job = lastJob.data.value;
    if (!job) return;
    if (status === "printed") toast.success(jobStatusText(job));
    else if (status === "failed" || status === "unknown") toast.error("The label did not print", jobStatusText(job));
  },
);

// DE4: `units` — a truck or trailer gets its own label, read off the fleet's units (`UnitLabelTable`).
type Source = "stock" | "assets" | "units";
const source = ref<Source>("stock");
// The search is the list's one filter and lives in the URL (D-US2). The source switch and the ticks do
// not: the ticks cannot (the measurement above), and the switch clears them, so a link that restored
// the switch would restore it with nothing ticked — a half-state, not the reader's list. Neither is a
// filter, and the sheet layout beside them (stock, start position, nudge) is a printer setting.
const qs = useQueryState();
const search = qs.param("search");
const selected = ref<Set<string>>(new Set());

const presetId = ref<LabelPresetId>(DEFAULT_LABEL_PRESET);
const startPosition = ref(1);
const nudgeX = ref(0);
const nudgeY = ref(0);

// Every read here draws its own failure with a Retry (F3, US6b): before, a failed stock read was
// "Nothing on the shelves yet", and a failed presets read an empty white card.
const {
  data: presets,
  isLoading: presetsLoading,
  isError: presetsFailed,
  isFetching: presetsFetching,
  refetch: refetchPresets,
} = useLabelPresetsQuery();

/**
 * The stock this browser last printed onto, once the server has said it still offers it (R6;
 * `labelStockChoice.ts` argues the rest). Until the list arrives the screen draws the roll, which is
 * what the shop's printer holds.
 */
watch(
  presets,
  (offered) => {
    if (!offered?.length) return;
    const picked = pickLabelPreset(offered);
    if (picked) presetId.value = picked;
  },
  { immediate: true },
);

/**
 * A start position belongs to the sheet it was typed for. Leaving 20 standing after a switch from a
 * 24-up sheet to the one-label roll sent a run the API refuses with a 422 — a start the roll does not
 * have — from a control the roll no longer even shows.
 */
watch(presetId, (id) => {
  const perSheet = presets.value?.find((p) => p.id === id)?.perSheet ?? 1;
  if (startPosition.value > perSheet) startPosition.value = 1;
});

function chooseStock(id: LabelPresetId) {
  presetId.value = id;
  rememberLabelPreset(id);
}

/**
 * D-US8: both lists page, one page in the URL (D-US2) for whichever list is showing — they are never
 * on screen together, and the switch returns to page 1 as it clears the ticks.
 *
 * ── BOTH LISTS PAGE AND SEARCH THROUGH THE SERVER ─────────────────────────────────────────────
 * `/assets` answers fifty rows at a time with a `total` (ASSETS_PAGE_SIZE), and this table used to ask
 * for page 1 and show no pager — so asset 51 onward could never be ticked, and nothing on screen said
 * the list stopped. It now asks for the page the pager is on, as AssetsPage does. The shelves did the
 * same thing one size up until US6b F32: one 200-line response, searched and sliced here, so line 201
 * was unreachable. They ask the route for their page and their search too (`useStockPageQuery`).
 *
 * The ticks are a Set of keys held here, not the table's rows: a page change leaves a ticked row off
 * screen and still in the run, which is what a sheet of 240 labels across several pages needs.
 */
const page = qs.page();
watch(search, () => (page.value = 1));
const assetsFilter = computed(() => ({
  // On Shelves the assets are not shown, so their query stays on page 1 rather than fetching a page
  // of a list nobody is looking at.
  page: source.value === "assets" ? page.value : 1,
  search: search.value.trim() || undefined,
}));
// Each list asks for its page only while it is the one on screen, for the reason given just below.
const stockFilter = computed(() => ({
  page: source.value === "stock" ? page.value : 1,
  search: search.value.trim() || undefined,
}));
const {
  data: stock,
  isLoading: stockLoading,
  isError: stockFailed,
  isFetching: stockFetching,
  refetch: refetchStock,
} = useStockPageQuery(stockFilter);
const {
  data: assets,
  isLoading: assetsLoading,
  isError: assetsFailed,
  isFetching: assetsFetching,
  refetch: refetchAssets,
} = useAssetsQuery(assetsFilter);

const faces = useLabelFaces();
const printing = ref(false);

/**
 * A stock line has no id of its own — it is one part at one location — so the table key is the pair
 * that identifies it, joined. `targetOf` is the only place that string is taken apart again.
 */
const keyOf = (t: LabelTarget) =>
  t.kind === "stock" ? `stock:${t.partId}:${t.locationId}` : t.kind === "unit" ? `unit:${t.unitKind}:${t.unitId}` : `asset:${t.assetId}`;

function targetOf(key: string): LabelTarget | null {
  const [kind, a, b] = key.split(":");
  if (kind === "stock" && a && b) return { kind: "stock", partId: a, locationId: b };
  if (kind === "asset" && a) return { kind: "asset", assetId: a };
  if (kind === "unit" && (a === "vehicle" || a === "trailer") && b) return { kind: "unit", unitKind: a, unitId: b };
  return null;
}

const targets = computed(() =>
  [...selected.value].map(targetOf).filter((t): t is LabelTarget => t !== null),
);

/**
 * One id may arrive in the URL — a detail page's "print this label".
 *
 * Watched as that ONE parameter, not the whole query: the search now writes the query too, and a
 * watcher on all of it re-ran on every keystroke and threw the reader's ticks back to the one asset.
 */
watch(
  () => route.query.asset,
  (a) => {
    const assetId = typeof a === "string" ? a : null;
    if (assetId) {
      source.value = "assets";
      selected.value = new Set([keyOf({ kind: "asset", assetId })]);
    }
  },
  { immediate: true },
);

/**
 * Re-issue whenever the SELECTION moves. The stock choice does not change what a label says.
 *
 * ⚠ `immediate` is load-bearing, and its absence was a real defect the page test caught. The query
 * watcher above runs during setup and can arrive with a row already ticked; a watcher created after
 * it, without `immediate`, sees no CHANGE and never fires. The result was a page reached from a
 * detail screen's "print this label" that showed the row selected and an empty preview beside it —
 * with the Print button working, because that reads `targets` directly. A blank preview beside a
 * working button is the shape of bug somebody works around rather than reports.
 */
async function readFaces(list: LabelTarget[]) {
  if (list.length === 0) return;
  try {
    await faces.mutateAsync(list);
  } catch {
    // Drawn where the preview would be, with a Retry (F3) — a toast faded and left the hint saying
    // "tick what needs a label" beside rows that were ticked.
  }
}
watch(targets, readFaces, { deep: true, immediate: true });

const stockPage = computed(() => stock.value?.lines ?? []);
/** The showing list's row count, and the clamp that pulls the page back when that list shrinks. */
// Units clamp their own page (`UnitLabelTable`): their list is searched where it is shown.
const listTotal = computed(() => (source.value === "assets" ? assets.value?.total : source.value === "stock" ? stock.value?.total : null) ?? null);
watch(listTotal, (total) => {
  if (total === null) return;
  const maxPage = Math.max(1, Math.ceil(total / (source.value === "assets" ? ASSETS_PAGE_SIZE : STOCK_PAGE_SIZE)));
  if (page.value > maxPage) page.value = maxPage;
});
function switchSource(next: Source) {
  source.value = next;
  selected.value = new Set();
  page.value = 1;
}

const stockColumns: DataTableColumn[] = [
  { key: "partNumber", label: "Part", card: "title" },
  { key: "partDescription", label: "Description", card: "sentence" },
  { key: "locationName", label: "Location", card: "none" },
  { key: "tagCode", label: "Label", card: "meta" },
];

const assetColumns: DataTableColumn[] = [
  { key: "displayNo", label: "Number", card: "title" },
  { key: "name", label: "Name", card: "sentence" },
  { key: "assetTypeName", label: "Kind", card: "none" },
  { key: "tagCode", label: "Label", card: "meta" },
];

/** A one-label stock goes to the default label printer when there is one; a sheet goes to the PDF. */
const toPrinter = computed(
  () => Boolean(defaultPrinter.value) && presets.value?.find((p) => p.id === presetId.value)?.perSheet === 1,
);

async function print() {
  if (targets.value.length === 0) return;
  printing.value = true;
  try {
    if (toPrinter.value) {
      const { job } = await printLabels.mutateAsync({ targets: targets.value });
      lastJobId.value = job.id;
      return;
    }
    const url = await fetchLabelSheet(targets.value, {
      presetId: presetId.value,
      startPosition: startPosition.value,
      nudgeX: nudgeX.value,
      nudgeY: nudgeY.value,
    });
    // A blob rather than a navigation: the route sits behind `requireAuth` and a plain
    // `window.open` on an API path carries no Authorization header.
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    toast.error("Could not print those labels", e instanceof Error ? e.message : undefined);
  } finally {
    printing.value = false;
  }
}

/**
 * Print, in the header on a desk and the phone's bottom bar (contract §9 rule 2). Labels is a desk
 * screen (rule 6) — out of the phone's tab row — but reachable from Parts and Equipment, and a phone
 * that does open it prints to the shop's label printer like any other device.
 */
const actions = computed<WalkAction[]>(() => [
  {
    label: printing.value ? "Preparing…" : `Print ${targets.value.length || ""}`.trim(),
    primary: true,
    disabled: targets.value.length === 0 || printing.value,
    onClick: () => void print(),
  },
]);
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Pick what needs a label, choose the stock, and print.">
      <template #actions>
        <WalkActions :actions="actions" />
      </template>
    </PageHeader>
    <p class="-mt-4 text-sm text-ink-muted" data-testid="print-destination">
      <template v-if="toPrinter && lastJob.data.value">{{ jobStatusText(lastJob.data.value) }}.</template>
      <template v-else-if="toPrinter">Prints on {{ defaultPrinter?.name }}{{ defaultPrinter?.online ? "" : " — offline right now; labels wait until it is back" }}.</template>
      <template v-else-if="defaultPrinter">This stock is a sheet, so Print opens a PDF for an office printer.</template>
      <template v-else>Print opens a PDF. To print straight to a label printer from any device, set one up in Settings → Printers &amp; scanners.</template>
    </p>

    <div class="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div class="space-y-4">
        <DataWorkspace>
        <!-- "What to label" switches between two lists (shelves read from stock, assets from the asset
             register, each its own table and selection), so it is not a filter: only the search counts,
             and clearing leaves the switch where it is. -->
        <FilterBar
          embedded
          v-model:search="search"
          :search-placeholder="source === 'assets' ? 'Search number, name, serial or tag…' : source === 'units' ? 'Search unit number or driver…' : 'Search part #, description, location…'"
          :count="targets.length"
          count-label="labels"
          :active-count="search.trim() ? 1 : 0"
          @clear-all="qs.set({ search: undefined })"
        >
          <template #filters>
            <AppSegmentedControl
              label="What to label"
              :model-value="source"
              :options="[
                { value: 'stock', label: 'Shelves' },
                { value: 'assets', label: 'Equipment' },
                { value: 'units', label: 'Trucks & trailers' },
              ]"
              @update:model-value="switchSource($event as Source)"
            />
          </template>
        </FilterBar>
          <DataTable
            embedded
            v-if="source === 'stock'"
            :columns="stockColumns"
            :rows="stockPage"
            :loading="stockLoading"
            :error="stockFailed ? 'Could not load the shelves.' : null"
            :retrying="stockFetching"
            :row-key="(r) => keyOf({ kind: 'stock', partId: r.partId, locationId: r.locationId })"
            selectable
            :selected="selected"
            @update:selected="selected = $event"
            @retry="refetchStock()"
          >
            <template #cell-tagCode="{ row }">
              <span v-if="row.tagCode" class="font-mono text-xs text-ink-secondary">{{ row.tagCode }}</span>
              <!-- A shelf with no label yet is the normal case and not a warning: a tag is issued
                   when one is first printed, which is what this screen is for. -->
              <span v-else class="text-xs text-ink-tertiary">None yet</span>
            </template>
            <template #empty>{{ search.trim() ? "No shelf matches that search." : "Nothing on the shelves yet." }}</template>
            <template #footer>
              <TablePagination :page="page" :page-size="STOCK_PAGE_SIZE" :total="stock?.total ?? 0" :loading="stockLoading" @update:page="page = $event" />
            </template>
          </DataTable>

          <UnitLabelTable
            v-else-if="source === 'units'"
            :search="search"
            :page="page"
            :selected="selected"
            @update:selected="selected = $event"
            @update:page="page = $event"
          />

          <DataTable
            embedded
            v-else
            :columns="assetColumns"
            :rows="assets?.assets ?? []"
            :loading="assetsLoading"
            :error="assetsFailed ? 'Could not load the assets.' : null"
            :retrying="assetsFetching"
            :row-key="(r) => keyOf({ kind: 'asset', assetId: r.id })"
            selectable
            :selected="selected"
            @update:selected="selected = $event"
            @retry="refetchAssets()"
          >
            <template #cell-tagCode="{ row }">
              <span v-if="row.tagCode" class="font-mono text-xs text-ink-secondary">{{ row.tagCode }}</span>
              <span v-else class="text-xs text-ink-tertiary">None yet</span>
            </template>
            <template #empty>No equipment yet.</template>
            <template #footer>
              <TablePagination
                :page="page"
                :page-size="ASSETS_PAGE_SIZE"
                :total="assets?.total ?? 0"
                :loading="assetsFetching"
                @update:page="page = $event"
              />
            </template>
          </DataTable>
        </DataWorkspace>
      </div>

      <div class="space-y-4">
        <BaseCard padding="md">
          <QueryState
            compact
            :loading="presetsLoading"
            :error="presetsFailed"
            :retrying="presetsFetching"
            loading-text="Loading the label stock…"
            error-text="Could not load the label stock."
            @retry="refetchPresets()"
          >
            <LabelStockControls
              v-if="presets"
              :presets="presets"
              :preset-id="presetId"
              :start-position="startPosition"
              :nudge-x="nudgeX"
              :nudge-y="nudgeY"
              @update:preset-id="chooseStock($event as LabelPresetId)"
              @update:start-position="startPosition = $event"
              @update:nudge-x="nudgeX = $event"
              @update:nudge-y="nudgeY = $event"
            />
          </QueryState>
        </BaseCard>

        <!-- The preview's three states (F3): the faces the ticks will print, a failure to read them
             with a Retry, or — nothing ticked — the hint, in a card like the preview it stands for. -->
        <BaseCard v-if="targets.length && faces.isError.value" padding="md">
          <QueryState
            compact
            :loading="false"
            :error="true"
            :retrying="faces.isPending.value"
            error-text="Could not read those labels."
            @retry="readFaces(targets)"
          />
        </BaseCard>
        <LabelSheetPreview
          v-else-if="targets.length && faces.data.value?.faces.length"
          :faces="faces.data.value.faces"
          :preset-id="presetId"
          :start-position="startPosition"
          :nudge-x="nudgeX"
          :nudge-y="nudgeY"
        />
        <BaseCard v-else padding="md">
          <p class="text-sm text-ink-tertiary">Tick what needs a label and the sheet appears here.</p>
        </BaseCard>
      </div>
    </div>
    <WalkActions v-if="actions.length" :actions="actions" bar />
  </div>
</template>
