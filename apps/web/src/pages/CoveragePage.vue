<script setup lang="ts">
import { computed, watch } from "vue";
import { RouterLink } from "vue-router";
import { useDetectionCoverage, useCapacityHealth } from "@/features/fuel/useDetectionCoverage";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { DataTable } from "@silvicom/ui";
import { DataWorkspace } from "@silvicom/ui";
import { type DataTableColumn } from "@silvicom/ui";
import { AppCard as BaseCard } from "@silvicom/ui";
import { FilterBar } from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import StatCard from "@/components/ui/StatCard.vue";
import SamsaraFeedLine from "@/components/SamsaraFeedLine.vue";
import { TablePagination } from "@silvicom/ui";
import { formatDateTime as fmtDateTime } from "@/lib/format";
import GatedLink from "@/components/GatedLink.vue";
import { useOpens } from "@/composables/useOpens";
import { useQueryState } from "@silvicom/ui";

const { data, isLoading, isError, refetch, isFetching } = useDetectionCoverage();
const { data: capacity } = useCapacityHealth();
const { data: vehicles } = useVehiclesQuery();
const opens = useOpens();

const unit = (id: string) => vehicles.value?.find((v) => v.id === id)?.unit_number ?? id;
const trucks = computed(() => data.value?.perTruck ?? []);

// Search and page live in the URL (D-US2), so reload, a pasted link and Back from a truck keep the list.
const qs = useQueryState();
const search = qs.param("search");
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return q ? trucks.value.filter((t) => unit(t.vehicleId).toLowerCase().includes(q)) : trucks.value;
});

const PAGE_SIZE = 20;
const page = qs.page();
// Reset on the SEARCH, not on `filtered`: `filtered` also changes when the coverage data arrives, and
// watching it would throw a pasted `?page=3` away the moment the list loaded (D-US2).
watch(search, () => (page.value = 1));
const paged = computed(() =>
  filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE),
);

const fmtPct = (n: number) => `${Math.round(n)}%`;

/**
 * A share of nothing is not a share (F14, US6b). With no fills in the window the aggregator answers 0
 * for every percentage — and the capacity tile 100 for a roster with no fuel trucks — so the strip
 * drew five red "0%" tiles and one green "100%": a verdict on a fleet with nothing to judge. A tile
 * whose denominator is zero shows a dash, no tone, and says why.
 */
const share = (pct: number, of: number) => (of > 0 ? fmtPct(pct) : "—");
const shareTone = (pct: number, of: number) => (of > 0 ? covTone(pct) : undefined);
const NO_FILLS = "No fills in the last 90 days to check";

// Higher coverage = greener; blind share inverts the scale.
const covTone = (p: number) =>
  p >= 85 ? "text-success-700" : p >= 50 ? "text-warning-600" : "text-danger-700";
const blindTone = (p: number) =>
  p <= 15 ? "text-success-700" : p <= 50 ? "text-warning-600" : "text-danger-700";

const columns: DataTableColumn[] = [
  { key: "vehicleId", label: "Truck", cellClass: "font-medium text-ink" },
  { key: "fills", label: "Fills", numeric: true, cellClass: "text-ink-secondary" },
  { key: "blindFills", label: "Not matched", numeric: true },
  { key: "reconciledPct", label: "Samsara", numeric: true },
  { key: "locationPct", label: "Location", numeric: true },
  { key: "odometerPct", label: "Odometer", numeric: true },
  { key: "attributedPct", label: "Matched to truck", numeric: true },
];
</script>

