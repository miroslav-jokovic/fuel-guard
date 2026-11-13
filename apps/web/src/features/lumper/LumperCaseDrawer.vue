<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  LUMPER_CASE_STATE_LABELS,
  LUMPER_CLOSE_REASONS,
  LUMPER_CLOSE_REASON_LABELS,
  type LumperCaseRow,
  type LumperCloseReason,
} from "@silvicom/shared";
import { AppBadge, AppButton, AppCallout, AppFormField, AppSelect, AppTextarea, FactList, type Fact } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import FileDropzone from "@/components/ui/FileDropzone.vue";
import { useToastStore } from "@/stores/toast";
import { LUMPER_STATE_TONE, lumperAmount, lumperPlace, mcleodDay, usd } from "./lumperRows";
import {
  LUMPER_FILE_ACCEPT,
  openRevisedRc,
  useCloseLumperCase,
  useFileRevisedRc,
  useRemoveRevisedRc,
  useReopenLumperCase,
} from "./useLumperCases";

/**
 * One lumper case (LUMPER-REVISED-RC-PLAN D-LRC2, D-LRC3, D-LRC10): what we paid and where, whether the
 * broker's revised rate confirmation is on file, and the three acts a person has — file the RC, take a
 * wrong paper off with a reason, close the case with a reason.
 *
 * A drawer over the list, because the list is where the work is: the next case is one click away.
 * The page holds which case is open; this component never fetches a case of its own, so what it shows
 * is always the row the list shows.
 */
const props = defineProps<{ lumperCase: LumperCaseRow | null }>();
const emit = defineEmits<{ close: [] }>();

const toast = useToastStore();
const fileRc = useFileRevisedRc();
const removeRc = useRemoveRevisedRc();
const closeCase = useCloseLumperCase();
const reopenCase = useReopenLumperCase();

const c = computed(() => props.lumperCase);
const amount = computed(() => (c.value ? lumperAmount(c.value) : null));

const facts = computed<Fact[]>(() => {
  const k = c.value;
  if (!k) return [];
  return [
    { label: "Broker", value: k.customerName ?? "—" },
    { label: "Dispatcher", value: k.dispatcherName ?? "Unassigned" },
    { label: "Delivered at", value: lumperPlace(k) },
    { label: "Delivered on", value: mcleodDay(k.deliveredAt) },
    { label: "Driver", value: k.driverCode ?? "—" },
    { label: "Paid", value: k.paidAmount > 0 ? usd(k.paidAmount) : "Not in payroll yet", numeric: k.paidAmount > 0 },
    { label: "Paid on", value: mcleodDay(k.paidAt) },
    { label: "EFS reference", value: k.references.join(", ") || "—" },
    { label: "Charge on the order", value: k.chargeAmount > 0 ? `${usd(k.chargeAmount)}${k.chargeDescriptions.length ? ` · ${k.chargeDescriptions.join(", ")}` : ""}` : "None keyed" },
    { label: "Invoice", value: k.invoiced ? `${k.lastInvoiceNo ?? "—"} on ${mcleodDay(k.lastInvoiceAt)}` : "Not invoiced yet" },
    { label: "Lumper on the invoice", value: k.invoiced ? usd(k.billedAmount) : "—", numeric: k.invoiced },
    ...(k.shortAmount > 0 ? [{ label: "Short", value: usd(k.shortAmount), numeric: true, tone: "text-danger-700" }] : []),
  ];
});

/** What this state asks of the person reading it, in one sentence. */
const next = computed<{ tone: "caution" | "danger" | "info" | "success"; text: string } | null>(() => {
  switch (c.value?.state) {
    case "waiting_for_rc":
      return { tone: "caution", text: "Ask the broker for the revised rate confirmation and file it here. Without it the broker may not pay this lumper." };
    case "rc_received":
      return { tone: "info", text: "The revised RC is on file. Billing can invoice the lumper." };
    case "billed_no_rc":
      return { tone: "danger", text: "The lumper is on the invoice but no revised RC is on file. The broker can still refuse it. Get the revised RC and file it here." };
    case "billed_without_lumper":
      return { tone: "danger", text: "The order was invoiced with no lumper on it. It needs a re-bill, or close the case with the reason it will not be billed." };
    case "billed_short":
      return { tone: "danger", text: "The invoice carries less than we paid. It needs a re-bill for the difference, or close the case with a reason." };
    case "billed_rc_on_file":
      return { tone: "success", text: "Invoiced in full with the revised RC on file. Nothing is owed on this case." };
    default:
      return null;
  }
});

