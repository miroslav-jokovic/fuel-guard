<script setup lang="ts">
import { computed, ref } from "vue";
import { AppButton, FactList, QueryState } from "@silvicom/ui";
import type { WorkOrderFile, WorkOrderInvoice, WorkOrderLine } from "@silvicom/shared";
import SlideOver from "@/components/SlideOver.vue";
import { formatDate, formatDateTime } from "@/lib/format";
import { fmtMoney } from "@/lib/chartTheme";
import { openPdf } from "@/lib/documentDownload";
import { useWorkOrderDetailQuery, useWorkOrderFilesQuery, workOrderFilePath, type WorkOrderTarget } from "@/composables/useWorkOrder";

/**
 * One FleetPal work order in full — what was done, with what parts and labour, and the vendor invoices
 * billed against it (FLEETPAL-INTEGRATION-PLAN.md F14, D-FP27). Opened from a work order row on the
 * Shop's Work orders tab and on a truck's shop page, because the owner asked on 2026-11-17 where the
 * work order's receipts were: until then the record was rendered only on a roadside repair (IC11). Since
 * F16 (2026-11-18) the roadside inspection page opens it too, by FleetPal's id — which is why it lives in
 * `components/` and not in `features/maintenance`.
 *
 * ── THE RECEIPT: FLEETPAL'S RECORD OF THE INVOICE, AND THE SCANNED BILL BEHIND IT ─────────────
 * Each invoice prints its number, date and amount as FleetPal holds them, and under it the files the
 * shop attached to it in FleetPal, asked of FleetPal when the drawer opens (F16, D-FP28 — Q-IC12's "the
 * API serves no files" was true only of our September copy of its spec). "No file attached" is said only
 * after FleetPal answered; a disconnected or unreachable FleetPal says so instead, because a missing
 * bill is a fact about the shop's paperwork and must never be inferred from our connection. An outside
 * vendor's bill reaches a work order only through a purchase order the shop raised on it.
 *
 * ── MONEY HERE IS ONE BILL, NEVER A TOTAL (D-FP27 narrows D-FP4) ─────────────────────────────
 * Line, job and invoice amounts are FleetPal's own figures for this one order, exactly as the roadside
 * repair record prints them. Nothing is summed across orders or invoices here — a fleet total still
 * needs its coverage bound and lives on Repair cost.
 *
 * Read-only, like the list it opens from: the repair is worked in FleetPal (D-INV10).
 */
/** `id` is OUR row's id (every Shop list); `fleetpalId` is FleetPal's (a roadside repair). One at a time. */
const props = defineProps<{ id?: string | null; fleetpalId?: string | null }>();
const emit = defineEmits<{ close: [] }>();

const target = computed((): WorkOrderTarget | null => (props.id ? { rowId: props.id } : props.fleetpalId ? { fleetpalId: props.fleetpalId } : null));
const q = useWorkOrderDetailQuery(target);
const d = computed(() => q.data.value ?? null);

/** Files are asked about only when there is an invoice to ask about — an order with none never calls FleetPal. */
const files = useWorkOrderFilesQuery(computed(() => (d.value && d.value.record.invoices.length > 0 ? d.value.id : null)));
const filesState = computed(() => (files.isError.value ? "unreachable" : (files.data.value?.state ?? "checking")));
const filesOf = (i: WorkOrderInvoice): WorkOrderFile[] =>
  files.data.value?.state === "read" ? files.data.value.files.filter((f) => f.invoiceId === i.invoiceId) : [];
const fileWord = (f: WorkOrderFile) => (f.contentType === "application/pdf" ? "PDF" : f.contentType?.startsWith("image/") ? "image" : "file");

const opening = ref<string | null>(null);
const openFailure = ref<string | null>(null);
async function openFile(f: WorkOrderFile) {
  if (!d.value) return;
  opening.value = `${f.invoiceId}:${f.index}`;
  openFailure.value = null;
  try {
    await openPdf(workOrderFilePath(d.value.id, f.invoiceId, f.index));
  } catch (e) {
    openFailure.value = e instanceof Error ? e.message : "Could not open the file.";
  } finally {
    opening.value = null;
  }
}
const title = computed(() => d.value?.record.reference ?? "Work order");

