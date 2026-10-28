<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import { AppCard as BaseCard, FactList, type Fact, QueryState } from "@silvicom/ui";
import { repairSettled, todayInZone, type AssetDto, type RoadsideRepairDueDto, type UnitKitDto } from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import UnitFileSection from "@/components/files/UnitFileSection.vue";
import type { UnitFileSubject } from "@/components/files/fileSubject";
import UnitEquipmentSection from "@/features/inventory/UnitEquipmentSection.vue";
import WalkActions, { type WalkAction } from "@/features/inventory/WalkActions.vue";
import { useUnitKitQuery } from "@/features/inventory/useUnits";
import UnitAttentionCard from "@/features/maintenance/UnitAttentionCard.vue";
import UnitRepairsSection from "@/features/maintenance/UnitRepairsSection.vue";
import UnitRepairBillsLine from "@/features/maintenance/UnitRepairBillsLine.vue";
import UnitPmDueCard from "@/features/maintenance/UnitPmDueCard.vue";
import UnitAnnualCard from "@/features/maintenance/UnitAnnualCard.vue";
import { useUnitShopFileQuery, useUnitsAttentionQuery } from "@/features/maintenance/useUnitShop";
import UnitInspectionsCard from "@/features/roadside/UnitInspectionsCard.vue";
import { useRoadsideRepairsDueQuery } from "@/features/roadside/useRoadsideInspections";
import { useOrgTimezone } from "@/composables/useOrgTimezone";
import { useOpens } from "@/composables/useOpens";
import { useSessionStore } from "@/stores/session";

/**
 * The truck's page — the shop's hub for one truck or trailer (MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md
 * §4.3, D-MX3; FleetPal F10 + F11). One page, sections in the order the shop asks its questions, and
 * NO TABS: the driver page's six tabs are the worked example of what tabs hide.
 *
 *   1. Needs attention — this unit's rows from the Shop worklist, each linking down the page.
 *   2. In the shop / repair history — FleetPal's open orders, open defects and past orders (the record,
 *      D-INV10), with the bills in one line behind the coverage bound (D-FP4).
 *   3. Due — every PM schedule against the latest meter (F11, `pmStatus`).
 *   4. Annual inspection — our record's expiry, the last report, Start inspection.
 *   5. Equipment it carries — the kit controls that were this page until M3 (`UnitEquipmentSection`).
 *   6. Roadside inspections — the officer's record naming this unit (gated on the safety section).
 *   7. Papers — the unit's files (UF0–UF3).
 *
 * ── TWO ADDRESSES, ONE SET OF CARDS ───────────────────────────────────────────────────────────
 * The fleet section's `/vehicles/:id` and `/trailers/:id` keep their pages: they are gated on
 * `equipment`, which a technician holds as view and a dispatcher holds too, and they carry the fuel
 * history the shop has no business with. What they show of the shop — the kit, the open orders, the
 * roadside record — are the SAME components mounted here (`UnitKitCard` is the read-only window on
 * `UnitEquipmentSection`'s read; `UnitWorkOrdersCard` and `UnitRepairsSection` share one query), so
 * neither page is a second source of truth about the truck.
 *
 * ── THE VERBS, WHERE THE HAND IS ──────────────────────────────────────────────────────────────
 * Check what is on board and Start inspection (Q-MX1's three verbs, less Scan which is the home's)
 * are drawn once in the header from `sm` up and once as the phone's bottom bar (`WalkActions`).
 */
const route = useRoute();
const session = useSessionStore();
const opens = useOpens();
const { zone } = useOrgTimezone();
const today = computed(() => todayInZone(new Date(), zone.value));

const kind = computed(() => (String(route.params.kind ?? "") === "tractor" ? "tractor" : "trailer") as "tractor" | "trailer");
const unitId = computed(() => String(route.params.id ?? ""));

// ── the reads ──────────────────────────────────────────────────────────────────────────────────
const fileQ = useUnitShopFileQuery(kind, unitId);
const file = computed(() => fileQ.data.value ?? null);
const kitQ = useUnitKitQuery(kind, unitId);
const unit = computed<UnitKitDto | null>(() => kitQ.data.value?.unit ?? null);
const assets = computed<AssetDto[]>(() => kitQ.data.value?.assets ?? []);
const attentionQ = useUnitsAttentionQuery();
const reasons = computed(() => (attentionQ.data.value ?? []).find((u) => u.kind === kind.value && u.unitId === unitId.value)?.reasons ?? []);
// Roadside repairs due, matched by the unit the officer wrote (D-IC7) — the roadside card's rule.
const roadsideOpen = computed(() => opens("/shop/roadside-repairs"));
const roadsideQ = useRoadsideRepairsDueQuery(roadsideOpen);
const roadside = computed<RoadsideRepairDueDto[]>(() =>
  (roadsideQ.data.value ?? []).filter((r) => !repairSettled(r) && r.unit.kind === kind.value && file.value != null && r.unit.companyNumber === file.value.unit.unitNumber),
);
const attentionLoading = computed(() => attentionQ.isPending.value || (roadsideOpen.value && roadsideQ.isPending.value));
const attentionError = computed(() => attentionQ.isError.value || roadsideQ.isError.value);

