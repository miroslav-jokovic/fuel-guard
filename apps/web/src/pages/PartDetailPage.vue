<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import { AppButton as BaseButton, AppCard as BaseCard, AppIcon } from "@silvicom/ui";
import { PlusIcon } from "@silvicom/ui/icons";
import {
  ADJUST_REASON_LABELS,
  PART_MOVEMENT_REASON_LABELS,
  UNIT_OF_MEASURE_LABELS,
  type StockLineDto,
} from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import TablePagination from "@/components/TablePagination.vue";
import KebabMenu from "@/components/KebabMenu.vue";
import ErrorState from "@/components/ErrorState.vue";
import PartDrawer from "@/features/inventory/PartDrawer.vue";
import StockLineDrawer from "@/features/inventory/StockLineDrawer.vue";
import MovementDrawer, { type DeskVerb } from "@/features/inventory/MovementDrawer.vue";
import StockLevelCell from "@/features/inventory/StockLevelCell.vue";
import FileDropzone from "@/components/ui/FileDropzone.vue";
import {
  INVENTORY_PAGE_SIZE,
  useAttachPartPhoto,
  useLocationsQuery,
  useMovementsQuery,
  usePartQuery,
} from "@/features/inventory/useInventory";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";

/**
 * One part: what it is, where it sits, and everything that has happened to it
 * (INVENTORY-PLAN.md I4).
 *
 * ── THE PAGE IS SHAPED LIKE THE OTHER ENTITY PAGES, ON PURPOSE (2026-09-10) ───────────────────
 * A titled summary card with the status badge top-right, facts as `dt text-ink-muted` /
 * `dd font-medium`, `text-sm font-semibold` section headings, `ErrorState` for a failed fetch and a
 * loading line before the card — the anatomy `VehicleDetailPage.vue`, `DriverDetailPage.vue` and
 * `FuelCardDetailPage.vue` share. This page and its two siblings shipped with their own recipe
 * (headless card, uppercase KPI-style labels, badge under the facts, a hand-rolled "Try again"
 * card, `text-lg` headings), and the 2026-09-10 critique measured it as the pages reading foreign
 * beside the rest of the product. Lone tables are plain `DataTable`s: `DataWorkspace` is the
 * toolbar-plus-table shell and there is no toolbar here.
 *
 * The photo is a thumbnail in the card header when there is one, and a dropzone only while
 * somebody is adding one. The dropzone primitive is 256px tall, and sitting beside four facts it
 * made the card three-quarters empty — measured in a real render.
 *
 * ── THE LEDGER IS THE PAGE'S POINT ────────────────────────────────────────────────────────────
 * `part_movements` is the truth and the on-hand figure above it is a projection of these rows
 * (D-INV4). The question this page exists to answer is where the eleventh filter went, so the
 * history is a first-class paginated table rather than a "recent activity" tail — and it shows the
 * actor by NAME, which took the 2026-09-09 review to make true: `actorName` had been in the
 * contract since I1 with nothing ever passing one, so the ledger could only have shown a UUID.
 *
 * ── A TRANSFER IS TWO ROWS AND SAYS SO ────────────────────────────────────────────────────────
 * One call writes both legs, because the projection is per (part, location) and one row cannot move
 * it in two places. Both carry `transferGroupId`, and the reason column says "Transferred" on each;
 * without the pairing the ledger renders a transfer as two unexplained rows, one negative and one
 * positive, which is what shipped until the review put the column on the DTO.
 */

const route = useRoute();
const session = useSessionStore();
const toast = useToastStore();
const id = computed(() => String(route.params.id ?? ""));

const { data, isLoading, isError, error, refetch } = usePartQuery(id);
/**
 * ⚠ `includeInactive: true`, and only here. This list resolves NAMES for the ledger, and a movement
 * made into a bay that has since been closed still happened — an active-only list would render it
 * as "—" and quietly erase where the eleventh filter went. The shelf form below takes its own
 * active-only list, because a movement INTO a closed location is refused by the RPC (`IV012`) and
 * offering one would be an error the form could have prevented.
 */
const { data: locations } = useLocationsQuery(true);
/** The picker's own list: active only, for the reason above. */
const { data: openLocations } = useLocationsQuery();

const part = computed(() => data.value?.part ?? null);
const shelves = computed(() => data.value?.stock ?? []);

const page = ref(1);
const movementFilter = computed(() => ({ partId: id.value, page: page.value }));
const movements = useMovementsQuery(movementFilter);

/**
 * Location names for the ledger, read from the locations the page already holds.
 *
 * `partMovementDtoSchema` carries `locationId` and no name — a movement is a fact about ids — so
 * the name is resolved here rather than asked for a second time per row. Derived, not restated.
 */
const locationName = (locationId: string) =>
  locations.value?.find((l) => l.id === locationId)?.name ?? "—";

