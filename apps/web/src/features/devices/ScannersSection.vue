<script setup lang="ts">
import { computed, ref } from "vue";
import { AppBadge, AppButton as BaseButton, DataTable, type DataTableColumn, useConfirm } from "@silvicom/ui";
import type { PrintStationDto, ScannerDto } from "@silvicom/shared";
import KebabMenu from "@/components/KebabMenu.vue";
import ScannerDrawer from "@/features/devices/ScannerDrawer.vue";
import { SCANNER_STATUS_TEXT, useScannersQuery, useUpdateScanner } from "@/composables/useScanners";
import { useScannerRelayStore } from "@/stores/scannerRelay";
import { useToastStore } from "@/stores/toast";
import { formatDateTime } from "@/lib/format";

/**
 * Settings → Printers & scanners → the scanners plugged into a print station (SCANNER-RELAY-PLAN.md
 * SR4). Each row answers the three questions the 10/30 test raised: is the station reading it
 * (status, in the shop's words), who is using it right now, and did the last scan reach anybody.
 *
 * "Use on this device" is here as well as on the Scan page, because this is where a scanner is set
 * up and tested — the scanner test below then reads it like any scanner.
 */
const props = defineProps<{ stations: PrintStationDto[]; manage: boolean }>();
const emit = defineEmits<{ drawer: [open: boolean] }>();
const toast = useToastStore();
const ask = useConfirm();
const relay = useScannerRelayStore();
const scanners = useScannersQuery();
const update = useUpdateScanner();

const drawer = ref(false);
const editing = ref<ScannerDto | null>(null);
const anyStation = computed(() => props.stations.some((s) => s.paired && !s.revoked));

function open(s: ScannerDto | null) {
  editing.value = s;
  drawer.value = true;
  emit("drawer", true);
}
function close() {
  drawer.value = false;
  emit("drawer", false);
}

async function use(s: ScannerDto) {
  let r = await relay.take({ id: s.id, name: s.name });
  if (!r.ok && "heldBy" in r) {
    const ok = await ask({
      title: `${r.heldBy} is using ${s.name}`,
      message: "If you take it, its scans come to this screen instead of theirs.",
      confirmLabel: "Take it",
    });
    if (!ok) return;
    r = await relay.take({ id: s.id, name: s.name }, true);
  }
  if (!r.ok) toast.error("Could not use the scanner", "error" in r ? r.error : undefined);
  else toast.success(`${s.name} is yours on this device`, "Scan the test label below to check it.");
  void scanners.refetch();
}

async function retire(s: ScannerDto) {
  const ok = await ask({
    title: `Retire ${s.name}?`,
    message: "The station stops reading it, and whoever is using it is let go.",
    confirmLabel: "Retire",
    tone: "danger",
  });
  if (!ok) return;
  try {
    await update.mutateAsync({ id: s.id, patch: { retired: true } });
    if (relay.held?.id === s.id) await relay.release();
    toast.success(`${s.name} retired`);
  } catch (e) {
    toast.error("Could not retire the scanner", e instanceof Error ? e.message : undefined);
  }
}

const columns: DataTableColumn[] = [
  { key: "name", label: "Scanner", cellClass: "font-medium text-ink" },
  { key: "stationName", label: "Station" },
  { key: "status", label: "Status" },
  { key: "holder", label: "Used by" },
  { key: "lastReadAt", label: "Last scan" },
];
const rows = computed(() => scanners.data.value ?? []);
const heldHere = (s: ScannerDto) => relay.held?.id === s.id;
</script>

<template>
  <div class="space-y-3">
    <div v-if="manage && anyStation" class="flex justify-end">
      <BaseButton variant="secondary" @click="open(null)">Add scanner</BaseButton>
    </div>
    <!-- ui-adoption: never-empty — the empty slot says how a scanner gets here. -->
    <DataTable
      :columns="columns"
      :rows="rows"
      :loading="scanners.isLoading.value"
      :error="scanners.isError.value ? 'Could not load the scanners.' : null"
      row-key="id"
      @retry="() => scanners.refetch()"
    >
      <template #cell-status="{ row }">
        <AppBadge :tone="SCANNER_STATUS_TEXT[row.status as ScannerDto['status']].tone" :title="row.statusDetail ?? SCANNER_STATUS_TEXT[row.status as ScannerDto['status']].help">
          {{ SCANNER_STATUS_TEXT[row.status as ScannerDto["status"]].label }}
        </AppBadge>
      </template>
      <template #cell-holder="{ row }">
        <template v-if="heldHere(row as ScannerDto)">This device</template>
        <template v-else-if="row.holder">{{ row.holder.name }}{{ row.holder.byYou ? " (you, another device)" : "" }}</template>
        <span v-else class="text-ink-tertiary">Nobody</span>
      </template>
      <template #cell-lastReadAt="{ row }">
        <template v-if="row.lastReadAt">
          {{ formatDateTime(row.lastReadAt) }}
          <span v-if="row.lastReadDelivered === false" class="text-ink-tertiary"> · nobody was using it</span>
        </template>
        <span v-else class="text-ink-tertiary">Never</span>
      </template>
      <template #actions="{ row }">
        <KebabMenu>
          <BaseButton v-if="heldHere(row as ScannerDto)" class="kebab-item" @click="relay.release()">Stop using here</BaseButton>
          <BaseButton v-else class="kebab-item" @click="use(row as ScannerDto)">Use on this device</BaseButton>
          <BaseButton v-if="manage" class="kebab-item" @click="open(row as ScannerDto)">Edit</BaseButton>
          <BaseButton v-if="manage" class="kebab-item kebab-item-danger" @click="retire(row as ScannerDto)">Retire</BaseButton>
        </KebabMenu>
      </template>
      <template #empty>
        No scanner on a print station yet. Plug one into the station's computer, switch it to USB-COM mode with the setup
        barcode in its manual, then add it here — every phone, tablet and computer can then use it.
      </template>
    </DataTable>
    <ScannerDrawer :open="drawer" :scanner="editing" :stations="stations" @close="close" />
  </div>
</template>
