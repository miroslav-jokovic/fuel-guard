<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  MEDSTOP_CLOSE_LABEL,
  MEDSTOP_CLOSE_NOTE_MAX_LENGTH,
  formatDisplayWallTime,
  type MedstopCloseStatus,
  type MedstopClosePreview,
  type MedstopClosed,
} from "@silvicom/shared";
import { AppButton as BaseButton, AppCallout, AppFormField as FormField, AppInput as BaseInput, FactList, type Fact } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import { useToastStore } from "@/stores/toast";
import { useCloseOrder, useClosePreview } from "@/composables/useMedstopOrder";

/**
 * Closing an open Med-Stop order from the hiring step (MEDSTOP-PLAN.md §7A.21, MSO2, D-MSO3): "Didn't go —
 * mark no-show" or "Cancel order". Reviewed like the order: on opening, the api reads the order and its
 * close-out form from Med-Stop and shows what will be sent; nothing is written until **Close the order**.
 * A changed reason clears the review. Once closed, **Order again** hands the page the closed order's
 * person, ZIP and site, and the page opens the order drawer filled from them — a drawer never opens
 * another drawer.
 */
const props = defineProps<{ open: boolean; request: { requestId: string; status: MedstopCloseStatus } | null }>();
const emit = defineEmits<{ close: []; closed: []; orderAgain: [reorder: NonNullable<MedstopClosed["reorder"]>] }>();

const toast = useToastStore();
const preview = useClosePreview();
const send = useCloseOrder();
const note = ref("");
const reviewed = ref<MedstopClosePreview | null>(null);
const done = ref<MedstopClosed | null>(null);
const failed = ref<string | null>(null);

async function review(): Promise<void> {
  if (!props.request) return;
  reviewed.value = null;
  failed.value = null;
  try {
    reviewed.value = await preview.mutateAsync({ requestId: props.request.requestId, input: input.value });
  } catch (e) {
    failed.value = e instanceof Error ? e.message : "Could not read the order in Med-Stop.";
  }
}

const input = computed(() => ({ status: props.request?.status ?? "NO SHOW", ...(note.value.trim() ? { note: note.value.trim() } : {}) }));
watch(
  () => [props.open, props.request] as const,
  ([open]) => {
    if (!open) return;
    note.value = "";
    done.value = null;
    void review();
  },
  { immediate: true },
);
// A review describes one exact close; a changed reason no longer matches it.
watch(note, () => (reviewed.value = null));

async function confirm(): Promise<void> {
  if (!props.request || !reviewed.value) return;
  try {
    done.value = await send.mutateAsync({ requestId: props.request.requestId, input: input.value });
    toast.success(done.value.status === "NO SHOW" ? "Marked as a no-show in Med-Stop" : "Order cancelled in Med-Stop", "You can order the test again now.");
    emit("closed");
  } catch (e) {
    toast.error("The order was not closed", e instanceof Error ? e.message : undefined);
  }
}

const title = computed(() => (props.request ? MEDSTOP_CLOSE_LABEL[props.request.status] : ""));
const facts = computed((): Fact[] => {
  const r = reviewed.value;
  if (!r) return [];
  return [
    { label: "Applicant", value: r.person },
    { label: "Order", value: [r.site, r.goBy ? `go by ${formatDisplayWallTime(r.goBy)}` : null].filter(Boolean).join(" · ") || r.requestId },
    { label: "Med-Stop records", value: r.status === "NO SHOW" ? "No show" : "Request canceled" },
    { label: "Comment sent", value: r.comment },
  ];
});
</script>

<template>
  <SlideOver :open="open" title="Close a Med-Stop order" :description="title" @close="emit('close')">
    <div class="space-y-5 text-sm">
      <template v-if="done">
        <AppCallout tone="success">
          Med-Stop now has this order as {{ done.status === "NO SHOW" ? "a no-show" : "cancelled" }}. Its appointment is no longer offered for texting.
        </AppCallout>
      </template>
      <template v-else>
        <p class="text-ink-secondary">
          This closes the order in Med-Stop, once. Med-Stop is asked first, so an order already collected or closed is not touched.
        </p>
        <AppCallout v-if="failed" tone="caution">{{ failed }}</AppCallout>
        <p v-else-if="!reviewed" class="text-ink-muted">Reading the order in Med-Stop…</p>
        <FormField v-slot="{ id }" label="Reason, for Med-Stop's record" hint="Optional. Added after the fixed words below.">
          <BaseInput :id="id" v-model="note" :maxlength="MEDSTOP_CLOSE_NOTE_MAX_LENGTH" placeholder="Optional" />
        </FormField>
        <section v-if="reviewed" class="space-y-2 rounded-surface bg-surface-muted p-4" aria-label="What Med-Stop will receive">
          <h3 class="text-sm font-semibold text-ink">Check before closing</h3>
          <FactList :facts="facts" layout="rows" />
        </section>
      </template>
    </div>
    <template #footer>
      <div class="flex items-center justify-end gap-3">
        <template v-if="done">
          <BaseButton @click="emit('close')">Done</BaseButton>
          <BaseButton v-if="done.reorder" variant="primary" @click="emit('orderAgain', done.reorder)">Order again</BaseButton>
        </template>
        <template v-else>
          <BaseButton :disabled="send.isPending.value" @click="emit('close')">Keep the order</BaseButton>
          <BaseButton v-if="!reviewed" :disabled="preview.isPending.value" @click="review">
            {{ preview.isPending.value ? "Checking…" : "Check again" }}
          </BaseButton>
          <BaseButton v-else variant="danger" :disabled="send.isPending.value" @click="confirm">
            {{ send.isPending.value ? "Closing…" : "Close the order" }}
          </BaseButton>
        </template>
      </div>
    </template>
  </SlideOver>
</template>
