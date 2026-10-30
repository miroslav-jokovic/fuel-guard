<script setup lang="ts">
import { computed, ref } from "vue";
import {
  AppBadge,
  AppButton as BaseButton,
  AppCallout,
  AppCard as BaseCard,
  AppIcon,
  DataTable,
  type DataTableColumn,
  useConfirm,
} from "@silvicom/ui";
import { PlusIcon } from "@silvicom/ui/icons";
import type { PairingCodeDto, PrinterDto } from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import SettingsSection from "@/components/ui/SettingsSection.vue";
import KebabMenu from "@/components/KebabMenu.vue";
import StationDrawer from "@/features/devices/StationDrawer.vue";
import PrinterDrawer from "@/features/devices/PrinterDrawer.vue";
import ScannerTestCard from "@/features/devices/ScannerTestCard.vue";
import ScannersSection from "@/features/devices/ScannersSection.vue";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { formatDateTime } from "@/lib/format";
import {
  jobStatusText,
  usePrintDefaultsQuery,
  usePrintersQuery,
  usePrintJobsQuery,
  usePrintTestLabel,
  useRenewPairingCode,
  useRevokeStation,
  useSetDefaultPrinter,
  useStationsQuery,
  useUpdatePrinter,
} from "@/composables/usePrinting";

/**
 * Settings → Devices (PRINTERS-AND-SCANNERS-PLAN.md PS4): the owner's "set it up once, then it just
 * prints" made visible. Print stations (the always-on computer beside a printer), the printers on
 * them with a green or red dot, which one Print uses without asking — the organization's, and each
 * person's own — and the last jobs, so "my label did not come out" has an answer on this screen.
 *
 * Choosing one's OWN default needs only `view` (the API's rule); everything else here is `manage`.
 */

const session = useSessionStore();
const toast = useToastStore();
const ask = useConfirm();
const manage = computed(() => session.can("maintenance"));

const stations = useStationsQuery();
const printers = usePrintersQuery();
const defaults = usePrintDefaultsQuery();
const jobs = usePrintJobsQuery();
const renew = useRenewPairingCode();
const revoke = useRevokeStation();
const setDefault = useSetDefaultPrinter();
const testLabel = usePrintTestLabel();
const updatePrinter = useUpdatePrinter();

const stationDrawer = ref(false);
const issued = ref<PairingCodeDto | null>(null);
const printerDrawer = ref(false);
const editing = ref<PrinterDto | null>(null);
const scannerDrawer = ref(false);
const drawerOpen = computed(() => stationDrawer.value || printerDrawer.value || scannerDrawer.value);

const livePrinters = computed(() => (printers.data.value ?? []).filter((p) => !p.retired));
const noStation = computed(() => stations.isSuccess.value && (stations.data.value ?? []).length === 0);
const noDefault = computed(() => defaults.isSuccess.value && !defaults.data.value?.effectivePrinterId && livePrinters.value.length > 0);

function addStation() {
  issued.value = null;
  stationDrawer.value = true;
}
async function newCode(id: string) {
  try {
    issued.value = await renew.mutateAsync(id);
    stationDrawer.value = true;
  } catch (e) {
    toast.error("Could not make a new code", e instanceof Error ? e.message : undefined);
  }
}
async function disconnect(id: string, name: string) {
  const ok = await ask({
    title: `Disconnect ${name}?`,
    message: "It stops printing at once. Its printers stay listed; pair it again with a new code to bring it back.",
    confirmLabel: "Disconnect",
    tone: "danger",
  });
  if (!ok) return;
  try {
    await revoke.mutateAsync(id);
    toast.success(`${name} disconnected`);
  } catch (e) {
    toast.error("Could not disconnect the station", e instanceof Error ? e.message : undefined);
  }
}

function editPrinter(p: PrinterDto | null) {
  editing.value = p;
  printerDrawer.value = true;
}
async function choose(scope: "organization" | "me", printerId: string | null) {
  try {
    await setDefault.mutateAsync({ scope, printerId });
    toast.success(printerId ? "Default printer set" : "Default cleared");
  } catch (e) {
    toast.error("Could not set the default printer", e instanceof Error ? e.message : undefined);
  }
}
async function test(p: PrinterDto) {
  try {
    await testLabel.mutateAsync(p.id);
    toast.success("Test label sent", `It should come out of ${p.name} in a few seconds.`);
  } catch (e) {
    toast.error("Could not print a test label", e instanceof Error ? e.message : undefined);
  }
}
async function retire(p: PrinterDto) {
  const ok = await ask({ title: `Retire ${p.name}?`, message: "Nobody can print to it after this.", confirmLabel: "Retire", tone: "danger" });
  if (!ok) return;
  try {
    await updatePrinter.mutateAsync({ id: p.id, patch: { retired: true } });
    toast.success(`${p.name} retired`);
  } catch (e) {
    toast.error("Could not retire the printer", e instanceof Error ? e.message : undefined);
  }
}

const printerColumns: DataTableColumn[] = [
  { key: "name", label: "Printer", cellClass: "font-medium text-ink" },
  { key: "stationName", label: "Station" },
  { key: "online", label: "Status", width: "sm" },
  { key: "isDefault", label: "Prints labels for" },
];
const printerRows = computed(() =>
  livePrinters.value.map((p) => ({
    ...p,
    isDefault: [
      defaults.data.value?.organizationPrinterId === p.id ? "Everyone" : null,
      defaults.data.value?.myPrinterId === p.id ? "You" : null,
    ].filter(Boolean).join(" · "),
  })),
);