// ── filing the revised RC ─────────────────────────────────────────────────────────────────────────
const uploadError = ref<string | null>(null);
async function onFiles(files: File[]): Promise<void> {
  const k = c.value;
  const file = files[0];
  if (!k || !file) return;
  uploadError.value = null;
  try {
    await fileRc.mutateAsync({ caseId: k.id, file });
    toast.success(`Revised RC filed on order ${k.orderId}`);
  } catch (e) {
    uploadError.value = e instanceof Error ? e.message : "The file did not finish uploading.";
  }
}

async function openFile(fileId: string): Promise<void> {
  try {
    await openRevisedRc(fileId);
  } catch (e) {
    toast.error("Could not open the file", e instanceof Error ? e.message : undefined);
  }
}

// ── taking a wrong paper off ──────────────────────────────────────────────────────────────────────
const removing = ref<string | null>(null);
const removeReason = ref("");
async function confirmRemove(): Promise<void> {
  if (!removing.value || removeReason.value.trim().length < 3) return;
  try {
    await removeRc.mutateAsync({ fileId: removing.value, reason: removeReason.value.trim() });
    removing.value = null;
    removeReason.value = "";
  } catch (e) {
    toast.error("Could not remove the file", e instanceof Error ? e.message : undefined);
  }
}

// ── closing a case that will not be billed ────────────────────────────────────────────────────────
const closing = ref(false);
const closeReason = ref<LumperCloseReason | "">("");
const closeNote = ref("");
const reasonOptions = LUMPER_CLOSE_REASONS.map((r) => ({ value: r, label: LUMPER_CLOSE_REASON_LABELS[r] }));
async function confirmClose(): Promise<void> {
  const k = c.value;
  if (!k || !closeReason.value) return;
  try {
    await closeCase.mutateAsync({ caseId: k.id, reason: closeReason.value, note: closeNote.value.trim() || null });
    toast.success(`Case for order ${k.orderId} closed`);
    emit("close");
  } catch (e) {
    toast.error("Could not close the case", e instanceof Error ? e.message : undefined);
  }
}
async function reopen(): Promise<void> {
  const k = c.value;
  if (!k) return;
  try {
    await reopenCase.mutateAsync({ caseId: k.id });
    toast.success(`Case for order ${k.orderId} reopened`);
  } catch (e) {
    toast.error("Could not reopen the case", e instanceof Error ? e.message : undefined);
  }
}

// A different case is a fresh drawer: no half-typed reason carried from the last one.
watch(
  () => c.value?.id,
  () => {
    uploadError.value = null;
    removing.value = null;
    removeReason.value = "";
    closing.value = false;
    closeReason.value = "";
    closeNote.value = "";
  },
);
</script>

