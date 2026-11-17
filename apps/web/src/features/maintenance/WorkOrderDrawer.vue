<script setup lang="ts">
import { computed, toRef } from "vue";
import { FactList, QueryState } from "@silvicom/ui";
import type { WorkOrderInvoice, WorkOrderLine } from "@silvicom/shared";
import SlideOver from "@/components/SlideOver.vue";
import { formatDate, formatDateTime } from "@/lib/format";
import { fmtMoney } from "@/lib/chartTheme";
import { useWorkOrderDetailQuery } from "./useShopBacklog";

/**
 * One FleetPal work order in full — what was done, with what parts and labour, and the vendor invoices
 * billed against it (FLEETPAL-INTEGRATION-PLAN.md F14, D-FP27). Opened from a work order row on the
 * Shop's Work orders tab and on a truck's shop page, because the owner asked on 2026-11-17 where the
 * work order's receipts were: until then the record was rendered only on a roadside repair (IC11).
 *
 * ── THE RECEIPT IS FLEETPAL'S RECORD OF THE INVOICE, NOT A PICTURE OF IT ──────────────────────
 * FleetPal's API serves no files (Q-IC12), so the drawer shows the invoice number, date and amount as
 * FleetPal holds them, and says plainly when there is none: an outside vendor's bill reaches a work
 * order only through a purchase order the shop raised on it.
 *
 * ── MONEY HERE IS ONE BILL, NEVER A TOTAL (D-FP27 narrows D-FP4) ─────────────────────────────
 * Line, job and invoice amounts are FleetPal's own figures for this one order, exactly as the roadside
 * repair record prints them. Nothing is summed across orders or invoices here — a fleet total still
 * needs its coverage bound and lives on Repair cost.
 *
 * Read-only, like the list it opens from: the repair is worked in FleetPal (D-INV10).
 */
const props = defineProps<{ id: string | null }>();
const emit = defineEmits<{ close: [] }>();

const q = useWorkOrderDetailQuery(toRef(props, "id"));
const d = computed(() => q.data.value ?? null);
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
  <SlideOver :open="id !== null" :title="title" :description="d ? [d.unitNumber ? `Unit ${d.unitNumber}` : null, word(d.record.status)].filter(Boolean).join(' · ') : undefined" size="lg" @close="emit('close')">
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
              </span>
              <span class="shrink-0 tabular-nums text-ink">{{ i.amount === null ? "—" : isCredit(i) ? `−${money(i.amount)}` : money(i.amount) }}</span>
            </li>
          </ul>
          <p v-else class="text-ink-muted">
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
