<script setup lang="ts">
import { computed, ref } from "vue";
import { AppButton as BaseButton, AppCard as BaseCard, QueryState, useQueryState } from "@silvicom/ui";
import type { AssetDto } from "@silvicom/shared";
import KebabMenu from "@/components/KebabMenu.vue";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useDriversQuery } from "@/composables/useDrivers";
import { useOpens } from "@/composables/useOpens";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { formatDate } from "@/lib/format";
import { useSessionStore } from "@/stores/session";
import AssignEquipmentDrawer from "./AssignEquipmentDrawer.vue";
import AssetMoveDrawer from "./AssetMoveDrawer.vue";
import { useAssetsQuery } from "./useAssets";
import { useReturnToShop } from "./useReturnToShop";
import { holderPartner, type AssignTarget } from "./assignLine";
import { useStartUnitCheck } from "./useStartUnitCheck";

/**
 * What a truck, trailer or driver holds, and the two things a person does to it: assign more by
 * scanning, and return one to the shop (EQUIPMENT-ASSIGN-BY-SCAN-PROPOSAL.md §3.3, EA1).
 *
 * ── ONE CARD ON EVERY HOLDER'S PAGE ───────────────────────────────────────────────────────────
 * The vehicle, trailer and driver pages and the shop's truck page all render this, so "what this
 * truck carries" has one spelling and one way to change it. It replaces the read-only `UnitKitCard`
 * (D-AVI17 said decisions belong on the shop's page; the owner overruled that 2026-10-30, Q-EA4) and
 * DE2b's `DriverEquipmentCard`, which listed a tablet but could not give one.
 *
 * ── A TRUCK'S LIST INCLUDES ITS DRIVER'S TABLET, READ-ONLY ────────────────────────────────────
 * The tablet is the driver's (D-DE1), but it rides in the truck, and D-DE4 already counts it in the
 * truck's kit. So a truck's card shows it as a row naming the driver — without Return, which belongs
 * on the driver's card where the tablet is held. The link is `vehicles.assigned_driver_id`, through
 * `holderPartner`, the same link the Assign list offers "Give to Dana Reyes instead" through.
 *
 * ── RETURN IS ONE TAP WHEN THE SHOP HAS ONE BAY ───────────────────────────────────────────────
 * `useReturnToShop` (shared with the Scan page since EA4): with one bay the move is written at once;
 * with more or none, the move drawer opens and asks.
 *
 * ── CHECK EQUIPMENT (EA3) ─────────────────────────────────────────────────────────────────────
 * On a truck's or trailer's card: opens the unit check (`useStartUnitCheck`), where each label is
 * scanned to tick it off. Not on the shop's truck page, whose header already carries the same verb
 * (`checkButton: false`), and not on a driver's — a check walks a unit, not a person.
 *
 * ── `?assign=1` OPENS THE ASSIGN LIST (DE4) ───────────────────────────────────────────────────
 * The owner's "scan the truck's label → its Assign list opens → scan the items → Confirm" (2026-10-30):
 * the Scan page sends a scanned truck or trailer label here with the flag, so the list is already open
 * when the page is. A flag in the query rather than a prop for the same reason Equipment's `?new=1` is
 * one (D-US2): closing the list removes the flag alone, and a back button does not reopen it.
 *
 * ── WHO SEES WHAT ─────────────────────────────────────────────────────────────────────────────
 * The list reads the shop's assets route, `maintenance: view` — the card renders nothing without it,
 * because a card full of blanks would say "this truck carries nothing", which is a different and
 * alarming claim (UnitKitCard's rule, kept). Assign, Return and Report are `maintenance` manage.
 */

const props = withDefaults(defineProps<{ target: AssignTarget; shopLink?: boolean; checkButton?: boolean }>(), {
  shopLink: true,
  checkButton: true,
});

const session = useSessionStore();
const opens = useOpens();
const maySee = computed(() => session.canView("maintenance"));
const canManage = computed(() => session.can("maintenance"));

const filter = computed(() => ({
  page: 1,
  ...(props.target.kind === "vehicle"
    ? { vehicleId: props.target.id }
    : props.target.kind === "trailer"
      ? { trailerId: props.target.id }
      : { driverId: props.target.id }),
}));
const q = useAssetsQuery(filter, maySee);
const rows = computed(() => q.data.value?.assets ?? []);
const total = computed(() => q.data.value?.total ?? 0);

const { data: vehicles } = useVehiclesQuery();
const { data: drivers } = useDriversQuery();
/** A truck's driver, whose tablet rides with it. Null for a trailer and for a driver's own card. */
const truckDriver = computed(() =>
  props.target.kind === "vehicle" ? holderPartner(props.target, vehicles.value, drivers.value) : null,
);
const driverFilter = computed(() => ({ page: 1, driverId: truckDriver.value?.id ?? "" }));
const driverQ = useAssetsQuery(driverFilter, computed(() => maySee.value && Boolean(truckDriver.value)));
const driverRows = computed(() => (truckDriver.value ? (driverQ.data.value?.assets ?? []) : []));