<template>
  <SlideOver :open="c !== null" :title="c ? `Lumper on order ${c.orderId}` : 'Lumper'" :description="amount?.note ? `${amount.text} ${amount.note}` : amount?.text" @close="emit('close')">
    <div v-if="c" class="space-y-6">
      <div class="space-y-3">
        <AppBadge :tone="LUMPER_STATE_TONE[c.state]" data-test="case-state">{{ LUMPER_CASE_STATE_LABELS[c.state] }}</AppBadge>
        <AppCallout v-if="next" :tone="next.tone" data-test="case-next">{{ next.text }}</AppCallout>
        <p v-if="c.closedAt && c.closeReason" class="text-sm text-ink-secondary" data-test="case-closed">
          Closed {{ mcleodDay(c.closedAt) }}{{ c.closedByName ? ` by ${c.closedByName}` : "" }}: {{ LUMPER_CLOSE_REASON_LABELS[c.closeReason] }}.
          <span v-if="c.closeNote">{{ c.closeNote }}</span>
        </p>
      </div>

      <section aria-labelledby="lumper-facts-heading" class="space-y-2">
        <h3 id="lumper-facts-heading" class="text-sm font-semibold text-ink">Where and what we paid</h3>
        <FactList :facts="facts" layout="rows" />
      </section>

      <section aria-labelledby="lumper-rc-heading" class="space-y-3">
        <h3 id="lumper-rc-heading" class="text-sm font-semibold text-ink">Revised rate confirmation</h3>
        <p v-if="c.files.length === 0" class="text-sm text-ink-muted" data-test="rc-none">Not on file.</p>
        <ul v-else class="space-y-2">
          <li v-for="f in c.files" :key="f.id" class="rounded-surface px-3 py-2 ring-1 ring-inset ring-edge" data-test="rc-file">
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <p class="truncate text-sm font-medium text-ink">{{ f.fileName }}</p>
                <p class="text-xs text-ink-muted">Filed {{ mcleodDay(f.uploadedAt) }}{{ f.uploadedByName ? ` by ${f.uploadedByName}` : "" }}</p>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <AppButton size="sm" @click="openFile(f.id)">Open</AppButton>
                <AppButton size="sm" :disabled="removeRc.isPending.value" @click="((removing = f.id), (removeReason = ''))">Remove</AppButton>
              </div>
            </div>
            <div v-if="removing === f.id" class="mt-3 space-y-2">
              <AppFormField v-slot="{ id }" label="Why is this not the revised RC?" required>
                <AppTextarea :id="id" v-model="removeReason" rows="2" data-test="remove-reason" />
              </AppFormField>
              <p class="text-xs text-ink-muted">The file is kept with your reason and stops counting as the revised RC.</p>
              <div class="flex justify-end gap-2">
                <AppButton size="sm" @click="removing = null">Keep it</AppButton>
                <AppButton size="sm" variant="danger" :disabled="removeReason.trim().length < 3 || removeRc.isPending.value" data-test="remove-confirm" @click="confirmRemove">Remove</AppButton>
              </div>
            </div>
          </li>
        </ul>
        <FileDropzone
          :accept="LUMPER_FILE_ACCEPT"
          :busy="fileRc.isPending.value"
          busy-label="Filing…"
          label="Drop the revised RC here"
          hint="PDF, JPEG or PNG, up to 25 MB. Save the broker's email as a PDF first."
          @files="onFiles"
        />
        <p v-if="uploadError" class="text-sm text-danger-600" role="alert" data-test="upload-error">{{ uploadError }}</p>
      </section>

      <section v-if="closing && !c.closedAt" aria-labelledby="lumper-close-heading" class="space-y-3">
        <h3 id="lumper-close-heading" class="text-sm font-semibold text-ink">Close without billing</h3>
        <AppFormField v-slot="{ id }" label="Reason" required>
          <AppSelect :id="id" v-model="closeReason" :options="reasonOptions" placeholder="Choose a reason…" data-test="close-reason" />
        </AppFormField>
        <AppFormField v-slot="{ id }" label="Note">
          <AppTextarea :id="id" v-model="closeNote" rows="2" />
        </AppFormField>
        <p class="text-xs text-ink-muted">Reminders for this case stop. Your name and the reason are kept on the case and on the Audit page.</p>
      </section>
    </div>

    <template #footer>
      <div v-if="c" class="flex items-center justify-end gap-3">
        <AppButton v-if="c.closedAt" :disabled="reopenCase.isPending.value" data-test="reopen" @click="reopen">Reopen</AppButton>
        <template v-else-if="closing">
          <AppButton @click="closing = false">Cancel</AppButton>
          <AppButton variant="primary" :disabled="!closeReason || closeCase.isPending.value" data-test="close-confirm" @click="confirmClose">
            {{ closeCase.isPending.value ? "Closing…" : "Close case" }}
          </AppButton>
        </template>
        <AppButton v-else-if="c.open" data-test="close-start" @click="closing = true">Close without billing</AppButton>
        <AppButton @click="emit('close')">Done</AppButton>
      </div>
    </template>
  </SlideOver>
</template>