const jobColumns: DataTableColumn[] = [
  { key: "createdAt", label: "When", width: "md" },
  { key: "description", label: "What" },
  { key: "status", label: "Outcome" },
];
const recentJobs = computed(() => (jobs.data.value ?? []).slice(0, 10));
const JOB_TONE = { queued: "neutral", sent: "info", printed: "success", failed: "danger", unknown: "caution", cancelled: "neutral" } as const;
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Label printers and scanners. Set a printer up once and every Print button uses it, from any device, without asking.">
      <template #actions>
        <BaseButton v-if="manage" variant="primary" @click="addStation">
          <AppIcon :icon="PlusIcon" class="-ml-0.5 size-5" aria-hidden="true" /> Add print station
        </BaseButton>
      </template>
    </PageHeader>

    <AppCallout v-if="noStation" tone="info">
      No print station yet. Add one for the always-on computer the label printer is plugged into, then add the printer.
    </AppCallout>
    <AppCallout v-else-if="noDefault" tone="caution">
      No default printer is set, so Print will ask which one. Choose one below.
    </AppCallout>

    <SettingsSection title="Print stations">
      <BaseCard padding="none">
        <ul class="divide-y divide-edge" data-testid="stations">
          <li v-for="s in stations.data.value ?? []" :key="s.id" class="flex items-center justify-between gap-4 px-5 py-3">
            <div>
              <p class="text-sm font-medium text-ink">{{ s.name }}</p>
              <p class="text-xs text-ink-tertiary">
                <template v-if="s.revoked">Disconnected</template>
                <template v-else-if="!s.paired">Waiting to be paired</template>
                <template v-else>{{ s.hostName }} · seen {{ s.lastSeenAt ? formatDateTime(s.lastSeenAt) : "never" }}</template>
              </p>
            </div>
            <div class="flex items-center gap-3">
              <AppBadge :tone="s.online ? 'success' : s.paired && !s.revoked ? 'danger' : 'neutral'">
                {{ s.online ? "Online" : s.paired && !s.revoked ? "Offline" : "Not paired" }}
              </AppBadge>
              <KebabMenu v-if="manage">
                <BaseButton class="kebab-item" @click="newCode(s.id)">{{ s.paired ? "Move to another computer" : "Show a new code" }}</BaseButton>
                <BaseButton v-if="s.paired && !s.revoked" class="kebab-item kebab-item-danger" @click="disconnect(s.id, s.name)">Disconnect</BaseButton>
              </KebabMenu>
            </div>
          </li>
          <li v-if="stations.isError.value" class="px-5 py-3 text-sm text-danger-700">Could not load the print stations.</li>
        </ul>
      </BaseCard>
    </SettingsSection>

    <SettingsSection title="Printers">
      <div v-if="manage && (stations.data.value ?? []).some((s) => s.paired && !s.revoked)" class="flex justify-end">
        <BaseButton variant="secondary" @click="editPrinter(null)">Add printer</BaseButton>
      </div>
      <DataTable
        :columns="printerColumns"
        :rows="printerRows"
        :loading="printers.isLoading.value"
        :error="printers.isError.value ? 'Could not load the printers.' : null"
        row-key="id"
        @retry="() => printers.refetch()"
      >
        <template #cell-online="{ row }">
          <AppBadge :tone="row.online ? 'success' : 'danger'">{{ row.online ? "Online" : "Offline" }}</AppBadge>
        </template>
        <template #actions="{ row }">
          <KebabMenu>
            <BaseButton v-if="defaults.data.value?.myPrinterId !== row.id" class="kebab-item" @click="choose('me', row.id)">Use for my labels</BaseButton>
            <BaseButton v-if="manage && defaults.data.value?.organizationPrinterId !== row.id" class="kebab-item" @click="choose('organization', row.id)">Use for everyone</BaseButton>
            <BaseButton v-if="manage" class="kebab-item" @click="test(row)">Print a test label</BaseButton>
            <BaseButton v-if="manage" class="kebab-item" @click="editPrinter(row)">Edit</BaseButton>
            <BaseButton v-if="manage" class="kebab-item kebab-item-danger" @click="retire(row)">Retire</BaseButton>
          </KebabMenu>
        </template>
        <template #empty>No printers yet. Pair a print station, then add the printer plugged into it.</template>
      </DataTable>
      <p v-if="defaults.data.value?.myPrinterId" class="text-sm text-ink-muted">
        You chose your own printer.
        <BaseButton variant="link" @click="choose('me', null)">Use everyone's default instead</BaseButton>
      </p>
    </SettingsSection>

    <SettingsSection title="Scanners">
      <ScannersSection :stations="stations.data.value ?? []" :manage="manage" @drawer="scannerDrawer = $event" />
      <ScannerTestCard :enabled="!drawerOpen" />
    </SettingsSection>

    <SettingsSection title="Recent print jobs">
      <DataTable
        :columns="jobColumns"
        :rows="recentJobs"
        :loading="jobs.isLoading.value"
        :error="jobs.isError.value ? 'Could not load the print jobs.' : null"
        row-key="id"
        @retry="() => jobs.refetch()"
      >
        <template #cell-createdAt="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        <template #cell-status="{ row }">
          <AppBadge :tone="JOB_TONE[row.status as keyof typeof JOB_TONE]">{{ jobStatusText(row) }}</AppBadge>
        </template>
        <template #empty>Nothing printed yet.</template>
      </DataTable>
    </SettingsSection>

    <StationDrawer :open="stationDrawer" :issued="issued" @close="stationDrawer = false" />
    <PrinterDrawer :open="printerDrawer" :printer="editing" :stations="stations.data.value ?? []" @close="printerDrawer = false" />
  </div>
</template>