const assigning = useQueryState().flag("assign");
const check = useStartUnitCheck();
const canCheck = computed(() => props.checkButton && canManage.value && props.target.kind !== "driver");
const startCheck = () => check.startCheck(props.target.kind === "vehicle" ? "tractor" : "trailer", props.target.id);
const moving = ref<{ asset: AssetDto; mode: "move" | "report" } | null>(null);
/** Return to shop: one tap with one bay, the move drawer otherwise (`useReturnToShop`). */
const { giveBack: returnIt, returning, locations } = useReturnToShop();
async function giveBack(asset: AssetDto) {
  if (!(await returnIt(asset))) moving.value = { asset, mode: "move" };
}

const emptyText = computed(() =>
  props.target.kind === "driver" ? "No tablet is with this driver." : `Nothing is assigned to this ${props.target.kind === "trailer" ? "trailer" : "truck"} yet.`,
);
const shopRoute = computed(() =>
  props.target.kind === "driver" ? null : { name: "unit", params: { kind: props.target.kind === "vehicle" ? "tractor" : "trailer", id: props.target.id } },
);
</script>

<template>
  <BaseCard v-if="maySee" data-test="holder-equipment">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-sm font-semibold text-ink">
        Equipment<span v-if="total > 0" class="font-normal text-ink-tertiary"> ({{ total }})</span>
      </h2>
      <div class="flex flex-wrap items-center gap-2">
        <BaseButton v-if="canCheck" size="sm" :disabled="check.openWalk.isPending.value" data-test="check-open" @click="startCheck">
          Check equipment
        </BaseButton>
        <BaseButton v-if="canManage" size="sm" variant="primary" data-test="assign-open" @click="assigning = true">
          {{ target.kind === "driver" ? "Give a tablet" : "Assign equipment" }}
        </BaseButton>
      </div>
    </div>
    <QueryState
      compact
      :loading="q.isLoading.value"
      :error="q.isError.value"
      :retrying="q.isFetching.value"
      loading-text="Loading the equipment…"
      error-text="Could not load the equipment."
      @retry="q.refetch()"
    >
      <p v-if="rows.length === 0 && driverRows.length === 0" class="mt-3 text-sm text-ink-muted">{{ emptyText }}</p>
      <ul v-else class="mt-3 divide-y divide-edge-subtle">
        <li v-for="a in rows" :key="a.id" class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2" data-test="holder-row">
          <div class="min-w-0">
            <RouterLink :to="{ name: 'asset', params: { id: a.id } }" class="text-sm font-medium text-ink hover:underline">
              <span class="font-mono text-xs text-ink-secondary">{{ a.displayNo }}</span> {{ a.name }}
            </RouterLink>
            <p class="mt-0.5 text-xs text-ink-tertiary">
              {{ a.assetTypeName }}
              <template v-if="a.imei"> · IMEI …{{ a.imei.slice(-5) }}</template>
              <template v-if="a.holder.since"> · since {{ formatDate(a.holder.since) }}</template>
            </p>
          </div>
          <div class="flex items-center gap-2">
            <span v-if="a.holder.notReturned" :class="[BADGE_BASE, toneClass('danger')]">Not returned</span>
            <template v-if="canManage">
              <BaseButton size="sm" :disabled="returning === a.id" data-test="holder-return" @click="giveBack(a)">
                {{ returning === a.id ? "Returning…" : "Return to shop" }}
              </BaseButton>
              <KebabMenu>
                <BaseButton class="kebab-item" @click="moving = { asset: a, mode: 'report' }">Report missing or damaged</BaseButton>
              </KebabMenu>
            </template>
          </div>
        </li>
        <li v-for="a in driverRows" :key="a.id" class="py-2" data-test="holder-driver-row">
          <RouterLink :to="{ name: 'asset', params: { id: a.id } }" class="text-sm font-medium text-ink hover:underline">
            <span class="font-mono text-xs text-ink-secondary">{{ a.displayNo }}</span> {{ a.name }}
          </RouterLink>
          <p class="mt-0.5 text-xs text-ink-tertiary">{{ a.assetTypeName }} · with driver {{ truckDriver?.label }}</p>
        </li>
      </ul>
      <RouterLink
        v-if="shopLink && shopRoute && opens(shopRoute)"
        :to="shopRoute"
        class="mt-4 inline-block text-sm font-medium text-link hover:text-link-hover"
      >
        Open in the shop
      </RouterLink>
    </QueryState>
    <AssignEquipmentDrawer v-if="assigning && canManage" :open="true" :target="target" @close="assigning = false" />
    <AssetMoveDrawer
      v-if="moving"
      :open="true"
      :asset="moving.asset"
      :mode="moving.mode"
      :locations="locations ?? []"
      @close="moving = null"
    />
  </BaseCard>
</template>
