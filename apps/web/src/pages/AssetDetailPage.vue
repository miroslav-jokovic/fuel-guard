<script setup lang="ts">
import { acceptFor, INVENTORY_PHOTO_CONTENT_TYPES } from "@silvicom/shared";
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import {
  AppButton as BaseButton,
  AppCard as BaseCard,
  AppIcon,
  DataTable,
  type DataTableColumn,
  TablePagination,
  QueryState,
  FactList,
  type Fact,
} from "@silvicom/ui";
import {
  ArchiveBoxIcon,
  ArrowsRightLeftIcon,
  CheckCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
  type Icon,
} from "@silvicom/ui/icons";
import {
  ASSET_MOVEMENT_REASON_LABELS,
  ITEM_CONDITION_LABELS,
  type AssetMovementDto,
  type AssetMovementReason,
} from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import TimelineRail, { type TimelineEntry } from "@/components/ui/TimelineRail.vue";
import FileDropzone from "@/components/ui/FileDropzone.vue";
import AssetDrawer from "@/features/inventory/AssetDrawer.vue";
import AssetMoveDrawer from "@/features/inventory/AssetMoveDrawer.vue";
import {
  ASSETS_PAGE_SIZE,
  useAssetMovementsQuery,
  useAssetQuery,
  useAttachAssetPhoto,
} from "@/features/inventory/useAssets";
import { useLocationsQuery } from "@/features/inventory/useInventory";
import { BADGE_BASE, assetMovementMarker, assetStatusBadge, toneClass } from "@/lib/badges";
import { useOpens } from "@/composables/useOpens";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { formatDate as fmtDate, formatDateTime as fmtWhen } from "@/lib/format";

/**
 * One asset: what it is, who has it, and everywhere it has been (INVENTORY-PLAN.md I8).
 *
 * ── THE HISTORY IS THE PAGE'S POINT, AND IT IS RENDERED TWICE ─────────────────────────────────
 * `asset_movements` is the truth and the holder columns above it are a projection of these rows;
 * the question the page exists to answer is "which tablet, and where was it before". The plan asks
 * for a timeline AND the same history as a table on desktop, and the split is not decoration: a
 * rail with day headers is what reads on a phone in a bay, and six columns is what a desk screen
 * can compare. One query feeds both — the second render is markup, not a second fetch.
 *
 * ── AN ICON PER REASON, AND THE TONE COMES FROM `movesHolder` ─────────────────────────────────
 * Seven reasons, seven glyphs, so the rail can be scanned for the row that matters — and none of
 * them is invented here: `assetMovementMarker` in `@/lib/badges` decides the dot's colour by asking
 * `movesHolder`, the same function the contract's two schemas and the drawer's endpoint choice ask.
 *
 * ── "SINCE WHEN" COMES FROM THE DETAIL AND IS NULL IN THE LIST ────────────────────────────────
 * Deliberate, at the API: it is the occurred_at of the last movement that actually MOVED the thing
 * (a fridge reported missing in March has been 654's since January), which is one bounded query for
 * one asset and would be an unbounded one for a page.
 *
 * ── SHAPED LIKE THE OTHER ENTITY PAGES (2026-09-10) ───────────────────────────────────────────
 * Titled summary card, status badge top-right, plain fact labels, `text-sm` section headings,
 * `QueryState` for the loading line and the failure with its retry, plain `DataTable` for the lone table, and the photo dropzone only
 * while somebody is adding one. `PartDetailPage.vue` carries the reasoning in full.
 */

const route = useRoute();
const session = useSessionStore();
const toast = useToastStore();
const id = computed(() => String(route.params.id ?? ""));

const { data, isLoading, isError, error, refetch, isFetching } = useAssetQuery(id);
const asset = computed(() => data.value?.asset ?? null);
const canManage = computed(() => session.can("maintenance"));
const opens = useOpens();
const labelLink = computed(() => ({ path: "/shop/labels", query: { asset: id.value } }));

const page = ref(1);
const movements = useAssetMovementsQuery(id, page);
const rows = computed<AssetMovementDto[]>(() => movements.data.value?.movements ?? []);

/** Active only: a move into a bay that has been closed is refused by 0333 (`IV012`). */
const { data: locations } = useLocationsQuery();

const editing = ref(false);
const acting = ref<"move" | "report" | null>(null);

const REASON_ICONS: Record<AssetMovementReason, Icon> = {
  assigned: ChevronRightIcon,
  removed: ChevronLeftIcon,
  transferred: ArrowsRightLeftIcon,
  // Not a warning triangle: "it is not there" is a different claim from "it is broken", and the
  // two are the reports a kit check produces most often. Distinct glyphs so the rail separates them.
  reported_missing: XCircleIcon,
  reported_damaged: ExclamationTriangleIcon,
  found: CheckCircleIcon,
  retired: ArchiveBoxIcon,
};

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/**
 * Where a movement put the thing, as a sentence.
 *
 * `assetMovementDtoSchema` carries ids and a kind and no label — a movement is a fact about ids, and
 * resolving three joins per row at both ends would be six joins a row for names the page can spell
 * from what it already holds. A report has no destination at all, which is the whole of D-INV24.
 */
