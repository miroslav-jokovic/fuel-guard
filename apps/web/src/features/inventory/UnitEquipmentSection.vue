<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { AppButton as BaseButton, AppCard as BaseCard, DataTable, type DataTableColumn } from "@silvicom/ui";
import { KIT_EXPECTATION_SOURCE_LABELS, KIT_RULES_SHOWN, type UnitKitDto, type UnitKitLineDto } from "@silvicom/shared";
import HolderEquipmentCard from "./HolderEquipmentCard.vue";
import UnitOverrideDrawer from "./UnitOverrideDrawer.vue";
import OpenCountsList from "./OpenCountsList.vue";
import { useOpenCountSession } from "./useInventory";
import { BADGE_BASE, kitStatusBadge, toneClass } from "@/lib/badges";
import { formatDate, formatDateTime } from "@/lib/format";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";

/**
 * Equipment it carries — the shop's controls over one unit's kit (INVENTORY-PLAN.md I9), as a section
 * of the truck's page (MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md §4.3, M3). Until M3 this WAS the
 * shop's unit page; the page became the hub and this became its fifth section, unchanged in what it
 * does. Since EA1 its On board table is `HolderEquipmentCard`, the card the fleet's truck and trailer
 * pages show too (EQUIPMENT-ASSIGN-BY-SCAN-PROPOSAL.md §3.3).
 *
 * ── TWO TABLES, BECAUSE THEY ANSWER TWO QUESTIONS ─────────────────────────────────────────────
 * The KIT is by kind of thing — "two load bars expected, one held" — and is what a yard walk is
 * planned from. The ASSETS are the individual things with numbers on them, and are what a person
 * standing at the truck actually touches. Folding them into one table would mean either losing the
 * shortfall (which has no single asset behind it) or repeating the expectation on every row.
 *
 * ── SHOULD CARRY IS HIDDEN (EA2, `KIT_RULES_SHOWN`) ───────────────────────────────────────────
 * The kit summary, its badge, the Should carry table and "What this one should carry" render only
 * while the switch is on. Hidden, the tab is what the truck holds (the card, with Assign and Return),
 * when it was last checked, and any check left open — the code below stays, tested behind the switch.
 *
 * ── REMOVING SOMETHING IS A MOVE, NOT A DELETE ────────────────────────────────────────────────
 * "Take it off this truck" is Return to shop on `HolderEquipmentCard` — `move_asset` with a
 * destination, because an asset is always somewhere and a row that stopped naming a holder without a
 * movement would leave the ledger unable to say where the thing went (D-INV3).
 */
const props = defineProps<{ kind: "tractor" | "trailer"; unitId: string; unit: UnitKitDto; loading: boolean }>();

const router = useRouter();
const session = useSessionStore();
const toast = useToastStore();
const canManage = computed(() => session.can("maintenance"));

const overriding = ref(false);

/**
 * Start a walk of this unit (D-INV19).
 *
 * The session id is the SERVER's, exactly as a shelf count's is: a walk is opened with the network
 * up, because the screen cannot show what to check without it, and two taps of Start must not make
 * two walks. `blind` is false — a kit check is not a blind count, because the whole question is
 * "is the thing the system names actually here", which cannot be asked without naming it.
 */
const openWalk = useOpenCountSession();
async function startCheck() {
  try {
    const walk = await openWalk.mutateAsync({
      kind: "unit",
      ...(props.kind === "tractor" ? { vehicleId: props.unitId } : { trailerId: props.unitId }),
      blind: false,
    });
    // R9: the server hands back this unit's open check rather than starting a second walk, and the
    // screen says so — a technician who expected a fresh list should know answers are already in it.
    if (walk.resumed) {
      toast.info("Continuing the open check", `Started ${formatDateTime(walk.openedAt)}${walk.startedByName ? ` by ${walk.startedByName}` : ""}.`);
    }
    void router.push({ name: "count-session", params: { sessionId: walk.id } });
  } catch (e) {
    toast.error("Could not start the check", e instanceof Error ? e.message : undefined);
  }
}
defineExpose({ startCheck, openWalk });

