<script setup lang="ts">
import { computed } from "vue";
import { EFS_LIMIT_MAX, type EfsLimitOption, type OverrideLimit } from "@fuelguard/shared";
import { AppCombobox as ComboSelect } from "@fuelguard/ui";
import { AppFormField as FormField } from "@fuelguard/ui";
import { AppInput as BaseInput } from "@fuelguard/ui";
import { AppCheckbox } from "@fuelguard/ui";
import { AppButton as BaseButton } from "@fuelguard/ui";
import {
  DIESEL_PAIR,
  OVERRIDE_LIMIT_AMOUNT_HELP,
  OVERRIDE_LIMIT_AMOUNT_LABEL,
  PRODUCT_OVERRIDE_HELP,
  canAddOverrideLimit,
  dieselPartnerAdvice,
  emptyOverrideLimit,
  missingDieselPartner,
} from "./overrideLimits";

/**
 * Step 10.3's product-limit picker — the `Product/Limit Override` half of the portal's `Optional`
 * fieldset, split out of `CardOperationInputs.vue` when the diesel advice pushed that file past the
 * 500-line budget. A real seam, not a carve-up: everything here reads and writes ONE draft field
 * (`limits`), so the whole control is a `limits` in / `update:limits` out component, the same shape
 * `EfsLocationPicker` has for `location`.
 *
 * The checkbox gates the rows for the portal's own reason: a product override DELETES the card's
 * other product limits for the duration (p194), which is not something to walk into by finding a
 * form already open. Ticking it opens one empty line, the way `Product/Limit Override` →
 * `Override Card` lands you on `Create Limit`.
 */

const props = defineProps<{
  limits: readonly OverrideLimit[];
  busy: boolean;
  /**
   * The products THIS account can cap — `allowedLimitsFrom(capabilities)`, never `EFS_LIMIT_LABELS`
   * (see `CardOperationInputs.vue`'s prop of the same name, which threads through to here).
   */
  limitOptions?: readonly EfsLimitOption[];
}>();

const emit = defineEmits<{ "update:limits": [value: OverrideLimit[]] }>();

/** The account's products as select options, with the id kept visible — it is what EFS declines on. */
const productOptions = computed(() =>
  // `DSL - DIESEL`, which is exactly how the portal's own Limit ID list reads. The CODE leads because
  // the code is what EFS declines on and what a truck stop rings up; the description is the gloss.
  (props.limitOptions ?? []).map((option) => ({ value: option.limitId, label: `${option.limitId} - ${option.label}` })));

/** Replace one line. The array is rebuilt rather than mutated — the drawer diffs the draft object. */
const patchLimit = (index: number, over: Partial<OverrideLimit>): void =>
  emit("update:limits", props.limits.map((limit, i) => (i === index ? { ...limit, ...over } : limit)));

const addLimit = (): void => emit("update:limits", [...props.limits, emptyOverrideLimit()]);
const removeLimit = (index: number): void =>
  emit("update:limits", props.limits.filter((_, i) => i !== index));

/** The unit spelled out beside the amount, from the ACCOUNT's answer for that product. */
const unitHint = (limitId: string): string => {
  const option = (props.limitOptions ?? []).find((o) => o.limitId === limitId);
  if (!option) return "";
  return option.unit === "gallons" ? "gallons" : option.unit === "dollars" ? "dollars" : "units";
};

/**
 * RULE 2's diesel advice — ADVICE, not a blocker, since 2026-08-18 (Miki's ruling, and the portal's
 * own flow: one product required, `Save and Add Another` for the rest). The sentence names the risk;
 * the button is the portal-guide's own instruction made one click.
 */
const dieselPartner = computed(() => missingDieselPartner(props.limits, props.limitOptions ?? []));
const dieselAdvice = computed(() => dieselPartnerAdvice(props.limits, props.limitOptions ?? []));

/** Same amount as the diesel line already chosen — "for the desired gallons", per the guide's note. */
const addDieselPartner = (): void => {
  const partner = dieselPartner.value;
  if (!partner || !canAddOverrideLimit(props.limits)) return;
  const sibling = props.limits.find((l) => (DIESEL_PAIR as readonly string[]).includes(l.limitId));
  emit("update:limits", [...props.limits, { ...emptyOverrideLimit(), limitId: partner, limit: sibling?.limit ?? 0 }]);
};
</script>

<template>
  <AppCheckbox
    :model-value="props.limits.length > 0"
    label="Product/limit override"
    :disabled="props.busy"
    @update:model-value="(on: boolean) => emit('update:limits', on ? [emptyOverrideLimit()] : [])"
  />
  <p class="text-sm text-ink-muted">{{ PRODUCT_OVERRIDE_HELP }}</p>

  <div
    v-for="(limit, index) in props.limits"
    :key="index"
    class="space-y-4 rounded-control bg-surface-subtle px-3 py-3"
  >
    <FormField label="Product">
      <template #default="{ id }">
        <ComboSelect
          :id="id"
          :model-value="limit.limitId"
          :options="productOptions"
          :disabled="props.busy"
          @update:model-value="patchLimit(index, { limitId: String($event) })"
        />
      </template>
    </FormField>

    <FormField :label="OVERRIDE_LIMIT_AMOUNT_LABEL" :hint="OVERRIDE_LIMIT_AMOUNT_HELP">
      <template #default="{ id }">
        <div class="flex items-center gap-2">
          <BaseInput
            :id="id"
            type="number"
            min="0"
            :max="EFS_LIMIT_MAX"
            :model-value="String(limit.limit)"
            :disabled="props.busy"
            @update:model-value="patchLimit(index, { limit: Number($event) })"
          />
          <span v-if="unitHint(limit.limitId)" class="whitespace-nowrap text-sm text-ink-muted">
            {{ unitHint(limit.limitId) }}
          </span>
        </div>
      </template>
    </FormField>

    <BaseButton variant="ghost" size="sm" :disabled="props.busy" @click="removeLimit(index)">
      Remove {{ limit.limitId || "this product" }}
    </BaseButton>
  </div>

  <!--
    The Overrides guide's diesel NOTE, surfaced where it helps and never enforced: the portal
    requires ONE product and offers `Save and Add Another` for the rest, so this advises and
    the button obeys — the operator chooses, the confirmation names what they chose.
  -->
  <div v-if="dieselAdvice" class="space-y-2 rounded-control bg-caution-50 px-3 py-2">
    <p class="text-sm text-caution-700">{{ dieselAdvice }}</p>
    <BaseButton
      v-if="canAddOverrideLimit(props.limits)"
      variant="soft"
      size="sm"
      :disabled="props.busy"
      @click="addDieselPartner()"
    >
      Add {{ dieselPartner }} at the same amount
    </BaseButton>
  </div>

  <BaseButton
    v-if="props.limits.length > 0 && canAddOverrideLimit(props.limits)"
    variant="soft"
    size="sm"
    :disabled="props.busy"
    @click="addLimit()"
  >
    Save and add another product
  </BaseButton>
</template>
