<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import { AppButton as BaseButton, AppCard as BaseCard, AppIcon } from "@silvicom/ui";
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
import DataWorkspace from "@/components/ui/DataWorkspace.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import TimelineRail, { type TimelineEntry } from "@/components/ui/TimelineRail.vue";
import TablePagination from "@/components/TablePagination.vue";
import FileDropzone from "@/components/ui/FileDropzone.vue";
import AssetDrawer from "@/features/inventory/AssetDrawer.vue";
import AssetMoveDrawer from "@/features/inventory/AssetMoveDrawer.vue";
import {
  useAssetMovementsQuery,
  useAssetQuery,
  useAttachAssetPhoto,
} from "@/features/inventory/useAssets";
import { useLocationsQuery } from "@/features/inventory/useInventory";
import { BADGE_BASE, assetMovementMarker, assetStatusBadge, toneClass } from "@/lib/badges";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";

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
 */

const route = useRoute();
const session = useSessionStore();
const toast = useToastStore();
const id = computed(() => String(route.params.id ?? ""));

const { data, isError, error, refetch } = useAssetQuery(id);
const asset = computed(() => data.value?.asset ?? null);
const canManage = computed(() => session.can("maintenance"));

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

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";

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

const photo = useAttachAssetPhoto();
async function onPhoto(files: File[]) {
  const file = files[0];
  if (!file || !asset.value) return;
  try {
    await photo.mutateAsync({ id: asset.value.id, file });
    toast.success("Photo added");
  } catch (e) {
    toast.error("Could not add the photo", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader :title="asset?.displayNo ?? 'Asset'" :description="asset?.name">
      <template v-if="asset && canManage" #actions>
        <BaseButton @click="acting = 'report'">Report a problem</BaseButton>
        <BaseButton @click="editing = true">Edit</BaseButton>
        <BaseButton variant="primary" @click="acting = 'move'">Move</BaseButton>
      </template>
    </PageHeader>

    <BaseCard v-if="isError" padding="md">
      <p class="text-sm text-ink">
        {{ error instanceof Error ? error.message : "Could not load the asset." }}
      </p>
      <BaseButton class="mt-3" @click="() => refetch()">Try again</BaseButton>
    </BaseCard>

    <template v-else-if="asset">
      <BaseCard padding="md">
        <div class="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <dl class="grid flex-1 grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            <div>
              <dt class="text-xs font-medium uppercase tracking-wide text-ink-muted">Where it is</dt>
              <dd class="mt-1 text-sm text-ink">
                {{ asset.holder.label ?? "Not placed" }}
                <!-- D-INV3: the driver is read off the truck at the moment somebody looks, and is
                     stored nowhere. There is no handover and no signature anywhere in this feature. -->
                <span v-if="asset.holder.inferredDriverName" class="block text-xs text-ink-tertiary">
                  with {{ asset.holder.inferredDriverName }}
                </span>
              </dd>
            </div>
            <div>
              <dt class="text-xs font-medium uppercase tracking-wide text-ink-muted">Since</dt>
              <dd class="mt-1 text-sm text-ink">
                {{ asset.holder.since ? fmtWhen(asset.holder.since) : "—" }}
              </dd>
            </div>
            <div>
              <dt class="text-xs font-medium uppercase tracking-wide text-ink-muted">Kind</dt>
              <dd class="mt-1 text-sm text-ink">{{ asset.assetTypeName }}</dd>
            </div>
            <div>
              <dt class="text-xs font-medium uppercase tracking-wide text-ink-muted">Condition</dt>
              <dd class="mt-1 text-sm text-ink">{{ ITEM_CONDITION_LABELS[asset.condition] }}</dd>
            </div>
            <div>
              <dt class="text-xs font-medium uppercase tracking-wide text-ink-muted">Serial</dt>
              <dd class="mt-1 font-mono text-xs text-ink">{{ asset.serialNumber ?? "—" }}</dd>
            </div>
            <div>
              <dt class="text-xs font-medium uppercase tracking-wide text-ink-muted">Make and model</dt>
              <dd class="mt-1 text-sm text-ink">
                {{ [asset.manufacturer, asset.model].filter(Boolean).join(" ") || "—" }}
              </dd>
            </div>
            <div>
              <dt class="text-xs font-medium uppercase tracking-wide text-ink-muted">Bought</dt>
              <dd class="mt-1 text-sm text-ink">{{ fmtDate(asset.purchasedAt) }}</dd>
            </div>
            <div>
              <dt class="text-xs font-medium uppercase tracking-wide text-ink-muted">Warranty until</dt>
              <dd class="mt-1 text-sm text-ink">{{ fmtDate(asset.warrantyExpiresAt) }}</dd>
            </div>
            <div v-if="asset.notes" class="col-span-2 sm:col-span-4">
              <dt class="text-xs font-medium uppercase tracking-wide text-ink-muted">Notes</dt>
              <dd class="mt-1 text-sm text-ink-secondary">{{ asset.notes }}</dd>
            </div>
          </dl>
          <div class="shrink-0 sm:w-40">
            <!-- Signed for 300 s (D-INV8) and re-signed with the query, so a page left open
                 overnight refetches rather than rendering a broken image. -->
            <img
              v-if="data?.photoUrl"
              :src="data.photoUrl"
              :alt="`Photo of ${asset.displayNo}`"
              class="size-28 rounded-surface object-cover ring-1 ring-edge"
            />
            <FileDropzone
              v-else-if="canManage"
              accept=".jpg,.jpeg,.png,.webp,.heic"
              label="Add a photo"
              hint="So the next person knows what to look for."
              :busy="photo.isPending.value"
              @files="onPhoto"
            />
          </div>
        </div>
        <div v-if="assetStatusBadge(asset.status)" class="mt-4">
          <!-- `[BADGE_BASE, toneClass(...)]`, not `AppBadge`: the primitive carries `capitalize`
               and title-cased "In repair" on a real render. See `AssetsPage.vue` for the whole note. -->
          <span :class="[BADGE_BASE, toneClass(assetStatusBadge(asset.status)!.tone)]">
            {{ assetStatusBadge(asset.status)!.label }}
          </span>
          <span v-if="asset.status === 'retired'" class="ml-2 text-xs text-ink-tertiary">
            Off the fleet. Its history stays, and its number is never reused.
          </span>
          <span v-else-if="asset.status === 'in_repair'" class="ml-2 text-xs text-ink-tertiary">
            Still counted as its unit's, and still missing from it.
          </span>
        </div>
      </BaseCard>

      <section class="space-y-3">
        <h2 class="text-lg font-semibold text-ink">History</h2>

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
        <DataWorkspace class="hidden lg:block">
          <DataTable
            embedded
            :columns="LEDGER_COLUMNS"
            :rows="rows"
            :loading="movements.isLoading.value"
            :error="movements.isError.value ? 'Could not load the history' : null"
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
            <template #cell-actorName="{ value }">{{ value ?? "—" }}</template>
            <template #cell-note="{ value }">{{ value ?? "—" }}</template>
            <template #empty>
              <p>Nothing has happened to it yet. Moving it onto a truck starts the history.</p>
            </template>
            <template #footer>
              <TablePagination
                :page="page"
                :page-size="50"
                :total="movements.data.value?.total ?? 0"
                @update:page="page = $event"
              />
            </template>
          </DataTable>
        </DataWorkspace>

        <!-- The rail renders nothing when empty (an empty rail is furniture that reports a
             finding), so the phone gets its own sentence rather than a blank card. -->
        <BaseCard v-if="!rows.length && !movements.isLoading.value" padding="md" class="lg:hidden">
          <p class="text-sm text-ink-secondary">
            Nothing has happened to it yet. Moving it onto a truck starts the history.
          </p>
        </BaseCard>
      </section>
    </template>

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