<template>
  <div class="space-y-6">
    <PageHeader>
      How many fills in the last 90 days could be checked against Samsara, and which trucks could not
      be. A fill with no Samsara match is still checked on its own numbers, but not against where the
      truck was or its real odometer. So for a truck with many unmatched fills, "not flagged" means less.
      This is the limit on how much the system can catch.
    </PageHeader>

    <!-- SAM-S5: how current the telematics behind this page is, before its numbers are believed.
         The page IS the per-fill corroboration figure — stats and identity change nothing on it. -->
    <SamsaraFeedLine :feeds="['telematics']" />

    <div
      v-if="!isLoading && !isError && data"
      class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
    >
      <StatCard
        label="Checked against Samsara"
        :value="share(data.reconciledPct, data.totalFills)"
        :value-tone="shareTone(data.reconciledPct, data.totalFills)"
        :sub="data.totalFills ? `${data.blindFills.toLocaleString()} of ${data.totalFills.toLocaleString()} fills not matched` : NO_FILLS"
      />
      <StatCard
        label="Location-confirmed"
        :value="share(data.locationConfirmedPct, data.totalFills)"
        :value-tone="shareTone(data.locationConfirmedPct, data.totalFills)"
        :sub="data.totalFills ? `GPS placed the truck at the station · ${fmtPct(data.locationPct)} could be checked (including in the right state)` : NO_FILLS"
      />
      <StatCard
        label="Odometer-verifiable"
        :value="share(data.odometerPct, data.totalFills)"
        :value-tone="shareTone(data.odometerPct, data.totalFills)"
        :sub="data.totalFills ? 'fueling-time odometer available' : NO_FILLS"
      />
      <StatCard
        label="Attributed"
        :value="share(data.attributedPct, data.totalFills)"
        :value-tone="shareTone(data.attributedPct, data.totalFills)"
        :sub="data.totalFills ? `${data.unattributed.toLocaleString()} unmatched to a truck/driver` : NO_FILLS"
      />
      <StatCard
        v-if="capacity"
        label="Tank capacity set"
        :value="share(capacity.setPct, capacity.fuelVehicles)"
        :value-tone="shareTone(capacity.setPct, capacity.fuelVehicles)"
      >
        <template #sub>
          <span :title="capacity.missing.map((m) => m.unit).join(', ')">
            {{
              !capacity.fuelVehicles
                ? "No active fuel trucks on the roster"
                : capacity.missing.length
                ? `${capacity.missing.length} truck${capacity.missing.length > 1 ? "s" : ""} missing (capacity rules dead): ${capacity.missing
                    .slice(0, 4)
                    .map((m) => m.unit)
                    .join(", ")}${capacity.missing.length > 4 ? "…" : ""}`
                : "all fuel trucks have a tank capacity"
            }}
          </span>
        </template>
        <p
          v-if="capacity.divergent.length"
          class="text-warning-600"
          :title="
            capacity.divergent
              .map(
                (d) =>
                  `${d.unit}: entered ${d.enteredGal} gal, tank measures ~${d.sensorGal} gal (${d.diffPct}% off)`,
              )
              .join('\n')
          "
        >
          ⚠ {{ capacity.divergent.length }} entered capacit{{
            capacity.divergent.length > 1 ? "ies look" : "y looks"
          }}
          wrong vs the tank's own measurement:
          {{
            capacity.divergent
              .slice(0, 3)
              .map((d) => `${d.unit} (${d.enteredGal}→~${d.sensorGal})`)
              .join(", ")
          }}{{ capacity.divergent.length > 3 ? "…" : "" }}
          — alerts run on the measured value; fix the entry on the Fleet page.
        </p>
      </StatCard>
      <StatCard
        label="Card identity"
        :value="share(data.cardIdentifiablePct, data.cardFills)"
        :value-tone="shareTone(data.cardIdentifiablePct, data.cardFills)"
      >
        <template #sub>
          <span v-if="!data.cardFills">No card fills in the last 90 days to check</span>
          <span
            v-else
            title="A masked last-4 with no Driver Control ID can't be told apart from another card — those fills are invisible to card-misuse checks"
          >
            {{ data.cardBlindFills.toLocaleString() }} of {{ data.cardFills.toLocaleString() }} card
            fills could not be tied to one card
          </span>
        </template>
      </StatCard>
    </div>

    <!-- Fueling-time confidence mix -->
    <BaseCard v-if="data && data.totalFills > 0" padding="sm">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          How sure the fill time is
        </h3>
        <p class="text-xs text-ink-tertiary">
          Last matched with Samsara: {{ fmtDateTime(data.lastReconciledAt) }}
          <!-- SP5: Coverage is `settings` view, Data & sync is `settings` manage — a reader of one may not open the other. -->
          <template v-if="opens('/settings/data')">
            ·
            <RouterLink to="/settings/data" class="text-link hover:text-link-hover">Re-sync</RouterLink>
          </template>
        </p>
      </div>
      <div class="mt-2 flex flex-wrap gap-2 text-sm">
        <span
          class="inline-flex items-center gap-1.5 rounded-full bg-success-50 px-3 py-1 ring-1 ring-success-200"
          ><span class="font-medium text-success-800">Tank-confirmed</span
          ><span class="text-success-700">{{ data.timeBasis.tank_confirmed }}</span></span
        >
        <span
          class="inline-flex items-center gap-1.5 rounded-full bg-info-50 px-3 py-1 ring-1 ring-info-200"
          ><span class="font-medium text-info-800">Stop-estimated</span
          ><span class="text-info-700">{{ data.timeBasis.stop_estimated }}</span></span
        >
        <span
          class="inline-flex items-center gap-1.5 rounded-full bg-warning-50 px-3 py-1 ring-1 ring-warning-200"
          ><span class="font-medium text-warning-800">Reported time</span
          ><span class="text-warning-700">{{ data.timeBasis.reported }}</span></span
        >
        <span
          class="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-3 py-1 ring-1 ring-edge"
          ><span class="font-medium text-ink-secondary">Date only</span
          ><span class="text-ink-secondary">{{ data.timeBasis.date_only }}</span></span
        >
        <span
          class="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-3 py-1 ring-1 ring-edge"
          ><span class="font-medium text-ink-secondary">No Samsara data</span
          ><span class="text-ink-secondary">{{ data.timeBasis.none }}</span></span
        >
      </div>
    </BaseCard>

    <DataWorkspace>
      <FilterBar
        v-model:search="search"
        embedded
        search-placeholder="Search truck…"
        :count="filtered.length"
        count-label="trucks"
      />

      <p v-if="!isLoading && !isError && trucks.length > 0" class="px-4 py-3 text-xs text-ink-muted">
        Trucks with the most unmatched fills first. These are where the checks are weakest.
      </p>
      <DataTable
        embedded
        :columns="columns"
        :rows="paged"
        row-key="vehicleId"
        :loading="isLoading"
        :error="isError ? 'Could not load the coverage.' : null"
        :retrying="isFetching"
        empty-text="No fuel activity in the last 90 days."
        @retry="refetch"
      >
        <template #cell-vehicleId="{ row }">
          <GatedLink :to="`/vehicles/${row.vehicleId}`" class="text-link hover:text-link-hover">{{
            unit(row.vehicleId)
          }}</GatedLink>
        </template>
        <template #cell-fills="{ value }">{{ value.toLocaleString() }}</template>
        <template #cell-blindFills="{ row }">
          <span class="font-medium" :class="blindTone(row.blindPct)"
            >{{ row.blindFills }} ({{ fmtPct(row.blindPct) }})</span
          >
        </template>
        <template #cell-reconciledPct="{ value }">
          <span :class="covTone(value)">{{ fmtPct(value) }}</span>
        </template>
        <template #cell-locationPct="{ value }">
          <span :class="covTone(value)">{{ fmtPct(value) }}</span>
        </template>
        <template #cell-odometerPct="{ value }">
          <span :class="covTone(value)">{{ fmtPct(value) }}</span>
        </template>
        <template #cell-attributedPct="{ value }">
          <span :class="covTone(value)">{{ fmtPct(value) }}</span>
        </template>
        <template #footer>
          <TablePagination
            :page="page"
            :page-size="PAGE_SIZE"
            :total="filtered.length"
            @update:page="page = $event"
          />
        </template>
      </DataTable>
    </DataWorkspace>
  </div>
</template>
