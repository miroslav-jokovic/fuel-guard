<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { AppIcon } from "@silvicom/ui";
import { ClipboardDocumentCheckIcon } from "@silvicom/ui/icons";
import { AppCard as BaseCard, AppCallout } from "@silvicom/ui";
import { AppButton as BaseButton } from "@silvicom/ui";
import { AppInput as BaseInput } from "@silvicom/ui";
import { AppFormField as FormField } from "@silvicom/ui";
import { AppCombobox as ComboSelect } from "@silvicom/ui";
import VerdictPanel from "@/features/hazmat/VerdictPanel.vue";
import HazmatProductLines from "@/features/hazmat/HazmatProductLines.vue";
import { useHazmatTrailersQuery } from "@/features/hazmat/useHazmatEquipment";
import {
  buildCalcRequest,
  calcFormReady,
  emptyForm,
  emptyLine,
  equipmentFromTrailerType,
  equipmentSpec,
  useHazmatCalc,
  EQUIPMENT_OPTIONS,
  OTHER_FREIGHT_OPTIONS,
  TANK_STATE_OPTIONS,
  VESSEL_LEG_OPTIONS,
  type CalcForm,
  type CalcResult,
} from "@/features/hazmat/useHazmatCalc";

/**
 * `fleet` is off by default because this exact component IS the public marketing calculator
 * (`PublicPlacardCalculatorPage.vue`). An anonymous visitor has no organization, so the equipment
 * picker and the fleet query behind it must never mount there.
 *
 * LAYOUT (reworked again 2026-08, H-MX/UX pass):
 *  · EQUIPMENT is ONE question with two paths — "From my fleet" (trailer picker; the equipment is
 *    READ from the trailer and shown as a confirmation, not asked again) or "Other equipment"
 *    (the equipment picker alone). The old layout showed both controls side by side and read as two
 *    questions; users answered twice.
 *  · Each product line asks: what is it → how is it packed (type, count, optional per-package
 *    weight/volume) → what does it gross. The NET-quantity field is gone from this form — the placard
 *    ladder never reads it (every threshold runs on gross pounds), and it double-asked what the
 *    packaging block already established. When count × per-package weight are known, the gross is
 *    offered as a one-click suggestion, never silently applied.
 *  · CFR citations are stripped from all form copy (labels, hints, derived notes) — they live in the
 *    RESULTS panel, where they annotate an answer instead of intimidating a question. Plain-language
 *    grouping replaced the uppercase sub-headers.
 *  · "Offeror declarations" became "What the BOL declares" — same three verified claims, said in the
 *    words a dispatcher reads on the paper.
 *  · NEW (H-MX): "Any non-hazmat freight on this load?" — a tri-state that resolves the
 *    §172.301(a)(3) no-other-material condition instead of leaving it a standing assumption. It never
 *    touches the placard aggregate (hazmat-only by CFR).
 */
const props = withDefaults(defineProps<{ basePath?: string; fleet?: boolean }>(), {
  basePath: "/api/hazmat",
  fleet: false,
});

const form = reactive<CalcForm>(emptyForm());
const calc = useHazmatCalc(props.basePath);
const result = ref<CalcResult | null>(null);

const canCalculate = computed(() => calcFormReady(form));

// ── fleet equipment (authenticated calculator only) ─────────────────────────────────────────────
const fleetEnabled = computed(() => props.fleet);
// The hazmat feature reads trailers itself rather than importing the fleet feature's internals
// (the boundary rule — see this query's own header).
const { data: trailers } = useHazmatTrailersQuery({ enabled: fleetEnabled });
const selectedTrailerId = ref("");

/** One question, two paths: state the trailer (fleet) or state the equipment (manual/public). */
const sourceMode = ref<"fleet" | "manual">(props.fleet ? "fleet" : "manual");
/** True while the user is deliberately overriding a trailer-derived equipment answer. */
const equipmentOverride = ref(false);