const holderLabel = (h: AssetMovementDto["toHolder"]): string | null => {
  if (!h?.id) return null;
  if (h.kind === "location") return locations.value?.find((l) => l.id === h.id)?.name ?? "a bay";
  return h.kind === "vehicle" ? "a truck" : "a trailer";
};

const whereTo = (m: AssetMovementDto): string => {
  const to = holderLabel(m.toHolder);
  if (to) return `to ${to}`;
  return m.reason === "retired" ? "off the fleet" : m.toHolder ? "" : "— nothing moved";
};

/** The rail's rows. The movement itself is looked up by key, so `TimelineRail` stays content-free. */
const entries = computed<TimelineEntry[]>(() =>
  rows.value.map((m) => ({ key: m.id, at: m.occurredAt, marker: assetMovementMarker(m.reason) })),
);
const byKey = computed(() => new Map(rows.value.map((m) => [m.id, m])));

const LEDGER_COLUMNS: DataTableColumn[] = [
  { key: "occurredAt", label: "When", width: "md", cellClass: "text-ink-secondary" },
  { key: "reason", label: "What happened", width: "md" },
  { key: "toHolder", label: "Where it went" },
  { key: "condition", label: "Condition", cellClass: "text-ink-secondary" },
  { key: "actorName", label: "By", cellClass: "text-ink-secondary" },
  { key: "note", label: "Detail", cellClass: "text-ink-tertiary" },
];

/**
 * The summary card's facts (D-US6). A blank is `null`, so `FactList` draws its em dash; the dates are
 * only formatted when there is one, because `fmtDate`'s own "—" would read as a value. Notes join the
 * grid as one more fact when there are any — FactList has no full-width row.
 */
const facts = computed<Fact[]>(() => {
  const a = asset.value;
  if (!a) return [];
  return [
    { key: "holder", label: "Where it is", value: a.holder.label ?? "Not placed" },
    { label: "Since", value: a.holder.since ? fmtWhen(a.holder.since) : null },
    { label: "Kind", value: a.assetTypeName },
    { label: "Condition", value: ITEM_CONDITION_LABELS[a.condition] },
    { label: "Serial", value: a.serialNumber },
    { label: "Make and model", value: [a.manufacturer, a.model].filter(Boolean).join(" ") || null },
    { label: "Bought", value: a.purchasedAt ? fmtDate(a.purchasedAt) : null },
    { label: "Warranty until", value: a.warrantyExpiresAt ? fmtDate(a.warrantyExpiresAt) : null },
    ...(a.notes ? [{ label: "Notes", value: a.notes }] : []),
  ];
});

const photo = useAttachAssetPhoto();
const addingPhoto = ref(false);
async function onPhoto(files: File[]) {
  const file = files[0];
  if (!file || !asset.value) return;
  try {
    await photo.mutateAsync({ id: asset.value.id, file });
    toast.success("Photo added");
    addingPhoto.value = false;
  } catch (e) {
    toast.error("Could not add the photo", e instanceof Error ? e.message : undefined);
  }
}

/** What this upload takes, by mime and by every extension it is saved under (a Google Voice `.jfif` is a JPEG). */
const uploadAccept = acceptFor(INVENTORY_PHOTO_CONTENT_TYPES);
</script>