/**
 * ⚠ The route this calls shipped at I3 with NO consumer, and stayed that way until 2026-09-09: the
 * page rendered `photoUrl` and there was no way in the product to produce one. I8's asset drawer
 * shipped its screen alongside its route for exactly this reason; this is the parts half paid.
 */
const photo = useAttachPartPhoto();
const addingPhoto = ref(false);
async function onPhoto(files: File[]) {
  const file = files[0];
  if (!file || !part.value) return;
  try {
    await photo.mutateAsync({ id: part.value.id, file });
    toast.success("Photo added");
    addingPhoto.value = false;
  } catch (e) {
    toast.error("Could not add the photo", e instanceof Error ? e.message : undefined);
  }
}

const editing = ref(false);
/**
 * The verb drawers open from a SHELF ROW, because a movement is about one (part, location) pair —
 * the same reason `part_stock` has no surrogate id. A part that is not stocked anywhere yet has no
 * row to receive into, which is what "Add a shelf" is for: it creates the line at zero, and the
 * first receipt fills it.
 */
const moving = ref<{ verb: DeskVerb; line: StockLineDto } | null>(null);
const shelfEditing = ref<StockLineDto | null>(null);
const shelfAdding = ref(false);
const canManage = computed(() => session.can("maintenance"));

const SHELF_COLUMNS: DataTableColumn[] = [
  { key: "locationName", label: "Location", width: "lg" },
  { key: "quantityOnHand", label: "On hand", numeric: true },
  { key: "reorderPoint", label: "Reorder at", numeric: true },
  { key: "reorderQuantity", label: "Order", numeric: true },
];

const LEDGER_COLUMNS: DataTableColumn[] = [
  { key: "occurredAt", label: "When", width: "md", cellClass: "text-ink-secondary" },
  { key: "reason", label: "What happened", width: "md" },
  { key: "quantityDelta", label: "Change", numeric: true },
  { key: "locationId", label: "Location", cellClass: "text-ink-secondary" },
  { key: "actorName", label: "By", cellClass: "text-ink-secondary" },
  { key: "note", label: "Detail", cellClass: "text-ink-tertiary" },
];

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * The one line of detail a row carries beyond its reason.
 *
 * Composed here rather than in the template so the precedence is written down once: an adjustment's
 * mandatory reason first (an unexplained decrease is impossible by design), then a receipt's
 * supplier, then the work order the issue was for, then whatever was typed. A row with none of
 * those is a movement that needed no explanation.
 */