const trailerOptions = computed(() =>
  (trailers.value ?? []).map((t) => ({
    value: t.id,
    label: t.trailer_type ? `${t.unit_number} — ${t.trailer_type.replace("_", " ")}` : t.unit_number,
  })),
);

const equipmentOptions = EQUIPMENT_OPTIONS.map((o) => ({ value: o.value, label: o.label }));

function setSourceMode(mode: "fleet" | "manual") {
  if (sourceMode.value === mode) return;
  sourceMode.value = mode;
  equipmentOverride.value = false;
  if (mode === "manual") selectedTrailerId.value = "";
}

/**
 * Picking a trailer states the equipment instead of asking the user to restate it. The trailer's
 * type is the same source of truth the load path uses (`resolveVehicleKind`, D-H4), and the tank
 * capacity lives on the trailer row itself (H-C2), so the calculator and a real analysis of the
 * same equipment cannot disagree.
 */
function applyTrailer(id: string) {
  selectedTrailerId.value = id;
  equipmentOverride.value = false;
  if (!id) return;
  const trailer = (trailers.value ?? []).find((t) => t.id === id);
  if (!trailer) return;
  applyEquipment(equipmentFromTrailerType(trailer.trailer_type));
  form.cargoTankCapacityGal = trailer.cargo_capacity_gal != null ? String(trailer.cargo_capacity_gal) : "";
}

/** Setting the equipment reshapes untouched lines to its defaults (bulk gallons on a tanker, …). */
function applyEquipment(value: string) {
  form.equipmentType = value;
  for (const line of form.lines) {
    if (line.product == null) Object.assign(line, emptyLine(value));
  }
}

const selectedTrailer = computed(() =>
  selectedTrailerId.value ? ((trailers.value ?? []).find((t) => t.id === selectedTrailerId.value) ?? null) : null,
);

/** The trailer answered the question — show the answer, don't re-ask it. */
const equipmentConfirmation = computed(() => {
  if (sourceMode.value !== "fleet" || !selectedTrailer.value || equipmentOverride.value) return null;
  if (form.equipmentType === "") return null; // trailer type unset → the picker asks instead
  const spec = equipmentSpec(form.equipmentType);
  return `${selectedTrailer.value.unit_number} is a ${spec?.label.toLowerCase() ?? form.equipmentType}${
    form.cargoTankCapacityGal ? ` · ${form.cargoTankCapacityGal} gal` : ""
  }`;
});

/** When the equipment must still be asked: manual mode, or a fleet trailer with no type on file. */
const showEquipmentPicker = computed(() => {
  if (sourceMode.value === "manual") return true;
  if (!selectedTrailer.value) return false;
  return form.equipmentType === "" || equipmentOverride.value;
});

const trailerTypeMissing = computed(
  () => sourceMode.value === "fleet" && selectedTrailer.value != null && form.equipmentType === "" && !equipmentOverride.value,
);

const isTank = computed(() => equipmentSpec(form.equipmentType)?.vehicleKind === "cargo_tank");
async function calculate() {
  result.value = await calc.mutateAsync(buildCalcRequest(form));
}
function resetAll() {
  selectedTrailerId.value = "";
  equipmentOverride.value = false;
  sourceMode.value = props.fleet ? "fleet" : "manual";
  Object.assign(form, emptyForm());
  result.value = null;
  calc.reset();
}
</script>

