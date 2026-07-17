<script setup lang="ts">
import { ref } from "vue";
import { MapPinIcon, ArrowPathIcon } from "@heroicons/vue/24/outline";
import BaseCard from "@/components/ui/BaseCard.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import FileDropzone from "@/components/ui/FileDropzone.vue";
import { useToastStore } from "@/stores/toast";
import {
  uploadLocationsExport, uploadPostedPrices, fetchPostedPricesNow, syncKwikTrip, fetchRoadRanger,
  uploadLovesExport, syncLoves,
  type LocationsIngestResult, type PostedIngestResult,
} from "./useStationData";

const toast = useToastStore();
const locLoading = ref(false);
const locResult = ref<LocationsIngestResult | null>(null);
const priceLoading = ref(false);
const priceResult = ref<PostedIngestResult | null>(null);

async function onLocationFiles(files: File[]) {
  const file = files[0];
  if (!file || locLoading.value) return;
  locLoading.value = true;
  locResult.value = null;
  try {
    locResult.value = await uploadLocationsExport(file);
    toast.success("Locations loaded", `${locResult.value.updated + locResult.value.inserted} stations placed at exact coordinates.`);
  } catch (e) {
    toast.error("Could not load locations", e instanceof Error ? e.message : undefined);
  } finally {
    locLoading.value = false;
  }
}

async function onPriceFiles(files: File[]) {
  const file = files[0];
  if (!file || priceLoading.value) return;
  priceLoading.value = true;
  priceResult.value = null;
  try {
    priceResult.value = await uploadPostedPrices(file);
    toast.success("Posted prices loaded", `${priceResult.value.pricesInserted.toLocaleString()} prices across ${priceResult.value.stationRows} stations.`);
  } catch (e) {
    toast.error("Could not load posted prices", e instanceof Error ? e.message : undefined);
  } finally {
    priceLoading.value = false;
  }
}

async function onFetchNow() {
  if (priceLoading.value) return;
  priceLoading.value = true;
  priceResult.value = null;
  try {
    priceResult.value = await fetchPostedPricesNow();
    toast.success("Posted prices refreshed", `${priceResult.value.pricesInserted.toLocaleString()} prices from Pilot's public table.`);
  } catch (e) {
    toast.error("Posted-price fetch failed", e instanceof Error ? e.message : undefined);
  } finally {
    priceLoading.value = false;
  }
}

// Regional networks (Kwik Trip locations sync; Road Ranger locations + cash prices).
const regionalLoading = ref(false);
const regionalStatus = ref("");
async function onSyncKwikTrip() {
  if (regionalLoading.value) return;
  regionalLoading.value = true;
  regionalStatus.value = "";
  try {
    const r = await syncKwikTrip();
    regionalStatus.value = `Kwik Trip: ${r.stationsUpserted} truck-friendly stations loaded (from ${r.tableRows} stores)` +
      (r.truckFriendlyNotInTable ? ` · ${r.truckFriendlyNotInTable} list entries not in the table` : "");
    toast.success("Kwik Trip synced", `${r.stationsUpserted} truck-friendly stations.`);
  } catch (e) {
    toast.error("Kwik Trip sync failed", e instanceof Error ? e.message : undefined);
  } finally {
    regionalLoading.value = false;
  }
}
async function onFetchRoadRanger() {
  if (regionalLoading.value) return;
  regionalLoading.value = true;
  regionalStatus.value = "";
  try {
    const r = await fetchRoadRanger();
    regionalStatus.value = `Road Ranger: ${r.pricesInserted} cash prices across ${r.stationsUpserted} stations` +
      (r.geocodeFailed ? ` · ${r.geocodeFailed} still geocoding (auto-retried)` : "");
    toast.success("Road Ranger refreshed", `${r.pricesInserted} truck-diesel cash prices.`);
  } catch (e) {
    toast.error("Road Ranger fetch failed", e instanceof Error ? e.message : undefined);
  } finally {
    regionalLoading.value = false;
  }
}

// Love's network: one .xlsx carries locations + current posted prices; live API sync once approved.
const lovesLoading = ref(false);
const lovesStatus = ref("");
async function onLovesFile(files: File[]) {
  const file = files[0];
  if (!file || lovesLoading.value) return;
  lovesLoading.value = true;
  lovesStatus.value = "";
  try {
    const r = await uploadLovesExport(file);
    lovesStatus.value =
      `Love's: ${r.stationsUpserted} stations, ${r.pricesInserted.toLocaleString()} prices` +
      (r.observedAt ? ` (as of ${new Date(r.observedAt).toLocaleString()})` : "");
    toast.success("Love's loaded", `${r.stationsUpserted} stations placed.`);
  } catch (e) {
    toast.error("Could not load Love's", e instanceof Error ? e.message : undefined);
  } finally {
    lovesLoading.value = false;
  }
}
async function onSyncLoves() {
  if (lovesLoading.value) return;
  lovesLoading.value = true;
  lovesStatus.value = "";
  try {
    const r = await syncLoves();
    lovesStatus.value = `Love's API: ${r.stationsUpserted} stations, ${r.pricesInserted.toLocaleString()} prices.`;
    toast.success("Love's synced", `${r.stationsUpserted} stations.`);
  } catch (e) {
    toast.error("Love's API sync failed", e instanceof Error ? e.message : undefined);
  } finally {
    lovesLoading.value = false;
  }
}
</script>