function detailOf(m: {
  adjustReason: string | null;
  supplier: string | null;
  workOrderRef: string | null;
  note: string | null;
}): string {
  const parts = [
    m.adjustReason ? ADJUST_REASON_LABELS[m.adjustReason as keyof typeof ADJUST_REASON_LABELS] : null,
    m.supplier,
    m.workOrderRef ? `Work order ${m.workOrderRef}` : null,
    m.note,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "—";
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader :title="part?.partNumber ?? 'Part'" :description="part?.description">
      <template v-if="part && canManage" #actions>
        <BaseButton @click="editing = true">Edit part</BaseButton>
      </template>
    </PageHeader>

    <ErrorState
      v-if="isError"
      :message="error instanceof Error ? error.message : 'Could not load the part.'"
      @retry="() => refetch()"
    />

    <p v-else-if="isLoading && !part" class="text-sm text-ink-tertiary">Loading the part…</p>

    <template v-else-if="part">
      <BaseCard>
        <div class="flex items-start justify-between gap-4">
          <div class="flex min-w-0 items-center gap-3">
            <!-- Signed for 300 s (D-INV8) and re-signed with the query, so a page left open overnight
                 refetches rather than rendering a broken image. -->
            <img
              v-if="data?.photoUrl"
              :src="data.photoUrl"
              :alt="`Photo of ${part.partNumber}`"
              class="size-12 shrink-0 rounded-surface object-cover ring-1 ring-edge"
            />
            <h2 class="text-sm font-semibold text-ink">Part summary</h2>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <BaseButton
              v-if="canManage && !data?.photoUrl && !addingPhoto"
              variant="ghost"
              size="sm"
              @click="addingPhoto = true"
            >
              Add a photo
            </BaseButton>
            <span v-if="!part.active" :class="[BADGE_BASE, toneClass('neutral')]">Retired</span>
          </div>
        </div>
        <dl class="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><dt class="text-ink-muted">Manufacturer</dt><dd class="font-medium text-ink">{{ part.manufacturer ?? "—" }}</dd></div>
          <div><dt class="text-ink-muted">Category</dt><dd class="font-medium text-ink">{{ part.category ?? "—" }}</dd></div>
          <div><dt class="text-ink-muted">Counted in</dt><dd class="font-medium text-ink">{{ UNIT_OF_MEASURE_LABELS[part.unitOfMeasure] }}</dd></div>
          <div><dt class="text-ink-muted">Barcode</dt><dd class="font-mono text-xs text-ink">{{ part.upc ?? "—" }}</dd></div>
          <div v-if="part.notes" class="col-span-2 sm:col-span-4">
            <dt class="text-ink-muted">Notes</dt>
            <dd class="text-ink-secondary">{{ part.notes }}</dd>
          </div>
        </dl>
        <p v-if="!part.active" class="mt-3 text-xs text-ink-tertiary">
          No longer carried. Its history stays, and it is not offered when issuing.
        </p>
        <FileDropzone
          v-if="addingPhoto && canManage"
          class="mt-4"
          accept=".jpg,.jpeg,.png,.webp,.heic"
          label="Add a photo"
          hint="So the next person picks the right one off the shelf."
          :busy="photo.isPending.value"
          @files="onPhoto"
        />
      </BaseCard>

      <section class="space-y-3">
        <div class="flex items-center justify-between gap-4">
          <h2 class="text-sm font-semibold text-ink">Shelves</h2>
          <BaseButton v-if="canManage" @click="shelfAdding = true">
            <AppIcon :icon="PlusIcon" class="-ml-0.5 size-5" aria-hidden="true" /> Add a shelf
          </BaseButton>
        </div>
          <DataTable
            :columns="SHELF_COLUMNS"
            :rows="shelves"
            :row-key="(r: StockLineDto) => `${r.partId}:${r.locationId}`"
            :loading="isLoading"
          >
            <template #cell-quantityOnHand="{ row }">
              <StockLevelCell :line="row" />
            </template>
            <template #actions="{ row }">
              <KebabMenu v-if="canManage">
                <BaseButton class="kebab-item" @click="moving = { verb: 'received', line: row }">
                  Receive
                </BaseButton>
                <BaseButton class="kebab-item" @click="moving = { verb: 'issued', line: row }">
                  Issue
                </BaseButton>
                <BaseButton class="kebab-item" @click="moving = { verb: 'transferred', line: row }">
                  Move
                </BaseButton>
                <BaseButton class="kebab-item" @click="shelfEditing = row">Edit shelf</BaseButton>
                <!-- Last, and separated: an adjustment is the only verb that admits an unexplained
                     decrease, which is why the contract demands a reason for it and no other. -->
                <BaseButton class="kebab-item" @click="moving = { verb: 'adjusted', line: row }">
                  Adjust the count
                </BaseButton>
              </KebabMenu>
            </template>
            <template #empty>
              <p>
                This part is not stocked anywhere yet. Add a shelf to say where it lives and how many
                is enough — the count itself comes from receiving it.
              </p>
            </template>
          </DataTable>
      </section>

      <section class="space-y-3">
        <h2 class="text-sm font-semibold text-ink">History</h2>
          <DataTable
            :columns="LEDGER_COLUMNS"
            :rows="movements.data.value?.movements ?? []"
            :loading="movements.isLoading.value"
            :error="movements.isError.value ? 'Could not load the movement history' : null"
            @retry="() => movements.refetch()"
          >
            <template #cell-occurredAt="{ value }">{{ fmtWhen(value) }}</template>
            <template #cell-reason="{ value }">
              {{ PART_MOVEMENT_REASON_LABELS[value as keyof typeof PART_MOVEMENT_REASON_LABELS] }}
            </template>
            <template #cell-quantityDelta="{ value }">
              <span :class="value < 0 ? 'font-semibold text-danger-700' : 'font-semibold text-ink'">
                {{ value > 0 ? `+${value}` : value }}
              </span>
            </template>
            <template #cell-locationId="{ value }">{{ locationName(value) }}</template>
            <template #cell-note="{ row }">{{ detailOf(row) }}</template>
            <template #empty>
              <p>Nothing has moved yet. Receiving the first delivery starts the history.</p>
            </template>
            <template #footer>
              <TablePagination
                :page="page"
                :page-size="INVENTORY_PAGE_SIZE"
                :total="movements.data.value?.total ?? 0"
                @update:page="page = $event"
              />
            </template>
          </DataTable>
      </section>
    </template>

    <PartDrawer v-if="part" :open="editing" :part="part" @close="editing = false" />
    <StockLineDrawer
      v-if="part && shelfAdding"
      :open="true"
      :part-id="part.id"
      :locations="openLocations ?? []"
      @close="shelfAdding = false"
    />
    <MovementDrawer
      v-if="moving"
      :open="true"
      :verb="moving.verb"
      :line="moving.line"
      :locations="openLocations ?? []"
      @close="moving = null"
    />
    <StockLineDrawer
      v-if="part && shelfEditing"
      :open="true"
      :part-id="part.id"
      :line="shelfEditing"
      :locations="openLocations ?? []"
      @close="shelfEditing = null"
    />
  </div>
</template>
