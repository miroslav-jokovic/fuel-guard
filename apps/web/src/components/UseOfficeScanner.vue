<script setup lang="ts">
import { computed } from "vue";
import { AppBadge, AppButton as BaseButton, useConfirm } from "@silvicom/ui";
import type { ScannerDto } from "@silvicom/shared";
import { SCANNER_STATUS_TEXT, useScannersQuery } from "@/composables/useScanners";
import { useScannerRelayStore } from "@/stores/scannerRelay";
import { useToastStore } from "@/stores/toast";

/**
 * "Use the office scanner" — take a scanner plugged into a print station for THIS device
 * (SCANNER-RELAY-PLAN.md SR4, D-SR3). On the Scan page, beside the place scans land.
 *
 * Renders nothing when the organization has no relayed scanner: a shop scanning by Bluetooth
 * straight to its tablets sees the Scan page exactly as before. Somebody else holding it is asked
 * about by name — "Mia is using it. Take it?" — because a takeover moves their scans to this screen.
 */
const relay = useScannerRelayStore();
const toast = useToastStore();
const ask = useConfirm();
const scanners = useScannersQuery();
const list = computed(() => (scanners.data.value ?? []).filter((s) => !s.retired));

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
  if (!r.ok) {
    toast.error("Could not use the scanner", "error" in r ? r.error : undefined);
    return;
  }
  void scanners.refetch();
  if (s.status !== "ready") toast.warning(`${s.name}: ${SCANNER_STATUS_TEXT[s.status].label}`, SCANNER_STATUS_TEXT[s.status].help);
}
</script>

<template>
  <div v-if="list.length > 0" class="flex flex-wrap items-center gap-2" data-testid="use-office-scanner">
    <template v-if="relay.held">
      <span class="text-sm text-ink-secondary">
        Using <span class="font-medium text-ink">{{ relay.held.name }}</span>
      </span>
      <BaseButton variant="secondary" size="sm" @click="relay.release()">Stop using</BaseButton>
    </template>
    <template v-else>
      <BaseButton v-for="s in list" :key="s.id" variant="secondary" size="sm" @click="use(s)">
        Use {{ s.name }}
        <AppBadge v-if="s.status !== 'ready'" :tone="SCANNER_STATUS_TEXT[s.status].tone" class="ml-1.5">
          {{ SCANNER_STATUS_TEXT[s.status].label }}
        </AppBadge>
      </BaseButton>
    </template>
  </div>
</template>