const KIT_COLUMNS: DataTableColumn[] = [
  { key: "assetTypeName", label: "What it should carry", card: "title" },
  { key: "expected", label: "Expected", card: "none", numeric: true },
  { key: "held", label: "On the unit", card: "none", numeric: true },
  { key: "delta", label: "Difference", card: "meta", numeric: true },
  { key: "source", label: "Rule from", card: "sentence", cellClass: "text-ink-tertiary" },
];
/** Only the lines worth a row: expected here, or actually carried and unexpected. */
const kitLines = computed<UnitKitLineDto[]>(() => props.unit.lines.filter((l) => l.expected > 0 || l.held > 0));
</script>

<template>
  <section id="section-equipment" class="scroll-mt-6 space-y-4" data-test="unit-equipment">
    <BaseCard v-if="KIT_RULES_SHOWN">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 class="text-sm font-semibold text-ink">Equipment it carries</h2>
        <div class="flex items-center gap-3">
          <span v-if="kitStatusBadge(unit.state)" :class="[BADGE_BASE, toneClass(kitStatusBadge(unit.state)!.tone)]">
            {{ kitStatusBadge(unit.state)!.label }}
          </span>
          <BaseButton v-if="canManage" size="sm" @click="overriding = true">What this one should carry</BaseButton>
        </div>
      </div>
      <p class="mt-3 text-sm text-ink">
        <span v-if="unit.shortBy">Missing {{ unit.shortBy }}</span>
        <span v-else-if="unit.extraBy">Carrying {{ unit.extraBy }} more than the kit asks for</span>
        <span v-else>Carrying everything it should</span>
      </p>
      <!-- R10: a shortfall on a unit nobody has walked is the records, not the truck. -->
      <p class="mt-1 text-sm text-ink-secondary">
        {{ unit.lastCheckedAt ? `Last checked ${formatDate(unit.lastCheckedAt)}` : "Never checked — the list above is what the records say" }}
      </p>
    </BaseCard>

    <!-- EA1: what is on board is the same card the fleet's truck and trailer pages show, with Assign
         and Return on it — one spelling of "what this truck carries" and one way to change it. -->
    <HolderEquipmentCard
      :target="{ kind: kind === 'tractor' ? 'vehicle' : 'trailer', id: unitId, label: `${kind === 'tractor' ? 'Truck' : 'Trailer'} ${unit.unitNumber}` }"
      :shop-link="false"
    />
    <p v-if="!KIT_RULES_SHOWN" class="text-sm text-ink-secondary" data-test="unit-last-checked">
      {{ unit.lastCheckedAt ? `Last checked ${formatDate(unit.lastCheckedAt)}` : "Never checked — the list above is what the records say" }}
    </p>

    <OpenCountsList title="Open check" :vehicle-id="kind === 'tractor' ? unitId : undefined" :trailer-id="kind === 'trailer' ? unitId : undefined" />

    <div v-if="KIT_RULES_SHOWN" class="space-y-3">
      <h3 class="text-sm font-semibold text-ink">Should carry</h3>
      <!-- ui-adoption: never-paged — what one truck should carry — one line per kind of equipment. -->
      <DataTable :columns="KIT_COLUMNS" :rows="kitLines" row-key="assetTypeId" :loading="loading">
        <template #cell-delta="{ value }">
          <span v-if="value < 0" class="font-semibold text-danger-700">{{ value }}</span>
          <span v-else-if="value > 0" class="text-ink-secondary">+{{ value }}</span>
          <span v-else class="text-ink-tertiary">—</span>
        </template>
        <template #cell-source="{ value }">
          {{ KIT_EXPECTATION_SOURCE_LABELS[value as keyof typeof KIT_EXPECTATION_SOURCE_LABELS] }}
        </template>
        <template #empty>
          <p>Nothing is expected on this unit yet. Set the kit for its kind under What each truck should carry on the Trucks & trailers page, or give this one its own list.</p>
        </template>
      </DataTable>
    </div>

    <UnitOverrideDrawer v-if="KIT_RULES_SHOWN && overriding" :open="true" :unit="unit" :roster-kind="kind" @close="overriding = false" />
  </section>
</template>