const word = (s: string | null) => (s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ") : null);
const TYPE: Record<string, string> = { PART: "Part", LABOR: "Labour", SERVICE: "Service", FEE: "Fee", TAX: "Tax" };
const money = (n: number | null) => (n === null ? "—" : fmtMoney(n));
function qty(l: WorkOrderLine): string | null {
  if (l.quantity === null) return null;
  const n = l.quantity.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return l.type === "LABOR" ? `${n} h` : l.unitOfMeasure ? `${n} ${l.unitOfMeasure}` : `× ${n}`;
}
const isCredit = (i: WorkOrderInvoice) => i.invoiceType === "CREDIT";
</script>

<template>
  <SlideOver :open="target !== null" :title="title" :description="d ? [d.unitNumber ? `Unit ${d.unitNumber}` : null, word(d.record.status)].filter(Boolean).join(' · ') : undefined" size="lg" @close="emit('close')">
    <QueryState
      :loading="q.isPending.value"
      :error="q.isError.value"
      :retrying="q.isFetching.value"
      loading-text="Loading the work order…"
      error-text="Could not load this work order."
      @retry="q.refetch()"
    >
      <div v-if="d" class="space-y-6 text-sm" data-test="work-order-drawer">
        <FactList
          :columns="2"
          :facts="[
            { label: 'Opened', value: d.record.openedAt ? formatDate(d.record.openedAt) : null },
            { label: 'Completed', value: d.record.completedAt ? formatDate(d.record.completedAt) : 'Not yet' },
          ]"
        />
        <p v-if="d.record.description" class="text-ink-secondary">{{ d.record.description }}</p>

        <section aria-label="Invoices" data-test="work-order-invoices">
          <h3 class="mb-2 text-sm font-semibold text-ink">Invoices</h3>
          <ul v-if="d.record.invoices.length" class="divide-y divide-edge-subtle rounded-control border border-edge-subtle">
            <li v-for="(i, n) in d.record.invoices" :key="n" class="flex items-start justify-between gap-4 px-3 py-2">
              <span class="min-w-0">
                <span class="font-medium text-ink">Invoice {{ i.invoiceNumber ?? "with no number" }}</span>
                <span v-if="isCredit(i)" class="ml-2 text-xs text-ink-muted">Credit</span>
                <span class="block text-xs text-ink-muted">
                  {{ i.invoiceDate ? formatDate(i.invoiceDate) : "No date" }}<template v-if="i.purchaseOrder"> · Purchase order {{ i.purchaseOrder }}</template>
                </span>
                <span class="mt-1 block" data-test="invoice-files">
                  <template v-if="filesState === 'read'">
                    <span v-if="!filesOf(i).length" class="text-xs text-ink-muted" data-test="invoice-no-file">No bill attached in FleetPal</span>
                    <AppButton
                      v-for="f in filesOf(i)"
                      :key="f.index"
                      variant="link"
                      size="sm"
                      :title="f.filename"
                      :disabled="opening !== null"
                      data-test="invoice-file"
                      @click="openFile(f)"
                    >
                      {{ opening === `${f.invoiceId}:${f.index}` ? "Opening…" : `Open bill (${fileWord(f)})` }}
                    </AppButton>
                  </template>
                </span>
              </span>
              <span class="shrink-0 tabular-nums text-ink">{{ i.amount === null ? "—" : isCredit(i) ? `−${money(i.amount)}` : money(i.amount) }}</span>
            </li>
          </ul>
          <p v-if="d.record.invoices.length && filesState === 'checking'" class="mt-2 text-xs text-ink-muted" data-test="files-checking">Checking FleetPal for the scanned bills…</p>
          <p v-else-if="d.record.invoices.length && filesState === 'not_connected'" class="mt-2 text-xs text-ink-muted" data-test="files-not-connected">
            FleetPal is not connected for this fleet, so its scanned bills cannot be checked. An admin connects it under Settings → FleetPal.
          </p>
          <p v-else-if="d.record.invoices.length && filesState === 'unreachable'" class="mt-2 text-xs text-ink-muted" data-test="files-unreachable">
            Could not reach FleetPal to check for scanned bills.
            <AppButton variant="link" size="sm" @click="files.refetch()">Try again</AppButton>
          </p>
          <p v-if="openFailure" class="mt-2 text-xs text-danger-700" role="alert" data-test="file-open-error">{{ openFailure }}</p>
          <p v-if="!d.record.invoices.length" class="text-ink-muted">
            No vendor invoice on this work order. An outside shop's bill shows here only when a purchase order was raised on the work order in FleetPal.
          </p>
        </section>

        <section aria-label="Work done" data-test="work-order-jobs">
          <h3 class="mb-2 text-sm font-semibold text-ink">Work done</h3>
          <p v-if="!d.record.jobs.length" class="text-ink-muted">FleetPal lists no job on this work order.</p>
          <div v-for="(j, n) in d.record.jobs" :key="n" class="mb-3 rounded-control border border-edge-subtle">
            <div class="flex items-start justify-between gap-4 border-b border-edge-subtle px-3 py-2">
              <span class="min-w-0">
                <span class="font-medium text-ink">{{ j.name ?? "Job" }}</span>
                <span v-if="j.complaint" class="block text-xs text-ink-muted">Complaint: {{ j.complaint }}</span>
              </span>
              <span class="shrink-0 tabular-nums font-medium text-ink">{{ money(j.total) }}</span>
            </div>
            <ul v-if="j.lines.length" class="divide-y divide-edge-subtle">
              <li v-for="(l, k) in j.lines" :key="k" class="flex items-start justify-between gap-4 px-3 py-1.5">
                <span class="min-w-0 text-ink-secondary">
                  <span class="text-xs text-ink-muted">{{ TYPE[l.type ?? ""] ?? word(l.type) ?? "Line" }}</span>
                  {{ l.description ?? "" }}
                  <span v-if="l.partNumber" class="font-mono text-xs text-ink-muted">{{ l.partNumber }}</span>
                  <span v-if="qty(l)" class="text-xs text-ink-muted"> · {{ qty(l) }}</span>
                </span>
                <span class="shrink-0 tabular-nums text-ink-secondary">{{ money(l.total) }}</span>
              </li>
            </ul>
          </div>
        </section>

        <p class="text-xs text-ink-muted" data-test="work-order-as-of">
          From FleetPal<template v-if="d.asOf">, as of {{ formatDateTime(d.asOf) }}</template><template v-else>; one of its records has not synced yet, so this may be incomplete</template>. Worked and changed in FleetPal.
        </p>
      </div>
    </QueryState>
  </SlideOver>
</template>
