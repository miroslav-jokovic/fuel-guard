<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import {
  DQ_KIND_LABELS,
  PAPER_FILE_CERTIFICATION_KINDS,
  PAPER_FILE_ELSEWHERE,
  PAPER_FILE_KINDS,
  type PaperIntakeItemDto,
} from "@silvicom/shared";
import { AppCallout, AppButton as BaseButton, AppCombobox as ComboSelect, AppDateField, AppFormField as FormField } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import { useDriversQuery } from "@/composables/useDrivers";
import { useComplianceOverviewQuery } from "@/composables/useCompliance";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { pagesLabel, useDiscardPaper, useFilePaper } from "./usePaperIntake";

/**
 * One proposed paper, checked and filed (DRIVER-PAPER-INTAKE-PLAN PI5).
 *
 * The form opens on what the reader proposed — whose, which paper, its dates — and the person corrects
 * whatever is wrong against the pages (View). Their answer travels in the FILE request; the row keeps
 * the proposal, so the API can record whether it was changed (D-UF8, D-PI3).
 *
 * The driver's file's outstanding items are listed beside the form ("still needed"), so a folder that
 * lacks its road test is seen to lack it while the folder is in front of the person.
 *
 * Kinds are the ones intake may file (`PAPER_FILE_KINDS`). A proposal intake must not file — a PSP report,
 * which has its own door — says where to file it instead, rather than offering a form that would be refused.
 * A restricted paper (a drug or alcohol test) is offered only to a role that may read it, which is the
 * rule the API applies.
 */
const props = defineProps<{ open: boolean; item: PaperIntakeItemDto | null }>();
const emit = defineEmits<{ close: []; view: [item: PaperIntakeItemDto] }>();

const session = useSessionStore();
const toast = useToastStore();
const drivers = useDriversQuery();
const overview = useComplianceOverviewQuery();
const filePaper = useFilePaper();
const discardPaper = useDiscardPaper();

const form = reactive({ driverId: "", kind: "", date: "", expiresOn: "" });
watch(
  () => props.item,
  (i) => {
    Object.assign(form, {
      driverId: i?.driverId ?? "",
      kind: i?.kind && (PAPER_FILE_KINDS as readonly string[]).includes(i.kind) ? i.kind : "",
      date: i?.issuedOn ?? "",
      expiresOn: i?.expiresOn ?? "",
    });
  },
  { immediate: true },
);

const label = (k: string) => (k === "other" ? "Other paper (keep it, proves nothing)" : (DQ_KIND_LABELS[k] ?? k));
const driverOptions = computed(() => (drivers.data.value ?? []).map((d) => ({ value: d.id, label: d.full_name })));
const kindOptions = computed(() =>
  PAPER_FILE_KINDS.filter((k) => session.canReadKind(k)).map((k) => ({ value: k, label: label(k) })),
);
const elsewhere = computed(() => (props.item?.kind ? (PAPER_FILE_ELSEWHERE[props.item.kind] ?? null) : null));
const isCertification = computed(() => (PAPER_FILE_CERTIFICATION_KINDS as readonly string[]).includes(form.kind));
const needsDate = computed(() => form.kind !== "" && form.kind !== "other");
const ready = computed(
  () => !!form.driverId && !!form.kind && (!needsDate.value || (isCertification.value ? !!(form.expiresOn || form.date) : !!form.date)),
);

/** What this driver's file still lacks, from the same rollup the Drivers File column reads. */
const stillNeeded = computed(() => {
  const row = (overview.data.value?.drivers ?? []).find((d) => d.driver_id === form.driverId);
  return (row?.attention ?? []).filter((a) => a.state === "missing" || a.state === "expired").map((a) => a.label);
});

async function file(): Promise<void> {
  const item = props.item;
  if (!item || !ready.value) return;
  try {
    const out = await filePaper.mutateAsync({
      itemId: item.id,
      body: { driverId: form.driverId, kind: form.kind, date: needsDate.value ? form.date || null : null, expiresOn: isCertification.value ? form.expiresOn || null : null },
    });
    if (out.status === "duplicate") toast.success("Already in the file", "This exact paper was filed before; nothing was added.");
    else toast.success(`${label(form.kind)} filed`);
    emit("close");
  } catch (e) {
    toast.error("Could not file that paper", e instanceof Error ? e.message : undefined);
  }
}

async function setAside(): Promise<void> {
  if (!props.item) return;
  try {
    await discardPaper.mutateAsync({ itemId: props.item.id, reason: "not_dq_paper" });
    toast.success("Set aside", "It stays in the upload and is not filed.");
    emit("close");
  } catch (e) {
    toast.error("Could not set that paper aside", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <SlideOver :open="open" size="lg" title="Check and file" @close="emit('close')">
    <div v-if="item" class="space-y-5">
      <div class="flex items-center justify-between gap-3">
        <p class="text-sm text-ink-secondary">
          {{ pagesLabel(item.pages) }}<template v-if="item.title"> · “{{ item.title }}”</template>
        </p>
        <BaseButton size="sm" @click="emit('view', item)">View pages</BaseButton>
      </div>

      <AppCallout v-if="elsewhere" tone="info">{{ elsewhere }}</AppCallout>
      <AppCallout v-if="item.unread" tone="caution">The reader could not read these pages. Look at them and say what they are.</AppCallout>

      <FormField v-slot="{ id }" label="Driver">
        <ComboSelect :id="id" v-model="form.driverId" :options="driverOptions" placeholder="Choose the driver" />
      </FormField>
      <p v-if="stillNeeded.length" class="-mt-3 text-xs text-ink-muted" data-testid="still-needed">
        Still needed in this driver's file: {{ stillNeeded.join(", ") }}.
      </p>

      <FormField v-slot="{ id }" label="Paper">
        <ComboSelect :id="id" v-model="form.kind" :options="kindOptions" placeholder="Which paper is this?" />
      </FormField>

      <div v-if="needsDate" class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField v-slot="{ id }" :label="isCertification ? 'Issued' : 'Date'" :hint="isCertification ? undefined : 'The day it was signed, or the day the test or review happened.'">
          <AppDateField :id="id" v-model="form.date" />
        </FormField>
        <FormField v-if="isCertification" v-slot="{ id }" label="Expires">
          <AppDateField :id="id" v-model="form.expiresOn" />
        </FormField>
      </div>
    </div>

    <template #footer>
      <div class="flex items-center justify-between gap-3">
        <BaseButton variant="ghost" :disabled="discardPaper.isPending.value || filePaper.isPending.value" @click="setAside">Not a driver-file paper</BaseButton>
        <div class="flex gap-3">
          <BaseButton variant="ghost" @click="emit('close')">Cancel</BaseButton>
          <BaseButton variant="primary" :disabled="!ready || filePaper.isPending.value" @click="file">
            {{ filePaper.isPending.value ? "Filing…" : "File it" }}
          </BaseButton>
        </div>
      </div>
    </template>
  </SlideOver>
</template>
