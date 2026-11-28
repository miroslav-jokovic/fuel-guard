<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import { AppFormField as FormField } from "@silvicom/ui";
import { AppCombobox as ComboSelect } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import { useDriversQuery } from "@/composables/useDrivers";
import { useToastStore } from "@/stores/toast";
import { dispatchHeadline, seatNoteText, smsReasonText, useDispatchLoad, useDispatchPreview } from "./useLoadDispatch";
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
// S1.1: Send puts the load in the driver's app when they have an app login; otherwise nothing reaches
// a phone, and the dispatcher is told so before pressing Send, not after.
const inApp = computed(() => preview.data.value?.inApp === true);
// T1 N-9: from the same derivation the load page reads after Send. Uncovered in McLeod means nobody's
// app shows the load whoever it goes to; the seat note says McLeod has somebody else on it.
const uncovered = computed(() => {
  const r = preview.data.value?.reachable;
  return r !== undefined && !r.ok && r.reason === "uncovered_in_mcleod";
});
const seatNote = computed(() => seatNoteText(preview.data.value?.seatNote));

async function send(): Promise<void> {
  const load = props.load;
  if (!load || !driverId.value) return;
  try {
    const result = await dispatch.mutateAsync({ loadId: load.id, driverId: driverId.value });
    toast.success(
      `${load.ref} dispatched to ${result.driverName}`,
      result.channel === "app" ? "It is in their app now." : (smsReasonText(result.outcomeReason) ?? undefined),
    );
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
          <p v-if="uncovered" class="text-xs text-ink-muted" data-testid="dispatch-uncovered">
            McLeod has this load uncovered, so nobody sees it in the app until it is covered there. Dispatching still
            records who takes the load and when.
          </p>
          <p v-else-if="inApp" class="text-xs text-ink-muted" data-testid="dispatch-in-app">
            Send puts this load in {{ preview.data.value.driverName }}'s app and notifies them.
          </p>
          <p v-else class="text-xs text-ink-muted" data-testid="dispatch-no-app">
            {{ preview.data.value.driverName }} has no app login, so this load won't reach their phone. Dispatching still
            records who takes the load and when. Set up app access on the driver's page.
          </p>
          <p v-if="held && !inApp" class="text-xs text-ink-muted" data-testid="dispatch-held">{{ held }}</p>
          <p v-if="seatNote" class="text-xs text-ink-muted" data-testid="dispatch-seat-note">{{ seatNote }}</p>
        </template>
      </section>
    </div>

    <template #footer>
      <BaseButton :disabled="dispatch.isPending.value" @click="emit('close')">Cancel</BaseButton>
      <BaseButton
        variant="primary"
        :disabled="dispatch.isPending.value || !driverId || !preview.data.value"
        @click="send"
      >
        {{ dispatch.isPending.value ? "Dispatching…" : "Dispatch" }}
      </BaseButton>
    </template>
  </SlideOver>
</template>
