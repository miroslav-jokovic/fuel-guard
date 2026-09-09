<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import {
  AppButton as BaseButton,
  AppCheckbox as BaseCheckbox,
  AppCombobox,
  AppFormField as FormField,
} from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import { useLocationsQuery, useOpenCountSession } from "./useInventory";
import { useToastStore } from "@/stores/toast";

/**
 * Start a shelf walk (INVENTORY-PLAN.md I5 PR 2b).
 *
 * ── STARTED AT THE DESK, WALKED ON THE PHONE ──────────────────────────────────────────────────
 * A session is opened with the network up — the screen cannot show what to count without it — and
 * the server mints the id, unlike a movement (D-INV27). Two taps of Start must not make two walks
 * of one bay, which is the whole reason the id is not the client's here.
 *
 * ── BLIND IS THE DEFAULT AND IT IS A CHOICE, NOT A SETTING ────────────────────────────────────
 * D-INV20. The checkbox is checked and the mode is written onto the session, because "was the
 * expected figure on screen when this was typed" is the first question anybody asks about a
 * variance they do not believe. Unchecking it is allowed and recorded; there is no org-wide switch,
 * so nobody can make every count non-blind once and forget.
 *
 * ⚠ Only ACTIVE locations are offered. `record_part_movement` refuses a movement into a closed one
 * (`IV012`), and 0332's trigger refuses a session on one — so a closed bay in this list would be a
 * walk in which every entry is rejected.
 */
defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const router = useRouter();
const toast = useToastStore();
const { data: locations } = useLocationsQuery();
const openSession = useOpenCountSession();

const locationId = ref("");
const blind = ref(true);
const error = ref("");

const options = computed(() =>
  (locations.value ?? []).map((l) => ({ value: l.id, label: `${l.name} (${l.code})` })),
);

async function start() {
  if (!locationId.value) {
    error.value = "Choose a location to count.";
    return;
  }
  error.value = "";
  try {
    const session = await openSession.mutateAsync({ kind: "location", locationId: locationId.value, blind: blind.value });
    emit("close");
    void router.push({ name: "count-session", params: { sessionId: session.id } });
  } catch (e) {
    toast.error("Could not start the count", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <SlideOver
    :open="open"
    title="Count a shelf"
    description="Walk one location and say what is actually there. The count is saved on the phone as you go."
    @close="emit('close')"
  >
    <form class="space-y-4" @submit.prevent="start">
      <FormField v-slot="{ id }" label="Which location" :error="error">
        <AppCombobox
          :id="id"
          v-model="locationId"
          :options="options"
          placeholder="Choose a location"
          empty-text="No stock locations yet — add one from the gear on Parts."
        />
      </FormField>

      <div class="rounded-control bg-surface-subtle px-3 py-2.5 ring-1 ring-edge">
        <BaseCheckbox v-model="blind">
          <span class="text-sm">
            <span class="font-medium text-ink">Blind count</span>
            <span class="block text-xs text-ink-muted">
              Hide what the system expects until each number is typed. Recorded either way.
            </span>
          </span>
        </BaseCheckbox>
      </div>

      <div class="flex justify-end gap-2 pt-2">
        <BaseButton type="button" @click="emit('close')">Cancel</BaseButton>
        <BaseButton type="submit" variant="primary" :disabled="openSession.isPending.value">Start counting</BaseButton>
      </div>
    </form>
  </SlideOver>
</template>
