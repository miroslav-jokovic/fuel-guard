<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { TOLL_PROVIDER_LABEL, type TollStatementDto } from "@silvicom/shared";
import { AppBadge, AppButton, AppCallout, AppFormField, AppTextarea, FactList, type Fact } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import { formatDateTime } from "@/lib/format";
import { useOrgTimezone } from "@/composables/useOrgTimezone";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { openTollStatement, useRemoveTollStatement } from "./useTollStatements";
import { STATEMENT_STATUS_LABEL, STATEMENT_STATUS_TONE, fileKind, statementPeriod, statementStatus } from "./tollStatementRows";

/**
 * One toll statement (TOLLS-PER-TRUCK-PLAN.md TL4a): what was uploaded, by whom, whether it has been
 * read, the file itself, and the one act on it — taking a wrong file off the list with a reason.
 *
 * A drawer over the list, as a lumper case is: the page holds which statement is open, so this shows
 * exactly the row the list shows. A removed statement stays openable, crossed off with its reason,
 * because "where did that week's file go" is answered here.
 */
const props = defineProps<{ statement: TollStatementDto | null }>();
const emit = defineEmits<{ close: [] }>();

const session = useSessionStore();
const canManage = computed(() => session.can("accounting"));
const toast = useToastStore();
const remove = useRemoveTollStatement();
const { zone } = useOrgTimezone();
const at = (iso: string) => formatDateTime(iso, "—", zone.value);

const s = computed(() => props.statement);
const status = computed(() => (s.value ? statementStatus(s.value) : null));

const facts = computed<Fact[]>(() => {
  const x = s.value;
  if (!x) return [];
  return [
    { label: "Provider", value: TOLL_PROVIDER_LABEL[x.provider] },
    { label: "File", value: fileKind(x) },
    { label: "Uploaded", value: `${at(x.uploadedAt)}${x.uploadedByName ? ` by ${x.uploadedByName}` : ""}` },
    { label: "Period", value: statementPeriod(x) ?? "Not read yet" },
    {
      label: "Statement total",
      value: x.printedTotal == null ? "Not read yet" : x.printedTotal.toLocaleString(undefined, { style: "currency", currency: "USD" }),
      numeric: x.printedTotal != null,
    },
  ];
});

const removing = ref(false);
const reason = ref("");
watch(
  () => s.value?.id,
  () => {
    removing.value = false;
    reason.value = "";
  },
);

async function open(): Promise<void> {
  if (!s.value) return;
  try {
    await openTollStatement(s.value.id);
  } catch (e) {
    toast.error("Could not open the file", e instanceof Error ? e.message : undefined);
  }
}

async function confirmRemove(): Promise<void> {
  const x = s.value;
  if (!x || reason.value.trim().length < 3) return;
  try {
    await remove.mutateAsync({ id: x.id, reason: reason.value.trim() });
    toast.success(`${x.fileName} removed from the list`);
    removing.value = false;
  } catch (e) {
    toast.error("Could not remove the statement", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <SlideOver :open="s !== null" :title="s?.fileName ?? 'Toll statement'" :description="s ? TOLL_PROVIDER_LABEL[s.provider] : undefined" @close="emit('close')">
    <div v-if="s && status" class="space-y-6">
      <div class="space-y-3">
        <AppBadge :tone="STATEMENT_STATUS_TONE[status]" data-test="statement-status">{{ STATEMENT_STATUS_LABEL[status] }}</AppBadge>
        <AppCallout v-if="status === 'unread'" tone="info" data-test="statement-unread">
          The file is kept as uploaded. Its tolls are not counted yet; they are read from this file once the {{ TOLL_PROVIDER_LABEL[s.provider] }} reader is built.
        </AppCallout>
        <p v-if="s.removedAt" class="text-sm text-ink-secondary" data-test="statement-removed">
          Removed {{ at(s.removedAt) }}{{ s.removedByName ? ` by ${s.removedByName}` : "" }}: {{ s.removeReason }}. Its tolls do not count.
        </p>
      </div>

      <section aria-labelledby="statement-facts-heading" class="space-y-2">
        <h3 id="statement-facts-heading" class="text-sm font-semibold text-ink">The statement</h3>
        <FactList :facts="facts" layout="rows" />
      </section>

      <div v-if="removing" class="space-y-2" data-test="statement-remove-form">
        <AppFormField v-slot="{ id }" label="What is wrong with this file?" required>
          <AppTextarea :id="id" v-model="reason" rows="2" maxlength="300" data-test="statement-remove-reason" />
        </AppFormField>
        <p class="text-xs text-ink-muted">The file stays listed with your reason and its tolls stop counting. Upload the right file separately.</p>
        <div class="flex justify-end gap-2">
          <AppButton size="sm" @click="removing = false">Keep it</AppButton>
          <AppButton size="sm" variant="danger" :disabled="reason.trim().length < 3 || remove.isPending.value" data-test="statement-remove-confirm" @click="confirmRemove">
            Remove
          </AppButton>
        </div>
      </div>
    </div>
    <template #footer>
      <AppButton v-if="s && canManage && !s.removedAt && !removing" variant="ghost" data-test="statement-remove" @click="removing = true">Remove from the list…</AppButton>
      <AppButton variant="primary" data-test="statement-open" @click="open">Open file</AppButton>
    </template>
  </SlideOver>
</template>