// ── the header ─────────────────────────────────────────────────────────────────────────────────
const title = computed(() => (file.value ? `${kind.value === "tractor" ? "Truck" : "Trailer"} ${file.value.unit.unitNumber}` : "Truck or trailer"));
const description = computed(() => {
  const u = file.value?.unit;
  if (!u) return undefined;
  const model = [u.year, u.make, u.model].filter(Boolean).join(" ");
  // D-INV3: the driver is read off the truck at the moment somebody looks and is stored nowhere.
  const driver = unit.value?.inferredDriverName ? `Assigned to ${unit.value.inferredDriverName} right now` : null;
  return [model, driver].filter(Boolean).join(" · ") || undefined;
});
const facts = computed<Fact[]>(() => {
  const f = file.value;
  if (!f) return [];
  return [
    { label: "Plate", value: f.unit.plate },
    { label: "VIN", value: f.unit.vin },
    { label: "Odometer", value: f.unit.odometerMiles !== null ? `${f.unit.odometerMiles.toLocaleString("en-US")} mi` : null },
    { label: "FleetPal unit", value: f.fleetpal.number ?? (f.fleetpal.unitIds.length ? "Linked" : "Not linked") },
  ];
});
const fileSubject = computed<UnitFileSubject>(() => ({ type: kind.value, id: unitId.value }));

// ── the verbs ──────────────────────────────────────────────────────────────────────────────────
const equipment = ref<InstanceType<typeof UnitEquipmentSection> | null>(null);
const annual = ref<InstanceType<typeof UnitAnnualCard> | null>(null);
const actions = computed<WalkAction[]>(() => {
  if (!session.can("maintenance") || !file.value) return [];
  const list: WalkAction[] = [];
  if (unit.value) list.push({ label: "Check what is on board", primary: true, disabled: Boolean(equipment.value?.openWalk.isPending.value), onClick: () => void equipment.value?.startCheck() });
  if (opens("/shop/inspections")) list.push({ label: "Start inspection", onClick: () => annual.value?.start() });
  return list;
});
const billsOpen = computed(() => opens("/shop/repair-spend"));
</script>

<template>
  <div class="space-y-6 pb-20 sm:pb-0">
    <PageHeader :title="title" :description="description">
      <template v-if="actions.length" #actions>
        <WalkActions :actions="actions" />
      </template>
    </PageHeader>

    <QueryState
      :loading="fileQ.isPending.value && !fileQ.isError.value"
      :error="fileQ.isError.value ? fileQ.error.value : null"
      :retrying="fileQ.isFetching.value"
      loading-text="Loading…"
      error-text="Could not load this truck or trailer."
      not-found-text="That truck or trailer is not on the fleet. The link may be incomplete, or it belongs to another company."
      @retry="fileQ.refetch()"
    >
      <template v-if="file">
        <BaseCard><FactList :facts="facts" /></BaseCard>

        <UnitAttentionCard :reasons="reasons" :roadside="roadside" :today="today" :loading="attentionLoading" :error="attentionError" @retry="attentionQ.refetch(); roadsideQ.refetch()" />

        <UnitRepairsSection :file="file" />
        <UnitRepairBillsLine :kind="kind" :unit-id="unitId" :enabled="billsOpen" />

        <UnitPmDueCard :pm="file.pm" :fleetpal-meter="file.fleetpal.lastMeter" />

        <UnitAnnualCard ref="annual" :kind="kind" :unit-id="unitId" :unit-number="file.unit.unitNumber" :expires-on="file.unit.annualInspectionExpiresOn" :today="today" />

        <QueryState
          :loading="kitQ.isPending.value && !kitQ.isError.value"
          :error="kitQ.isError.value ? kitQ.error.value : null"
          :retrying="kitQ.isFetching.value"
          loading-text="Loading what it carries…"
          error-text="Could not load what it is carrying."
          @retry="kitQ.refetch()"
        >
          <UnitEquipmentSection v-if="unit" ref="equipment" :kind="kind" :unit-id="unitId" :unit="unit" :assets="assets" :loading="kitQ.isFetching.value" />
        </QueryState>

        <section id="section-roadside" class="scroll-mt-6">
          <UnitInspectionsCard :kind="kind" :unit-number="file.unit.unitNumber" :plate="file.unit.plate" />
        </section>

        <section id="section-papers" class="scroll-mt-6">
          <UnitFileSection :subject="fileSubject" :unit-number="file.unit.unitNumber" :plate="file.unit.plate" />
        </section>
      </template>
    </QueryState>

    <WalkActions v-if="actions.length" :actions="actions" bar />
  </div>
</template>