<template>
  <div class="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] xl:grid-cols-2">
    <form class="min-w-0 space-y-4" @submit.prevent="calculate">
      <!-- ── 1 · equipment: one question, two paths ─────────────────────────────────────────── -->
      <BaseCard as="section">
        <div>
          <h2 class="text-sm font-semibold text-ink">Equipment</h2>
          <p class="mt-0.5 text-sm text-ink-muted">What the load rides on — this decides which rules apply.</p>
        </div>

        <!-- fleet users choose the path; the public calculator goes straight to the picker -->
        <div v-if="fleet" class="mt-4 inline-flex rounded-control bg-surface-subtle p-1 ring-1 ring-inset ring-edge" role="group" aria-label="Where the equipment comes from">
          <BaseButton
            variant="ghost"
            size="sm"
            class="rounded-control px-3 py-1.5 text-sm font-medium transition-colors"
            :class="sourceMode === 'fleet' ? 'bg-surface text-ink shadow-card ring-1 ring-inset ring-edge-subtle' : 'text-ink-muted hover:text-ink'"
            @click="setSourceMode('fleet')"
          >
            From my fleet
          </BaseButton>
          <BaseButton
            variant="ghost"
            size="sm"
            class="rounded-control px-3 py-1.5 text-sm font-medium transition-colors"
            :class="sourceMode === 'manual' ? 'bg-surface text-ink shadow-card ring-1 ring-inset ring-edge-subtle' : 'text-ink-muted hover:text-ink'"
            @click="setSourceMode('manual')"
          >
            Other equipment
          </BaseButton>
        </div>

        <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <!-- Fleet path: the trailer states the answer. Never mounted on the public page. -->
          <FormField
            v-if="fleet && sourceMode === 'fleet'"
            v-slot="{ id }"
            label="Trailer"
            hint="The equipment and tank capacity are read from the trailer."
          >
            <ComboSelect
              :id="id"
              :model-value="selectedTrailerId"
              :options="trailerOptions"
              placeholder="Search trailers…"
              @update:model-value="applyTrailer"
            />
          </FormField>

          <FormField
            v-if="showEquipmentPicker"
            v-slot="{ id }"
            label="Equipment"
            required
            :hint="
              form.equipmentType === ''
                ? 'Bulk tank or packaged freight changes the whole answer — there is no safe default.'
                : undefined
            "
          >
            <ComboSelect
              :id="id"
              :model-value="form.equipmentType"
              :options="equipmentOptions"
              placeholder="Select…"
              @update:model-value="applyEquipment"
            />
          </FormField>

          <!-- Tank-only fields stay together so the card does not reflow around them. -->
          <template v-if="isTank">
            <FormField
              v-slot="{ id }"
              label="Cargo tank capacity"
              hint="Optional — used when capacity affects the cargo-tank requirements."
            >
              <div class="flex items-stretch gap-2">
                <BaseInput :id="id" v-model="form.cargoTankCapacityGal" class="min-w-0 flex-1" type="number" inputmode="decimal" min="0" placeholder="9200" />
                <span class="flex shrink-0 items-center rounded-control bg-surface-subtle px-3 text-sm text-ink-muted ring-1 ring-inset ring-edge">gal</span>
              </div>
            </FormField>
            <FormField v-slot="{ id }" label="Tank state">
              <ComboSelect :id="id" v-model="form.tankState" :options="TANK_STATE_OPTIONS" />
            </FormField>
          </template>
        </div>

        <!-- the trailer answered — confirm it instead of asking again -->
        <p
          v-if="equipmentConfirmation"
          class="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-control bg-surface-subtle px-3 py-2 text-xs text-ink-secondary ring-1 ring-inset ring-edge"
        >
          <span>Read from the fleet: <strong class="font-semibold text-ink">{{ equipmentConfirmation }}</strong></span>
          <BaseButton
            variant="ghost"
            size="sm"
            class="!h-auto !px-0 !text-xs !font-medium !text-brand-700 hover:!bg-transparent hover:!underline"
            @click="equipmentOverride = true"
          >Change</BaseButton>
        </p>
        <AppCallout v-else-if="trailerTypeMissing" tone="warning" class="mt-3">
          This trailer's type is not set — pick the equipment above, and set the type on the Trailers page so next time it is read rather than asked.
        </AppCallout>
      </BaseCard>

      <HazmatProductLines
        :lines="form.lines"
        :equipment-type="form.equipmentType"
        :is-tank="isTank"
        :base-path="props.basePath"
        @add-line="form.lines.push(emptyLine(form.equipmentType))"
        @remove-line="form.lines.splice($event, 1)"
        @select-product="(index, product) => (form.lines[index]!.product = product)"
        @clear-product="(index) => (form.lines[index]!.product = null)"
      />

      <!-- ── the rest of the load (H-MX) ─────────────────────────────────────────────────────── -->
      <BaseCard as="section">
        <div>
          <h2 class="text-sm font-semibold text-ink">Rest of the load</h2>
          <p class="mt-0.5 text-sm text-ink-muted">Whether anything besides these products rides on the truck.</p>
        </div>
        <div class="mt-4">
          <FormField
            v-slot="{ id }"
            label="Any non-hazmat freight on this load?"
            hint="Never changes which placards you need — but on a large single-product package load it decides whether the UN number must also be displayed on the vehicle."
          >
            <ComboSelect :id="id" v-model="form.otherFreight" :options="OTHER_FREIGHT_OPTIONS" />
          </FormField>
        </div>
      </BaseCard>

      <!-- ── trip context ───────────────────────────────────────────────────────────────────── -->
      <BaseCard as="section">
        <div>
          <h2 class="text-sm font-semibold text-ink">Trip context</h2>
          <p class="mt-0.5 text-sm text-ink-muted">Optional — facts about the run rather than the freight.</p>
        </div>
        <div class="mt-4 space-y-4">
          <FormField
            v-slot="{ id }"
            label="Does any part of this move go by vessel?"
            hint="A marine pollutant is treated completely differently on a highway-only move than on one with a vessel leg — this is the question that decides it."
          >
            <ComboSelect :id="id" v-model="form.vesselLeg" :options="VESSEL_LEG_OPTIONS" />
          </FormField>
          <FormField
            v-slot="{ id }"
            label="ID numbers still displayed from an earlier load today"
            hint="If placards or number panels from the previous or current business day are still on the truck, list those IDs. Comma-separated; leave blank if none."
          >
            <BaseInput :id="id" v-model="form.businessDayIds" placeholder="UN1830, UN1789" />
          </FormField>
        </div>
      </BaseCard>

      <div class="flex flex-wrap items-center gap-3">
        <BaseButton type="submit" variant="primary" :disabled="!canCalculate || calc.isPending.value">
          <AppIcon :icon="ClipboardDocumentCheckIcon" class="size-4" aria-hidden="true" />
          {{ calc.isPending.value ? "Calculating…" : "Calculate placards" }}
        </BaseButton>
        <BaseButton variant="secondary" type="button" @click="resetAll">Reset</BaseButton>
      </div>
      <p v-if="!canCalculate" class="text-xs text-ink-muted">Choose the equipment and add at least one regulated product to calculate.</p>

      <AppCallout v-if="calc.isError.value" tone="danger">
        {{ calc.error.value instanceof Error ? calc.error.value.message : "Calculation failed." }}
      </AppCallout>
    </form>

    <div class="min-w-0 lg:sticky lg:top-20 lg:self-start">
      <VerdictPanel v-if="result" :result="result" />
      <!-- The empty state states what the next action produces; it does not fill the column to do it. -->
      <BaseCard v-else>
        <div class="flex items-start gap-3">
          <span class="flex size-9 shrink-0 items-center justify-center rounded-surface bg-brand-50 text-brand-700">
            <AppIcon :icon="ClipboardDocumentCheckIcon" class="size-5" aria-hidden="true" />
          </span>
          <div>
            <p class="text-sm font-medium text-ink">Nothing calculated yet</p>
            <p class="mt-1 text-sm text-ink-muted">
              State the equipment and add at least one regulated product, then calculate. You get the
              required placards, the ID displays, the weight arithmetic behind them, and a CFR citation
              for every line of it.
            </p>
          </div>
        </div>
      </BaseCard>
    </div>
  </div>
</template>
