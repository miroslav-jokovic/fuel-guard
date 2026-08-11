<script setup lang="ts">
import { computed } from "vue";
import type { EfsLocation } from "@fuelguard/shared";
import { AppButton as BaseButton } from "@fuelguard/ui";
import { AppInput as BaseInput } from "@fuelguard/ui";
import { AppCombobox as ComboSelect } from "@fuelguard/ui";
import { AppFormField as FormField } from "@fuelguard/ui";
import EfsLocationPicker from "./EfsLocationPicker.vue";

/**
 * One-time fuel exceptions — "let him fuel this once".
 *
 * The only action in this product that hands out fuel, and the copy is written accordingly: the uses
 * hint says the exception is spent automatically, so nobody grants nine expecting to revoke eight.
 *
 * Scope is a real either/or, not a checkbox: EFS's recipe (p194) sets `overrideAllLocations=true` for
 * everywhere and `locationOverride=<6-digit id>` with `overrideAllLocations=false` for one truck stop.
 * A UI that let both be true at once would be describing a document EFS does not accept.
 */

const props = defineProps<{
  overrideUses: number | null;
  overrideAllLocations: boolean | null;
  locationOverrideId: string | null;
  busy: boolean;
  uses: number;
  scopeKind: "all" | "location";
  location: EfsLocation | null;
  reason: string;
}>();

const emit = defineEmits<{
  "update:uses": [value: number];
  "update:scopeKind": [value: "all" | "location"];
  "update:location": [value: EfsLocation | null];
  "update:reason": [value: string];
  grant: [];
  clear: [];
}>();

/** Vendor range is 1–9 (p194). Above three the API demands a fresh sign-in — see the drawer. */
const useOptions = Array.from({ length: 9 }, (_, i) => ({
  value: String(i + 1),
  label: i === 0 ? "1 purchase" : `${i + 1} purchases`,
}));

const scopeOptions = [
  { value: "all", label: "Any location" },
  { value: "location", label: "One location only" },
];

const active = computed(() => (props.overrideUses ?? 0) > 0);
const reasonValid = computed(() => props.reason.trim().length >= 3);
const ready = computed(
  () => reasonValid.value && (props.scopeKind === "all" || props.location !== null),
);
</script>

<template>
  <div class="space-y-4">
    <div v-if="active" class="rounded-control bg-surface-subtle px-3 py-2 text-sm text-ink">
      This card already has {{ props.overrideUses }} exception{{ props.overrideUses === 1 ? "" : "s" }} left
      <template v-if="props.locationOverrideId">at location #{{ props.locationOverrideId }}</template>
      <template v-else-if="props.overrideAllLocations">at any location</template>.
      Granting a new one replaces it.
    </div>

    <FormField label="How many purchases" hint="The exception is used up automatically.">
      <template #default="{ id }">
        <ComboSelect
          :id="id"
          :model-value="String(props.uses)"
          :options="useOptions"
          :disabled="props.busy"
          @update:model-value="emit('update:uses', Number($event))"
        />
      </template>
    </FormField>

    <FormField label="Where it applies">
      <template #default="{ id }">
        <ComboSelect
          :id="id"
          :model-value="props.scopeKind"
          :options="scopeOptions"
          :disabled="props.busy"
          @update:model-value="emit('update:scopeKind', $event as 'all' | 'location')"
        />
      </template>
    </FormField>

    <EfsLocationPicker
      v-if="props.scopeKind === 'location'"
      :model-value="props.location"
      :disabled="props.busy"
      @update:model-value="emit('update:location', $event)"
    />

    <FormField label="Reason" required hint="Recorded in the audit log.">
      <template #default="{ id }">
        <BaseInput
          :id="id"
          type="text"
          maxlength="200"
          :model-value="props.reason"
          :disabled="props.busy"
          placeholder="Ran dry short of the planned stop"
          @update:model-value="emit('update:reason', $event)"
        />
      </template>
    </FormField>

    <div class="flex justify-end gap-3">
      <BaseButton v-if="active" variant="secondary" :disabled="props.busy || !reasonValid" @click="emit('clear')">
        Remove exception
      </BaseButton>
      <BaseButton variant="primary" :disabled="props.busy || !ready" @click="emit('grant')">
        Grant exception
      </BaseButton>
    </div>
  </div>
</template>
