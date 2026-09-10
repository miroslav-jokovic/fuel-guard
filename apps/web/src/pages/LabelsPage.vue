<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { AppButton as BaseButton, AppCard as BaseCard, AppSegmentedControl } from "@silvicom/ui";
import type { LabelPresetId } from "@silvicom/qr";
import type { LabelTarget } from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import LabelSheetPreview from "@/features/inventory/LabelSheetPreview.vue";
import LabelStockControls from "@/features/inventory/LabelStockControls.vue";
import { useAssetsQuery } from "@/features/inventory/useAssets";
import { useStockQuery } from "@/features/inventory/useInventory";
import { fetchLabelSheet, useLabelFaces, useLabelPresetsQuery } from "@/features/inventory/useLabels";
import { useToastStore } from "@/stores/toast";

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
 */

const route = useRoute();
const toast = useToastStore();

type Source = "stock" | "assets";
const source = ref<Source>("stock");
const search = ref("");
const selected = ref<Set<string>>(new Set());

const presetId = ref<LabelPresetId>("avery-22805");
const startPosition = ref(1);
const nudgeX = ref(0);
const nudgeY = ref(0);

const { data: presets } = useLabelPresetsQuery();
const { data: stock, isLoading: stockLoading } = useStockQuery(ref(undefined));
const assetsFilter = ref({ page: 1, search: "" });
const { data: assets, isLoading: assetsLoading } = useAssetsQuery(assetsFilter);
watch(search, (v) => (assetsFilter.value = { page: 1, search: v }));

const faces = useLabelFaces();
const printing = ref(false);

/**
 * A stock line has no id of its own — it is one part at one location — so the table key is the pair
 * that identifies it, joined. `targetOf` is the only place that string is taken apart again.
 */
const keyOf = (t: LabelTarget) =>
  t.kind === "stock" ? `stock:${t.partId}:${t.locationId}` : `asset:${t.assetId}`;

function targetOf(key: string): LabelTarget | null {
  const [kind, a, b] = key.split(":");
  if (kind === "stock" && a && b) return { kind: "stock", partId: a, locationId: b };
  if (kind === "asset" && a) return { kind: "asset", assetId: a };
  return null;
}

const targets = computed(() =>
  [...selected.value].map(targetOf).filter((t): t is LabelTarget => t !== null),
);

/** One id may arrive in the URL — a detail page's "print this label". */
watch(
  () => route.query,
  (q) => {
    const assetId = typeof q.asset === "string" ? q.asset : null;
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
watch(
  targets,
  async (list) => {
    if (list.length === 0) return;
    try {
      await faces.mutateAsync(list);
    } catch (e) {
      toast.error("Could not read those labels", e instanceof Error ? e.message : undefined);
    }
  },
  { deep: true, immediate: true },
);

const stockRows = computed(() => {
  const term = search.value.trim().toLowerCase();
  const lines = stock.value?.lines ?? [];
  if (!term) return lines;
  return lines.filter(
    (l) =>
      l.partNumber.toLowerCase().includes(term) ||
      l.partDescription.toLowerCase().includes(term) ||
      l.locationName.toLowerCase().includes(term),
  );
});

const stockColumns: DataTableColumn[] = [
  { key: "partNumber", label: "Part" },
  { key: "partDescription", label: "Description" },
  { key: "locationName", label: "Location" },
  { key: "tagCode", label: "Label" },
];

const assetColumns: DataTableColumn[] = [
  { key: "displayNo", label: "Number" },
  { key: "name", label: "Name" },
  { key: "assetTypeName", label: "Kind" },
  { key: "tagCode", label: "Label" },
];

async function print() {
  if (targets.value.length === 0) return;
  printing.value = true;
  try {
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
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Pick what needs a label, choose the stock, and print the sheet.">
      <template #actions>
        <BaseButton
          variant="primary"
          :disabled="targets.length === 0 || printing"
          @click="print"
        >
          {{ printing ? "Preparing…" : `Print ${targets.length || ""}`.trim() }}
        </BaseButton>
      </template>
    </PageHeader>

    <div class="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div class="space-y-4">
        <FilterBar v-model:search="search" search-placeholder="Search" :count="targets.length" count-label="labels">
          <AppSegmentedControl
            label="What to label"
            :model-value="source"
            :options="[
              { value: 'stock', label: 'Shelves' },
              { value: 'assets', label: 'Assets' },
            ]"
            @update:model-value="((source = $event as Source), (selected = new Set()))"
          />
        </FilterBar>

        <BaseCard padding="none">
          <DataTable
            v-if="source === 'stock'"
            :columns="stockColumns"
            :rows="stockRows"
            :loading="stockLoading"
            :row-key="(r) => keyOf({ kind: 'stock', partId: r.partId, locationId: r.locationId })"
            selectable
            :selected="selected"
            @update:selected="selected = $event"
          >
            <template #cell-tagCode="{ row }">
              <span v-if="row.tagCode" class="font-mono text-xs text-ink-secondary">{{ row.tagCode }}</span>
              <!-- A shelf with no label yet is the normal case and not a warning: a tag is issued
                   when one is first printed, which is what this screen is for. -->
              <span v-else class="text-xs text-ink-tertiary">None yet</span>
            </template>
            <template #empty>Nothing on the shelves yet.</template>
          </DataTable>

          <DataTable
            v-else
            :columns="assetColumns"
            :rows="assets?.assets ?? []"
            :loading="assetsLoading"
            :row-key="(r) => keyOf({ kind: 'asset', assetId: r.id })"
            selectable
            :selected="selected"
            @update:selected="selected = $event"
          >
            <template #cell-tagCode="{ row }">
              <span v-if="row.tagCode" class="font-mono text-xs text-ink-secondary">{{ row.tagCode }}</span>
              <span v-else class="text-xs text-ink-tertiary">None yet</span>
            </template>
            <template #empty>No assets yet.</template>
          </DataTable>
        </BaseCard>
      </div>

      <div class="space-y-4">
        <BaseCard padding="md">
          <LabelStockControls
            v-if="presets"
            :presets="presets"
            :preset-id="presetId"
            :start-position="startPosition"
            :nudge-x="nudgeX"
            :nudge-y="nudgeY"
            @update:preset-id="presetId = $event as LabelPresetId"
            @update:start-position="startPosition = $event"
            @update:nudge-x="nudgeX = $event"
            @update:nudge-y="nudgeY = $event"
          />
        </BaseCard>

        <LabelSheetPreview
          v-if="faces.data.value?.faces.length"
          :faces="faces.data.value.faces"
          :preset-id="presetId"
          :start-position="startPosition"
          :nudge-x="nudgeX"
          :nudge-y="nudgeY"
        />
        <p v-else class="text-sm text-ink-tertiary">
          Tick what needs a label and the sheet appears here.
        </p>
      </div>
    </div>
  </div>
</template>
