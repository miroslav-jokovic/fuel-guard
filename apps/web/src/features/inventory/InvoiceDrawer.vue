<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import {
  DOCUMENT_CONTENT_TYPES,
  acceptFor,
  equipmentPurchaseInputSchema,
  usd2,
  type EquipmentPurchaseDetail,
  type EquipmentPurchaseInput,
} from "@silvicom/shared";
import {
  AppButton as BaseButton,
  AppCombobox as ComboSelect,
  AppDateField,
  AppFormField as FormField,
  AppInput as BaseInput,
  AppSegmentedControl,
  AppTextarea as BaseTextarea,
} from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import FileDropzone from "@/components/ui/FileDropzone.vue";
import { useToastStore } from "@/stores/toast";
import { useAssetsQuery } from "./useAssets";
import { useFleetpalOrdersQuery, useRecordPurchase } from "./usePurchases";

/**
 * Add an equipment invoice, or correct one (M10b, §7a.4; 0530).
 *
 * ── WHAT IT ASKS ──────────────────────────────────────────────────────────────────────────────
 * Who sent it, its number, date and total as printed, the paper, and which items it paid for — a box
 * of ten tablets is one invoice with ten items. Something FleetPal bought (Q-MX10: straps and chains)
 * links FleetPal's purchase order instead of a retyped copy of FleetPal's bill.
 *
 * ── A CORRECTION IS A NEW INVOICE ─────────────────────────────────────────────────────────────
 * `correcting` opens the form filled from the bill being corrected, and the save records a new one
 * that replaces it (`supersedes`); the old one stays on record (0530). The item list sent is the whole
 * set — an item taken off here is taken off the bill.
 *
 * ── THE ID IS MINTED ONCE PER OPENING (D-INV27) ───────────────────────────────────────────────
 * A save that timed out and is pressed again records the same invoice, not a second one refused as a
 * duplicate after the first had landed. The paper is filed against that id after the bill is saved.
 */
const props = defineProps<{ open: boolean; correcting?: EquipmentPurchaseDetail | null }>();
const emit = defineEmits<{ close: []; saved: [purchase: EquipmentPurchaseDetail] }>();

type PickedItem = { id: string; displayNo: string; name: string };

const toast = useToastStore();
const record = useRecordPurchase();

const billId = ref("");
const form = reactive({
  vendor: "",
  invoiceNumber: "",
  invoiceDate: "",
  total: "",
  notes: "",
  bought: "elsewhere" as "elsewhere" | "fleetpal",
  fleetpalOrderId: "",
});
const items = ref<PickedItem[]>([]);
const paper = ref<File | null>(null);
const errors = ref<Record<string, string>>({});

function reset() {
  const c = props.correcting;
  billId.value = crypto.randomUUID();
  form.vendor = c?.vendor ?? "";
  form.invoiceNumber = c?.invoiceNumber ?? "";
  form.invoiceDate = c?.invoiceDate ?? "";
  form.total = c ? String(c.total) : "";
  form.notes = c?.notes ?? "";
  form.bought = c?.fleetpalOrder ? "fleetpal" : "elsewhere";
  form.fleetpalOrderId = c?.fleetpalOrder?.id ?? "";
  items.value = (c?.items ?? []).map((i) => ({ id: i.id, displayNo: i.displayNo, name: i.name }));
  paper.value = null;
  errors.value = {};
}
watch(() => props.open, (open) => open && reset(), { immediate: true });
// A field's refusal goes as soon as the field is changed, not at the next save: a red line under a
// value somebody has just corrected reads as the correction being wrong.
for (const key of ["vendor", "invoiceNumber", "invoiceDate", "total"] as const) {
  watch(() => form[key], () => delete errors.value[key]);
}
watch(() => form.fleetpalOrderId, () => delete errors.value.fleetpalPurchaseOrderId);

const BOUGHT = [
  { value: "elsewhere", label: "Bought outside FleetPal" },
  { value: "fleetpal", label: "Through FleetPal" },
];

