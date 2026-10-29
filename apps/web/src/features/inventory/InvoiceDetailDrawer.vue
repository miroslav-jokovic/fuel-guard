<script setup lang="ts">
import { computed, ref, toRef } from "vue";
import { DOCUMENT_CONTENT_TYPES, acceptFor, usd2, type DocumentRow } from "@silvicom/shared";
import { AppButton as BaseButton, AppCallout, FactList, QueryState, type Fact } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import DocumentPreview from "@/components/DocumentPreview.vue";
import FileDropzone from "@/components/ui/FileDropzone.vue";
import { formatDate, formatDateTime } from "@/lib/format";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import InvoiceDrawer from "./InvoiceDrawer.vue";
import { useFileInvoicePaper, usePurchaseDocumentsQuery, usePurchaseQuery } from "./usePurchases";

/**
 * One equipment invoice (M10b): what it says, the items it paid for, its paper, and *Correct*.
 *
 * A drawer over the Invoices tab rather than a page: an invoice is read and closed, and the tab's
 * search and page are where the person returns to. Its address is `?invoice=<id>` on that tab, so an
 * item's page links straight to it (`AssetDetailPage.vue`).
 *
 * *Correct* opens the form INSIDE this drawer's body, not beside it — two sibling dialogs would both
 * answer Escape (memory `sibling-dialogs-both-own-escape`); nested ones close innermost first. A
 * corrected invoice says so and offers the newest, which is the one the list shows.
 */
const props = defineProps<{ open: boolean; purchaseId: string }>();
const emit = defineEmits<{ close: []; "open-invoice": [id: string] }>();

const id = toRef(props, "purchaseId");
const session = useSessionStore();
const canManage = computed(() => session.can("maintenance"));
const toast = useToastStore();

const { data: bill, isLoading, isError, error, isFetching, refetch } = usePurchaseQuery(id);
const papers = usePurchaseDocumentsQuery(id);
const filePaper = useFileInvoicePaper(id);
const correcting = ref(false);
const viewing = ref<DocumentRow | null>(null);
const uploadAccept = acceptFor(DOCUMENT_CONTENT_TYPES);

const facts = computed<Fact[]>(() => {
  const b = bill.value;
  if (!b) return [];
  return [
    { label: "Vendor", value: b.vendor },
    { label: "Invoice number", value: b.invoiceNumber },
    { label: "Date", value: formatDate(b.invoiceDate) },
    { label: "Total", value: usd2(b.total), numeric: true },
    ...(b.fleetpalOrder
      ? [{ label: "FleetPal order", value: [b.fleetpalOrder.referenceNumber, b.fleetpalOrder.description].filter(Boolean).join(" · ") || "Linked" }]
      : []),
    { label: "Entered", value: [formatDateTime(b.createdAt), b.createdByName].filter(Boolean).join(" by ") },
    ...(b.notes ? [{ label: "Notes", value: b.notes }] : []),
  ];
});

async function onPaper(files: File[]) {
  const file = files[0];
  if (!file) return;
  try {
    await filePaper.mutateAsync(file);
    toast.success("Paper filed");
  } catch (e) {
    toast.error("Could not file the paper", e instanceof Error ? e.message : undefined);
  }
}

function onCorrected(saved: { id: string }) {
  correcting.value = false;
  emit("open-invoice", saved.id);
}
</script>

<template>
  <SlideOver :open="open" :title="bill ? `${bill.vendor} ${bill.invoiceNumber}` : 'Invoice'" size="lg" @close="emit('close')">
    <QueryState
      :loading="isLoading && !bill"
      :error="isError ? error : null"
      :retrying="isFetching"
      loading-text="Loading the invoice…"
      error-text="Could not load the invoice."
      @retry="refetch()"
    >
      <div v-if="bill" class="space-y-6" data-test="invoice-detail">
        <AppCallout v-if="bill.supersededBy" tone="warning" data-test="invoice-superseded">
          This invoice was corrected. The corrected copy is the one in the list.
          <template #actions>
            <BaseButton size="sm" @click="emit('open-invoice', bill.supersededBy!)">Open the corrected one</BaseButton>
          </template>
        </AppCallout>

        <FactList :facts="facts" layout="rows" />

        <section aria-labelledby="invoice-detail-items">
          <h3 id="invoice-detail-items" class="text-sm font-semibold text-ink">
            What it paid for <span class="font-normal text-ink-tertiary">· {{ bill.items.length }}</span>
          </h3>
          <p v-if="!bill.items.length" class="mt-2 text-sm text-ink-tertiary">No items on this invoice yet. Correct it to add them.</p>
          <ul v-else class="mt-2 divide-y divide-edge text-sm" data-test="invoice-detail-items">
            <li v-for="i in bill.items" :key="i.id" class="flex items-center justify-between gap-3 py-2">
              <RouterLink :to="`/shop/assets/${i.id}`" class="text-link hover:text-link-hover">
                <span class="font-mono text-xs">{{ i.displayNo }}</span> {{ i.name }}
              </RouterLink>
              <span class="text-ink-tertiary">{{ i.assetTypeName }}<template v-if="i.purchaseCost != null"> · {{ usd2(i.purchaseCost) }}</template></span>
            </li>
          </ul>
        </section>

        <section aria-labelledby="invoice-detail-paper">
          <h3 id="invoice-detail-paper" class="text-sm font-semibold text-ink">The paper</h3>
          <p v-if="papers.data.value && !papers.data.value.length" class="mt-2 text-sm text-ink-tertiary" data-test="invoice-paper-none">
            No paper filed yet.
          </p>
          <ul v-else-if="papers.data.value" class="mt-2 divide-y divide-edge text-sm" data-test="invoice-paper">
            <li v-for="d in papers.data.value" :key="d.id" class="flex items-center justify-between gap-2 py-2">
              <span class="text-ink-muted">Filed {{ formatDateTime(d.createdAt) }}</span>
              <BaseButton variant="link" @click="viewing = d">View</BaseButton>
            </li>
          </ul>
          <FileDropzone
            v-if="canManage"
            class="mt-3"
            :accept="uploadAccept"
            :busy="filePaper.isPending.value"
            busy-label="Uploading…"
            label="Drop the PDF or a photo of the invoice here"
            hint="Each file is kept as uploaded; a wrong one is answered by filing the right one."
            @files="onPaper"
          />
        </section>
      </div>
    </QueryState>

    <InvoiceDrawer v-if="correcting && bill" :open="true" :correcting="bill" @close="correcting = false" @saved="onCorrected" />
    <DocumentPreview
      :open="viewing !== null"
      label="Invoice"
      :doc="viewing"
      :download-path="viewing ? `/api/maintenance/inventory/purchases/${encodeURIComponent(purchaseId)}/documents/${viewing.id}/download` : null"
      @close="viewing = null"
    />

    <template v-if="canManage && bill && !bill.supersededBy" #footer>
      <div class="flex justify-end">
        <BaseButton variant="primary" data-test="invoice-correct" @click="correcting = true">Correct this invoice</BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