<template>
  <BaseCard>
    <div class="flex items-start justify-between gap-4">
      <div>
        <h3 class="text-sm font-semibold text-ink">Truck stop registry &amp; posted prices</h3>
        <p class="mt-1 text-sm text-ink-muted">
          Shared network data (all companies): exact station locations from Pilot's "Download All Locations" export, and
          network-wide posted retail prices — refreshed automatically, or on demand here.
        </p>
      </div>
      <MapPinIcon class="size-5 shrink-0 text-ink-subtle" aria-hidden="true" />
    </div>

    <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <p class="text-xs font-medium text-ink-secondary">Locations export (.csv)</p>
        <div class="mt-1.5"><FileDropzone accept=".csv" :disabled="locLoading" @files="onLocationFiles" /></div>
        <div v-if="locResult" class="mt-2 space-y-1 text-sm">
          <p class="text-success-800">{{ locResult.updated }} updated · {{ locResult.inserted }} new · {{ locResult.movedFar }} moved &gt;5&nbsp;mi (centroid fixes)</p>
          <p v-if="locResult.unknownBrandNames.length" class="text-caution-700">Unknown brands flagged: {{ locResult.unknownBrandNames.join(", ") }}</p>
          <p v-if="locResult.missingFromExport" class="text-ink-muted">{{ locResult.missingFromExport }} registry station(s) not in this export — review before closing anything.</p>
        </div>
      </div>

      <div>
        <p class="text-xs font-medium text-ink-secondary">Posted prices (.xlsx / .xls) — or fetch the live table</p>
        <div class="mt-1.5"><FileDropzone accept=".xlsx,.xls,.xlsm" :disabled="priceLoading" @files="onPriceFiles" /></div>
        <div class="mt-2 flex items-center gap-3">
          <BaseButton variant="secondary" size="sm" type="button" :disabled="priceLoading" @click="onFetchNow">
            <ArrowPathIcon class="-ml-0.5 size-4" :class="priceLoading ? 'animate-spin' : ''" aria-hidden="true" /> Fetch now
          </BaseButton>
          <p v-if="priceResult" class="text-sm text-success-800">
            {{ priceResult.pricesInserted.toLocaleString() }} prices · {{ priceResult.stationRows }} stations
            <span v-if="priceResult.unmatched" class="text-caution-700"> · {{ priceResult.unmatched }} unmatched (reload locations)</span>
          </p>
        </div>
      </div>
    </div>

    <div class="mt-4 border-t border-edge pt-4">
      <p class="text-xs font-medium text-ink-secondary">Regional networks</p>
      <p class="mt-1 text-sm text-ink-muted">
        Kwik Trip loads only the chain's official truck-friendly stores; Road Ranger prices are <strong>cash</strong> prices
        (marked as such in planning). Enable each network per company in Fuel Planning settings.
      </p>
      <div class="mt-2 flex flex-wrap items-center gap-3">
        <BaseButton variant="secondary" size="sm" type="button" :disabled="regionalLoading" @click="onSyncKwikTrip">Sync Kwik Trip</BaseButton>
        <BaseButton variant="secondary" size="sm" type="button" :disabled="regionalLoading" @click="onFetchRoadRanger">Fetch Road Ranger prices</BaseButton>
        <p v-if="regionalStatus" class="text-sm text-success-800">{{ regionalStatus }}</p>
      </div>
    </div>

    <div class="mt-4 border-t border-edge pt-4">
      <p class="text-xs font-medium text-ink-secondary">Love's network (~650 stops)</p>
      <p class="mt-1 text-sm text-ink-muted">
        Upload the Love's "Search Results" export (.xlsx / .xls) — one file loads exact locations <strong>and</strong> current posted
        diesel/DEF prices. Once your API access is approved, "Sync via API" refreshes prices live instead.
      </p>
      <div class="mt-2"><FileDropzone accept=".xlsx,.xls,.xlsm" :disabled="lovesLoading" @files="onLovesFile" /></div>
      <div class="mt-2 flex flex-wrap items-center gap-3">
        <BaseButton variant="secondary" size="sm" type="button" :disabled="lovesLoading" @click="onSyncLoves">Sync via API</BaseButton>
        <p v-if="lovesStatus" class="text-sm text-success-800">{{ lovesStatus }}</p>
      </div>
    </div>
  </BaseCard>
</template>
