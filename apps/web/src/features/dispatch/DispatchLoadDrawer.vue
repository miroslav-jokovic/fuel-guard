<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import { AppFormField as FormField } from "@silvicom/ui";
import { AppCombobox as ComboSelect } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import { useDriversQuery } from "@/composables/useDrivers";
import { useToastStore } from "@/stores/toast";
import { dispatchHeadline, smsReasonText, useDispatchLoad, useDispatchPreview } from "./useLoadDispatch";
import type { DispatchLoad } from "./useDispatchLoads";

/**
 * Dispatch a McLeod load to a driver (LOADS-MIRROR-PLAN.md LR-D3; D-LMR5, D-LMR6).
 *
 * A drawer, not a centred dialog, because it is a form (the house rule: `SlideOver` for a form,
 * `BaseModal` only for content that needs width). Opened from the board's action column and from the
 * load page, so it owns its drawer the way `MemberPasswordResetDrawer` does, and each page only holds
 * which load is open.
 *
 * McLeod's driver is PRE-SELECTED, and choosing somebody else is allowed (D-LMR6) — the picker says
 * which one McLeod has, so a different choice is visibly a choice. The message below is the API's
 * own preview: exactly what Send stores, on the carrier's clock.
 */
const props = defineProps<{
  load: Pick<DispatchLoad, "id" | "ref" | "driver_id" | "driver_name" | "last_dispatch"> | null;
}>();
const emit = defineEmits<{ close: [] }>();

const toast = useToastStore();
const { data: drivers } = useDriversQuery();
const dispatch = useDispatchLoad();

const driverId = ref("");
const loadId = computed(() => props.load?.id ?? null);
const preview = useDispatchPreview(loadId, driverId);

// The API dispatches only to an ACTIVE driver; offering anybody else would promise a 422.
const driverOptions = computed(() =>
  (drivers.value ?? [])
    .filter((d) => d.status === "active" && !d.archived_at)
    .map((d) => ({
      value: d.id,
      label: d.id === props.load?.driver_id ? `${d.full_name} (McLeod's driver)` : d.full_name,
    })),
);
const mcleodDriverSelectable = computed(
  () => !props.load?.driver_id || driverOptions.value.some((o) => o.value === props.load?.driver_id),
);

watch(
  () => props.load?.id,
  () => {
    const mcleod = props.load?.driver_id ?? "";
    driverId.value = driverOptions.value.some((o) => o.value === mcleod) ? mcleod : "";
  },
  { immediate: true },
);
// The roster may arrive after the drawer opens; pre-select once it does, never over a choice made.
watch(driverOptions, () => {
  const mcleod = props.load?.driver_id ?? "";
  if (!driverId.value && mcleod && driverOptions.value.some((o) => o.value === mcleod)) driverId.value = mcleod;
});

const held = computed(() => smsReasonText(preview.data.value?.smsHeldBecause ?? null));

async function send(): Promise<void> {
  const load = props.load;
  if (!load || !driverId.value) return;
  try {
    const result = await dispatch.mutateAsync({ loadId: load.id, driverId: driverId.value });
    toast.success(`${load.ref} dispatched to ${result.driverName}`, smsReasonText(result.outcomeReason) ?? undefined);
    emit("close");
  } catch (e) {
    toast.error("Could not dispatch this load", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <SlideOver
    :open="load !== null"
    :title="load ? `Dispatch ${load.ref}` : 'Dispatch'"
    :description="load?.last_dispatch ? dispatchHeadline(load.last_dispatch) : undefined"
    @close="emit('close')"
  >
    <div class="space-y-4">
      <FormField v-slot="{ id }" label="Driver" required>
        <ComboSelect :id="id" v-model="driverId" :options="driverOptions" placeholder="Search drivers…" />
      </FormField>
      <p v-if="load?.driver_id && !mcleodDriverSelectable" class="text-xs text-ink-muted">
        McLeod has {{ load.driver_name ?? "a driver" }} on this load, who isn't an active driver here. Choose who takes it.
      </p>
      <p v-else-if="!load?.driver_id" class="text-xs text-ink-muted">McLeod has no driver on this load yet.</p>

      <section v-if="driverId" aria-labelledby="dispatch-preview-heading" class="space-y-2">
        <h3 id="dispatch-preview-heading" class="text-sm font-semibold text-ink">Message</h3>
        <p v-if="preview.isLoading.value" class="text-sm text-ink-muted">Preparing the message…</p>
        <p v-else-if="preview.isError.value" class="text-sm text-danger-600">
          {{ preview.error.value instanceof Error ? preview.error.value.message : "Could not prepare the message." }}
        </p>
        <template v-else-if="preview.data.value">
          <pre
            class="whitespace-pre-wrap break-words rounded-surface bg-surface-muted px-3 py-2 font-sans text-sm text-ink ring-1 ring-inset ring-edge"
            data-testid="dispatch-preview"
          >{{ preview.data.value.body }}</pre>
          <p v-if="held" class="text-xs text-ink-muted" data-testid="dispatch-held">
            {{ held }} Dispatching still records who takes the load and when.
          </p>
        </template>
      </section>
    </div>

    <template #footer>
      <div class="flex items-center justify-end gap-3">
        <BaseButton :disabled="dispatch.isPending.value" @click="emit('close')">Cancel</BaseButton>
        <BaseButton
          variant="primary"
          :disabled="dispatch.isPending.value || !driverId || !preview.data.value"
          @click="send"
        >
          {{ dispatch.isPending.value ? "Dispatching…" : "Dispatch" }}
        </BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