// ── the items: a server search, because the shop's list is paged (`EquipmentInventoryPanel.vue`) ──
const itemSearch = ref("");
const picked = ref("");
/** Remounts the search after a pick, so its box is empty again rather than still showing the item added. */
const pickKey = ref(0);
const assets = useAssetsQuery(computed(() => ({ search: itemSearch.value.trim() || undefined, page: 1 })));
const itemOptions = computed(() => {
  const chosen = new Set(items.value.map((i) => i.id));
  return (assets.data.value?.assets ?? [])
    .filter((a) => !chosen.has(a.id))
    .map((a) => ({
      value: a.id,
      // Said before it is refused (IV029): an item already on another invoice is corrected from that one.
      label: `${a.displayNo} · ${a.name}${a.purchaseId && a.purchaseId !== props.correcting?.id ? " — on another invoice" : ""}`,
    }));
});
watch(picked, (id) => {
  if (!id) return;
  const a = assets.data.value?.assets.find((x) => x.id === id);
  if (a) items.value = [...items.value, { id: a.id, displayNo: a.displayNo, name: a.name }];
  picked.value = "";
  itemSearch.value = "";
  pickKey.value += 1;
});
const removeItem = (id: string) => (items.value = items.value.filter((i) => i.id !== id));

// ── FleetPal's order ──
const orderSearch = ref("");
const orders = useFleetpalOrdersQuery(orderSearch, computed(() => props.open && form.bought === "fleetpal"));
const orderOptions = computed(() => {
  const list = [...(orders.data.value ?? [])];
  const linked = props.correcting?.fleetpalOrder;
  if (linked && !list.some((o) => o.id === linked.id)) list.unshift(linked);
  return list.map((o) => ({
    value: o.id,
    label: [o.referenceNumber ?? "No reference", o.description, o.total == null ? null : usd2(o.total)].filter(Boolean).join(" · "),
  }));
});

const uploadAccept = acceptFor(DOCUMENT_CONTENT_TYPES);

async function save() {
  const total = Number(form.total.replace(/[$,\s]/g, ""));
  const candidate = {
    id: billId.value,
    vendor: form.vendor,
    invoiceNumber: form.invoiceNumber,
    invoiceDate: form.invoiceDate,
    total: form.total.trim() === "" || Number.isNaN(total) ? undefined : total,
    notes: form.notes.trim() || null,
    fleetpalPurchaseOrderId: form.bought === "fleetpal" ? form.fleetpalOrderId || null : null,
    supersedes: props.correcting?.id ?? null,
    assetIds: items.value.map((i) => i.id),
  };
  const parsed = equipmentPurchaseInputSchema.safeParse(candidate);
  const next: Record<string, string> = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      next[key] ??= key === "total" ? "The total as printed, in dollars and cents." : key === "invoiceDate" ? "The date on the invoice." : issue.message;
    }
  }
  if (form.bought === "fleetpal" && !form.fleetpalOrderId) next.fleetpalPurchaseOrderId = "Choose FleetPal's purchase order.";
  errors.value = next;
  if (!parsed.success || Object.keys(next).length) return;
  try {
    const saved = await record.mutateAsync({ bill: parsed.data as EquipmentPurchaseInput, paper: paper.value });
    toast.success(props.correcting ? "Invoice corrected" : "Invoice added", `${saved.vendor} ${saved.invoiceNumber}`);
    emit("saved", saved);
    emit("close");
  } catch (e) {
    const err = e as Error & { code?: string; saved?: EquipmentPurchaseDetail };
    if (err.code === "paper_failed" && err.saved) {
      toast.error("The paper was not filed", err.message);
      emit("saved", err.saved);
      emit("close");
      return;
    }
    toast.error(props.correcting ? "Could not correct the invoice" : "Could not add the invoice", err.message);
  }
}
</script>