<template>
  <div class="space-y-6">
    <PageHeader :title="asset?.displayNo ?? 'Asset'" :description="asset?.name">
      <template v-if="asset" #actions>
        <!-- R7: one asset's label, one tap from the asset — the Labels screen already takes `?asset=`
             and preselects it. Gated on the screen opening (SP5), not on manage: the list pages'
             Labels link draws the same line. -->
        <BaseButton v-if="opens(labelLink)" :to="labelLink">Print label</BaseButton>
        <template v-if="canManage">
          <BaseButton @click="acting = 'report'">Report a problem</BaseButton>
          <BaseButton @click="editing = true">Edit</BaseButton>
          <BaseButton variant="primary" @click="acting = 'move'">Move</BaseButton>
        </template>
      </template>
    </PageHeader>

    <QueryState
      :loading="isLoading && !asset"
      :error="isError ? error : null"
      :retrying="isFetching"
      loading-text="Loading the asset…"
      error-text="Could not load the asset."
      not-found-text="That asset is not on the books. It may have been entered under another number, or the link is incomplete."
      @retry="refetch()"
    >
      <template v-if="asset">
        <BaseCard>
          <div class="flex items-start justify-between gap-4">
            <div class="flex min-w-0 items-center gap-3">
              <!-- Signed for 300 s (D-INV8) and re-signed with the query, so a page left open
                   overnight refetches rather than rendering a broken image. -->
              <img
                v-if="data?.photoUrl"
                :src="data.photoUrl"
                :alt="`Photo of ${asset.displayNo}`"
                class="size-12 shrink-0 rounded-surface object-cover ring-1 ring-edge"
              />
              <h2 class="text-sm font-semibold text-ink">Asset summary</h2>
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
              <!-- `[BADGE_BASE, toneClass(...)]`: the rule `apps/web/CLAUDE.md` states for every badge. -->
              <span
                v-if="assetStatusBadge(asset.status)"
                :class="[BADGE_BASE, toneClass(assetStatusBadge(asset.status)!.tone)]"
              >
                {{ assetStatusBadge(asset.status)!.label }}
              </span>
            </div>
          </div>
          <FactList class="mt-4" :facts="facts">
            <template #value-holder>
              {{ asset.holder.label ?? "Not placed" }}
              <!-- D-INV3: the driver is read off the truck at the moment somebody looks, and is
                   stored nowhere. There is no handover and no signature anywhere in this feature. -->
              <span v-if="asset.holder.inferredDriverName" class="block text-xs font-normal text-ink-tertiary">
                with {{ asset.holder.inferredDriverName }}
              </span>
            </template>
          </FactList>
          <p v-if="asset.status === 'retired'" class="mt-3 text-xs text-ink-tertiary">
            Off the fleet. Its history stays, and its number is never reused.
          </p>
          <p v-else-if="asset.status === 'in_repair'" class="mt-3 text-xs text-ink-tertiary">
            Still counted as its unit's, and still missing from it.
          </p>
          <FileDropzone
            v-if="addingPhoto && canManage"
            class="mt-4"
            :accept="uploadAccept"
            label="Add a photo"
            hint="So the next person knows what to look for."
            :busy="photo.isPending.value"
            @files="onPhoto"
          />
        </BaseCard>

        <section class="space-y-3">
          <h2 class="text-sm font-semibold text-ink">History</h2>

          <!-- The phone's read: a rail with sticky day headers. -->
          <BaseCard v-if="rows.length" padding="md" class="lg:hidden">
            <TimelineRail :entries="entries" group-by-day>
              <template #entry="{ entry }">
                <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <AppIcon
                    :icon="REASON_ICONS[byKey.get(entry.key)!.reason]"
                    class="size-4 shrink-0 text-ink-tertiary"
                    aria-hidden="true"
                  />
                  <span class="font-medium text-ink">
                    {{ ASSET_MOVEMENT_REASON_LABELS[byKey.get(entry.key)!.reason] }}
                    {{ whereTo(byKey.get(entry.key)!) }}
                  </span>
                  <span class="text-2xs text-ink-tertiary">{{ fmtTime(entry.at) }}</span>
                </div>
                <p class="text-xs text-ink-muted">
                  {{ byKey.get(entry.key)!.actorName ?? "Somebody" }}
                  <template v-if="byKey.get(entry.key)!.note">· {{ byKey.get(entry.key)!.note }}</template>
                </p>
              </template>
            </TimelineRail>
          </BaseCard>

          <!-- The desk's read: the same page of movements, comparable column by column. -->
            <DataTable
              class="hidden lg:block"
              :columns="LEDGER_COLUMNS"
              :rows="rows"
              :loading="movements.isLoading.value"
              :error="movements.isError.value ? 'Could not load the history.' : null"
              @retry="() => movements.refetch()"
            >
              <template #cell-occurredAt="{ value }">{{ fmtWhen(value) }}</template>
              <template #cell-reason="{ value }">
                {{ ASSET_MOVEMENT_REASON_LABELS[value as AssetMovementReason] }}
              </template>
              <template #cell-toHolder="{ row }">{{ whereTo(row) || "—" }}</template>
              <template #cell-condition="{ value }">
                {{ value ? ITEM_CONDITION_LABELS[value as keyof typeof ITEM_CONDITION_LABELS] : "—" }}
              </template>
              <template #empty>
                <p>Nothing has happened to it yet. Moving it onto a truck starts the history.</p>
              </template>
              <template #footer>
                <TablePagination
                  :page="page"
                  :page-size="ASSETS_PAGE_SIZE"
                  :total="movements.data.value?.total ?? 0"
                  @update:page="page = $event"
                />
              </template>
            </DataTable>

          <!-- The rail renders nothing when empty (an empty rail is furniture that reports a
               finding), so the phone gets its own sentence rather than a blank card. -->
          <BaseCard v-if="!rows.length && !movements.isLoading.value" padding="md" class="lg:hidden">
            <p class="text-sm text-ink-secondary">
              Nothing has happened to it yet. Moving it onto a truck starts the history.
            </p>
          </BaseCard>
        </section>
      </template>
    </QueryState>

    <AssetDrawer v-if="asset" :open="editing" :asset="asset" @close="editing = false" />
    <AssetMoveDrawer
      v-if="asset && acting"
      :open="true"
      :asset="asset"
      :mode="acting"
      :locations="locations ?? []"
      @close="acting = null"
    />
  </div>
</template>
