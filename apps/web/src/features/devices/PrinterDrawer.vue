<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import {
  AppButton as BaseButton,
  AppCombobox as ComboSelect,
  AppFormField as FormField,
  AppInput as BaseInput,
} from "@silvicom/ui";
import { MAX_PRINTER_OFFSET_DOTS, type PrinterDto, type PrintStationDto } from "@silvicom/shared";
import SlideOver from "@/components/SlideOver.vue";
import { useToastStore } from "@/stores/toast";
import { useCreatePrinter, useUpdatePrinter } from "@/composables/usePrinting";

/**
 * Add a printer to a station, or change one (PRINTERS-AND-SCANNERS-PLAN.md PS4).
 *
 * The printer's system name is PICKED from what the station reported its operating system has, not
 * typed: a typo there is a job the station cannot print, found only when somebody's label does not
 * come out. A station that has not reported yet offers a text field with that warning.
 *
 * The nudge is in printer dots (203 to the inch, so 8 dots ≈ 1 mm): the MUNBYN is measured to land
 * about 3 mm right, which is the one adjustment this drawer exists to make after the first test label.
 */

const props = defineProps<{ open: boolean; printer: PrinterDto | null; stations: PrintStationDto[] }>();
const emit = defineEmits<{ close: [] }>();

const toast = useToastStore();
const create = useCreatePrinter();
const update = useUpdatePrinter();

const STOCKS = [{ value: "roll-single", label: "2\" × 2\" roll (direct thermal)" }];

const form = reactive({ name: "", stationId: "", systemName: "", stockId: "roll-single", offsetXDots: 0, offsetYDots: 0 });
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    const p = props.printer;
    const paired = props.stations.filter((s) => s.paired && !s.revoked);
    Object.assign(form, {
      name: p?.name ?? "Label printer",
      stationId: p?.stationId ?? paired[0]?.id ?? "",
      systemName: p?.systemName ?? "",
      stockId: p?.stockId ?? "roll-single",
      offsetXDots: p?.offsetXDots ?? 0,
      offsetYDots: p?.offsetYDots ?? 0,
    });
  },
);

const stationOptions = computed(() =>
  props.stations.filter((s) => s.paired && !s.revoked).map((s) => ({ value: s.id, label: s.name })),
);
const discovered = computed(() => props.stations.find((s) => s.id === form.stationId)?.discoveredPrinters ?? []);
// Pre-pick the label printer when the station reports one by a recognisable name.
watch(discovered, (list) => {
  if (form.systemName || list.length === 0) return;
  form.systemName = (list.find((p) => /munbyn|label|rw403/i.test(p.name)) ?? list[0]!).name;
});

const offsetOk = (n: number) => Number.isInteger(n) && Math.abs(n) <= MAX_PRINTER_OFFSET_DOTS;
const ready = computed(
  () => form.name.trim() && form.stationId && form.systemName.trim() && offsetOk(form.offsetXDots) && offsetOk(form.offsetYDots),
);
const saving = computed(() => create.isPending.value || update.isPending.value);

async function save() {
  if (!ready.value || saving.value) return;
  try {
    if (props.printer) {
      await update.mutateAsync({
        id: props.printer.id,
        patch: {
          name: form.name.trim(),
          systemName: form.systemName.trim(),
          stockId: form.stockId,
          offsetXDots: form.offsetXDots,
          offsetYDots: form.offsetYDots,
        },
      });
      toast.success("Printer saved");
    } else {
      await create.mutateAsync({
        name: form.name.trim(),
        stationId: form.stationId,
        systemName: form.systemName.trim(),
        language: "tspl",
        stockId: form.stockId,
        dpi: 203,
        offsetXDots: form.offsetXDots,
        offsetYDots: form.offsetYDots,
      });
      toast.success("Printer added");
    }
    emit("close");
  } catch (e) {
    toast.error(props.printer ? "Could not save the printer" : "Could not add the printer", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <SlideOver :open="open" size="lg" :title="printer ? `Edit ${printer.name}` : 'Add printer'" @close="emit('close')">
    <form id="printer-form" class="space-y-4" @submit.prevent="save">
      <FormField v-slot="{ id }" label="Name" hint="What people see when they choose a printer.">
        <BaseInput :id="id" v-model="form.name" maxlength="80" />
      </FormField>
      <FormField v-if="!printer" v-slot="{ id }" label="Print station" hint="The computer the printer is plugged into.">
        <ComboSelect :id="id" v-model="form.stationId" :options="stationOptions" />
      </FormField>
      <FormField
        v-slot="{ id }"
        label="Printer on that computer"
        :hint="discovered.length ? 'As the computer names it.' : 'The station has not reported its printers yet — type the name exactly as the computer shows it.'"
      >
        <ComboSelect v-if="discovered.length" :id="id" v-model="form.systemName" :options="discovered.map((p) => ({ value: p.name, label: p.name }))" />
        <BaseInput v-else :id="id" v-model="form.systemName" maxlength="200" />
      </FormField>
      <FormField v-slot="{ id }" label="Label stock">
        <ComboSelect :id="id" v-model="form.stockId" :options="STOCKS" />
      </FormField>
      <div class="grid grid-cols-2 gap-4">
        <FormField v-slot="{ id }" label="Move right (dots)" hint="8 dots ≈ 1 mm. Negative moves left.">
          <BaseInput :id="id" v-model.number="form.offsetXDots" type="number" :min="-MAX_PRINTER_OFFSET_DOTS" :max="MAX_PRINTER_OFFSET_DOTS" />
        </FormField>
        <FormField v-slot="{ id }" label="Move down (dots)" hint="Negative moves up.">
          <BaseInput :id="id" v-model.number="form.offsetYDots" type="number" :min="-MAX_PRINTER_OFFSET_DOTS" :max="MAX_PRINTER_OFFSET_DOTS" />
        </FormField>
      </div>
    </form>
    <template #footer>
      <div class="flex items-center justify-end gap-3">
        <BaseButton variant="ghost" :disabled="saving" @click="emit('close')">Cancel</BaseButton>
        <BaseButton form="printer-form" type="submit" variant="primary" :disabled="saving || !ready">
          {{ saving ? "Saving…" : printer ? "Save" : "Add printer" }}
        </BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
