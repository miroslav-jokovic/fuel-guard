<script setup lang="ts">
import { computed } from "vue";
import { AppButton as BaseButton } from "@fuelguard/ui";
import { AppCombobox as ComboSelect } from "@fuelguard/ui";
import { AppFormField as FormField } from "@fuelguard/ui";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { efsStatusEquals } from "@fuelguard/shared";
import { cardStatusLabel, cardStatusTone } from "./cardControlModel";

/**
 * Lock and unlock. The action an operator reaches for at 2am when a truck has been broken into.
 *
 * Two deliberate choices:
 *
 *  • Locking is offered as `Hold` by default and `Inactive` only as a second option. Hold is
 *    reversible; Inactive is how a card is retired. `Deleted` is not offered at all — it is EFS's
 *    hard delete (p128) and there is no undo.
 */

const props = defineProps<{
  status: string;
  lastUsedDate: string | null;
  driverName: string | null;
  unitPrompt: string | null;
  canLock: boolean;
  canUnlock: boolean;
  busy: boolean;
  lockStatus: "Hold" | "Inactive";
}>();

const emit = defineEmits<{
  "update:lockStatus": [value: "Hold" | "Inactive"];
  lock: [];
  unlock: [];
}>();

// `!==` here read every ACTIVE card as locked and offered Unlock on a working card: this account's
// EFS returns the status upper-cased. Case is the only difference tolerated — see efsStatusEquals.
const locked = computed(() => !efsStatusEquals(props.status, "Active"));

const lockOptions = [
  { value: "Hold", label: "Hold — reversible, the usual choice" },
  { value: "Inactive", label: "Inactive — retiring this card" },
];
</script>

<template>
  <section class="space-y-4">
    <h3 class="text-sm font-semibold text-ink">Lock</h3>
    <div class="flex flex-wrap items-center gap-3">
      <span :class="[BADGE_BASE, toneClass(cardStatusTone(props.status))]">{{ cardStatusLabel(props.status) }}</span>
      <span v-if="props.driverName || props.unitPrompt" class="text-sm text-ink-muted">
        {{ [props.driverName, props.unitPrompt].filter(Boolean).join(" · ") }}
      </span>
    </div>
    <p v-if="props.lastUsedDate" class="text-sm text-ink-muted">
      Last used {{ new Date(props.lastUsedDate).toLocaleString() }}.
    </p>

    <FormField
      v-if="!locked && props.canLock"
      label="What happens to the card"
      hint="Hold stops purchases and can be undone. Inactive is for a card you are retiring."
    >
      <template #default="{ id }">
        <ComboSelect
          :id="id"
          :model-value="props.lockStatus"
          :options="lockOptions"
          :disabled="props.busy"
          @update:model-value="emit('update:lockStatus', $event as 'Hold' | 'Inactive')"
        />
      </template>
    </FormField>

    <div class="flex justify-end gap-3">
      <BaseButton
        v-if="locked && props.canUnlock"
        variant="primary"
        :disabled="props.busy"
        @click="emit('unlock')"
      >
        Unlock card
      </BaseButton>
      <BaseButton
        v-if="!locked && props.canLock"
        variant="danger"
        :disabled="props.busy"
        @click="emit('lock')"
      >
        {{ props.lockStatus === "Inactive" ? "Deactivate card" : "Lock card" }}
      </BaseButton>
    </div>
  </section>
</template>