<template>
  <SlideOver
    :open="open"
    :title="correcting ? 'Correct the invoice' : 'Add invoice'"
    :description="correcting ? 'Saves a corrected copy. The one it replaces stays on record.' : 'What the shop paid for its tablets and truck gear.'"
    size="lg"
    @close="emit('close')"
  >
    <form id="invoice-form" class="space-y-6" @submit.prevent="save">
      <section aria-labelledby="invoice-bill" class="space-y-4">
        <h3 id="invoice-bill" class="text-sm font-semibold text-ink">The invoice</h3>
        <AppSegmentedControl v-model="form.bought" :options="BOUGHT" label="Where it was bought" data-test="invoice-bought" />
        <FormField v-if="form.bought === 'fleetpal'" v-slot="{ id }" label="FleetPal purchase order" :error="errors.fleetpalPurchaseOrderId">
          <ComboSelect
            :id="id"
            v-model="form.fleetpalOrderId"
            :options="orderOptions"
            server-filtered
            :loading="orders.isFetching.value"
            placeholder="Search its reference or what it was for"
            empty-text="No FleetPal purchase order matches. Cancelled orders are not offered."
            data-test="invoice-fleetpal-order"
            @update:query="orderSearch = $event"
          />
        </FormField>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField v-slot="{ id }" label="Vendor" :error="errors.vendor">
            <BaseInput :id="id" v-model="form.vendor" :invalid="!!errors.vendor" placeholder="AT&T Business" data-test="invoice-vendor" />
          </FormField>
          <FormField v-slot="{ id }" label="Invoice number" :error="errors.invoiceNumber">
            <BaseInput :id="id" v-model="form.invoiceNumber" :invalid="!!errors.invoiceNumber" data-test="invoice-number" />
          </FormField>
          <FormField v-slot="{ id }" label="Invoice date" :error="errors.invoiceDate">
            <AppDateField :id="id" v-model="form.invoiceDate" data-test="invoice-date" />
          </FormField>
          <FormField v-slot="{ id }" label="Total" hint="As printed, tax and shipping included." :error="errors.total">
            <BaseInput :id="id" v-model="form.total" :invalid="!!errors.total" inputmode="decimal" placeholder="0.00" data-test="invoice-total" />
          </FormField>
        </div>
      </section>

      <section aria-labelledby="invoice-items" class="space-y-3">
        <h3 id="invoice-items" class="text-sm font-semibold text-ink">What it paid for</h3>
        <FormField v-slot="{ id }" label="Add an item" hint="Its number, serial or IMEI. Add the items first under Inventory." :error="errors.assetIds">
          <ComboSelect
            :id="id"
            :key="pickKey"
            v-model="picked"
            :options="itemOptions"
            server-filtered
            :loading="assets.isFetching.value"
            placeholder="A-0412, a serial, the last digits of an IMEI"
            empty-text="No item matches."
            data-test="invoice-item-search"
            @update:query="itemSearch = $event"
          />
        </FormField>
        <p v-if="!items.length" class="text-sm text-ink-tertiary" data-test="invoice-items-none">No items yet — an invoice can be saved first and its items added by correcting it.</p>
        <ul v-else class="divide-y divide-edge rounded-control border border-edge text-sm" data-test="invoice-items">
          <li v-for="i in items" :key="i.id" class="flex items-center justify-between gap-3 px-3 py-1">
            <span><span class="font-mono text-xs text-ink">{{ i.displayNo }}</span> <span class="text-ink-secondary">{{ i.name }}</span></span>
            <BaseButton variant="ghost" size="sm" :aria-label="`Take ${i.displayNo} off the invoice`" @click="removeItem(i.id)">Remove</BaseButton>
          </li>
        </ul>
      </section>

      <section aria-labelledby="invoice-paper" class="space-y-3">
        <h3 id="invoice-paper" class="text-sm font-semibold text-ink">The paper</h3>
        <p v-if="correcting?.paperCount" class="text-sm text-ink-muted">Its paper stays filed on the invoice it replaces. Add a file only if the corrected one came on new paper.</p>
        <FileDropzone
          :accept="uploadAccept"
          :busy="record.isPending.value"
          busy-label="Saving…"
          :label="paper ? paper.name : 'Drop the PDF or a photo of the invoice here'"
          hint="Optional. PDF or photo."
          @files="paper = $event[0] ?? null"
        />
      </section>

      <FormField v-slot="{ id }" label="Notes">
        <BaseTextarea :id="id" v-model="form.notes" :rows="2" />
      </FormField>
    </form>
    <template #footer>
      <div class="flex flex-wrap items-center justify-end gap-3">
        <BaseButton variant="ghost" :disabled="record.isPending.value" @click="emit('close')">Cancel</BaseButton>
        <BaseButton form="invoice-form" type="submit" variant="primary" :disabled="record.isPending.value" data-test="invoice-save">
          {{ record.isPending.value ? "Saving…" : correcting ? "Save the correction" : "Save invoice" }}
        </BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
