<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import { AppButton as BaseButton, AppCallout, AppCombobox as ComboSelect, AppFormField as FormField, AppInput as BaseInput } from "@silvicom/ui";
import { stationReadsScanners, type PrintStationDto, type ScannerDto, type SerialPort } from "@silvicom/shared";
import SlideOver from "@/components/SlideOver.vue";
import { useToastStore } from "@/stores/toast";
import { useCreateScanner, useStationPortsQuery, useUpdateScanner } from "@/composables/useScanners";

/**
 * Add a scanner on a print station, or change one (SCANNER-RELAY-PLAN.md SR4, D-SR2).
 *
 * The port is PICKED from what the station reported, never typed — the printer drawer's reason. A
 * scanner still in keyboard mode is not a serial port, so it is not on the list; the drawer says so,
 * because "my scanner is not in the list" is the first thing that happens to everybody. Its USB ids
 * are not chosen here at all: the API takes them from the station's report.
 */
const props = defineProps<{ open: boolean; scanner: ScannerDto | null; stations: PrintStationDto[] }>();
const emit = defineEmits<{ close: [] }>();
const toast = useToastStore();
const create = useCreateScanner();
const update = useUpdateScanner();
const reports = useStationPortsQuery();

const form = reactive({ name: "", stationId: "", portName: "" });

const live = computed(() => props.stations.filter((s) => s.paired && !s.revoked));
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    const s = props.scanner;
    Object.assign(form, { name: s?.name ?? "Office scanner", stationId: s?.stationId ?? live.value[0]?.id ?? "", portName: s?.portName ?? "" });
  },
);

const station = computed(() => props.stations.find((s) => s.id === form.stationId) ?? null);
const tooOld = computed(() => station.value !== null && !stationReadsScanners(station.value.agentVersion));
const ports = computed<SerialPort[]>(() => reports.data.value?.find((r) => r.stationId === form.stationId)?.ports ?? []);
const portOptions = computed(() =>
  ports.value.map((p) => ({ value: p.name, label: [p.name, p.label].filter(Boolean).join(" — ") })),
);

const ready = computed(() => form.name.trim() && form.stationId && form.portName);
const saving = computed(() => create.isPending.value || update.isPending.value);

async function save() {
  if (!ready.value || saving.value) return;
  try {
    if (props.scanner) {
      await update.mutateAsync({ id: props.scanner.id, patch: { name: form.name.trim(), portName: form.portName } });
      toast.success("Scanner saved");
    } else {
      await create.mutateAsync({ name: form.name.trim(), stationId: form.stationId, portName: form.portName });
      toast.success("Scanner added", "The station starts reading it within a minute.");
    }
    emit("close");
  } catch (e) {
    toast.error(props.scanner ? "Could not save the scanner" : "Could not add the scanner", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <SlideOver :open="open" size="lg" :title="scanner ? `Edit ${scanner.name}` : 'Add scanner'" @close="emit('close')">
    <form id="scanner-form" class="space-y-4" @submit.prevent="save">
      <FormField v-slot="{ id }" label="Name" hint='What people press: "Use Office scanner".'>
        <BaseInput :id="id" v-model="form.name" maxlength="80" />
      </FormField>
      <FormField v-if="!scanner" v-slot="{ id }" label="Print station" hint="The computer the scanner (or its USB receiver) is plugged into.">
        <ComboSelect :id="id" v-model="form.stationId" :options="live.map((s) => ({ value: s.id, label: s.name }))" />
      </FormField>
      <AppCallout v-if="tooOld" tone="caution">
        The program on {{ station?.name }} is version {{ station?.agentVersion ?? "unknown" }}, older than scanner support.
        Install the new version from tools/print-station on that computer first; it will then list its ports here.
      </AppCallout>
      <FormField v-slot="{ id }" label="Port" hint="As the station's computer names it.">
        <ComboSelect v-if="portOptions.length" :id="id" v-model="form.portName" :options="portOptions" />
        <p v-else :id="id" class="text-sm text-ink-tertiary">No serial ports reported yet.</p>
      </FormField>
      <AppCallout tone="info">
        Not in the list? A scanner straight out of the box acts as a keyboard, not a port. Scan the
        <span class="font-medium">USB-COM</span> (virtual serial port) setup barcode in its manual, wait a minute for the
        station to report it, and it appears here. The manual's <span class="font-medium">USB HID Keyboard</span> barcode
        undoes it.
      </AppCallout>
    </form>
    <template #footer>
      <div class="flex items-center justify-end gap-3">
        <BaseButton variant="ghost" :disabled="saving" @click="emit('close')">Cancel</BaseButton>
        <BaseButton form="scanner-form" type="submit" variant="primary" :disabled="saving || !ready">
          {{ saving ? "Saving…" : scanner ? "Save" : "Add scanner" }}
        </BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
