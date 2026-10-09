<script setup lang="ts">
import { computed, ref } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import {
  QUEUE_EXCEPTION_KINDS, exceptionStatusesIn,
  type FindingKind, type FindingQueueState, type FuelExceptionKind,
} from "@silvicom/shared";
import ExportButton from "@/components/ExportButton.vue";
import { exceptionExportQuery, type ExceptionQuery } from "@/features/reconcile/useExceptions";
import { apiDownload } from "@/lib/api";
import { useToastStore } from "@/stores/toast";

/**
 * The CSV and the dispute packet of Fuel problems (`FuelProblemsPage`), out of the page at 8c4 (its file budget).
 *
 * FUEL-P2/P3 — the file, rendered on the server over the WHOLE filtered set.
 *
 * ⚠ This button used to serialise `rows.value`: the 25 rows on the current page. A controller
 * assembling a claim got page one of a filtered ledger with nothing saying so, while the four tiles
 * above it reported the whole window's money. A smaller export is one thing; an export that disagrees
 * with the tiles above the button it came from is another.
 *
 * ── WHAT IT CAN HONESTLY CONTAIN ────────────────────────────────────────────────────────────────
 * ⚠ `exceptions/export.csv` renders on the server from `fuel_exceptions` — the MONEY findings. Since
 * C7b the list above it also holds theft cases, so an export button that said nothing would produce a
 * file narrower than the list it sits under, which is the failure this page's own header calls "the
 * one that looks like a working download". Two things follow: the query is translated into the
 * ledger's own vocabulary so the file is exactly the money subset of what is on screen, and the scope
 * line says so in words.
 *
 * A theft case has no row in a dispute packet either — it is an accusation about a person, not a line
 * to bill back — so the same scoping covers the packet below.
 */
const props = defineProps<{
  states: FindingQueueState[];
  kinds: FindingKind[];
  vehicleIds: string[];
  assignedTo: string | null;
  from: string;
  to: string;
  /** The money findings currently on screen — what the export and the packet actually cover. */
  moneyIds: string[];
}>();

const toast = useToastStore();

const ledgerQuery = computed<ExceptionQuery>(() => ({
  // Translated through C7a rather than restated: the axis maps back into each source's vocabulary.
  status: [...new Set(props.states.flatMap((st) => exceptionStatusesIn(st)))],
  // Only the queue's money kinds: a theft case or an incident has no row in the money ledger, and the
  // buying habits left the queue (9b) — with no kind chosen the file names the queue's kinds, or the
  // ledger route would hand back the habits too.
  kind: ((ks) => (ks.length ? ks : [...QUEUE_EXCEPTION_KINDS]))(
    props.kinds.filter((k): k is FuelExceptionKind => (QUEUE_EXCEPTION_KINDS as readonly string[]).includes(k)),
  ),
  vehicleIds: props.vehicleIds,
  assignedTo: props.assignedTo,
  from: props.from,
  to: props.to,
  // Paging is dropped by `exceptionExportQuery`: the file is the whole filtered set.
  page: 1,
  pageSize: 1,
}));

const exportTarget = computed(() => {
  const n = props.vehicleIds.length;
  return {
    href: `/api/fueling/exceptions/export.csv?${exceptionExportQuery(ledgerQuery.value)}`,
    filename: `fuel-findings-${props.from}-to-${props.to}.csv`,
    scope: `${props.from} → ${props.to} · ${n === 0 ? "all trucks" : `${n} truck${n === 1 ? "" : "s"}`} · money findings only`,
  };
});

const packetBusy = ref(false);
/**
 * The document you send Pilot. Rendered on the server from the persisted runs, not from whatever this
 * screen is showing — a figure in a dispute packet gets quoted back months later, so it comes from the
 * same records the finding was written from.
 */
async function downloadPacket() {
  if (packetBusy.value || props.moneyIds.length === 0) return;
  packetBusy.value = true;
  try {
    await apiDownload(`/api/fueling/exceptions/packet.pdf?ids=${props.moneyIds.join(",")}`, `fuel-dispute-packet-${props.from}.pdf`);
  } catch (e) {
    toast.error("Could not build the packet", e instanceof Error ? e.message : undefined);
  } finally {
    packetBusy.value = false;
  }
}
</script>

<template>
  <ExportButton
    :href="exportTarget.href"
    :filename="exportTarget.filename"
    :scope="exportTarget.scope"
    :disabled="!moneyIds.length"
  />
  <BaseButton variant="secondary" :disabled="!moneyIds.length || packetBusy" @click="downloadPacket">
    {{ packetBusy ? "Building…" : "Dispute packet" }}
  </BaseButton>
</template>
