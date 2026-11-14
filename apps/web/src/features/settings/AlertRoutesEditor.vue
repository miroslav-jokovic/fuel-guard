<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { alertRoutesProblem, type AlertKey } from "@silvicom/shared";
import { AppButton as BaseButton, AppCard as BaseCard, AppSelect, AppSwitch as BaseSwitch, DataTable, useConfirm, type DataTableColumn } from "@silvicom/ui";
import { useToastStore } from "@/stores/toast";
import { addablePeople, editedChannels, personRow, recipientRows, routesChanged, toRoutes, type EditedChannel, type RecipientRow, type RoutingAlert, type RoutingMember } from "./alertRoutingForm";
import { useResetAlertRoutes, useSaveAlertRoutes } from "./useAlertRouting";

/**
 * One alert's switches: who is told, by dashboard and by email (HOME-TIME-PLAN D-HT15, HT5).
 *
 * The rows are local until Save, and the whole set goes in one request — a half-saved matrix would be an
 * alert routed in a way nobody chose. Save is refused HERE by the API's own rule (`alertRoutesProblem`),
 * with its sentence, so "an alert cannot be sent to nobody" is read before the click, not after it.
 */
const props = defineProps<{
  alert: RoutingAlert;
  members: RoutingMember[];
  /** Can this server send a text at all? Without it there is no Text column, and text routes are left as they are. */
  textsAvailable: boolean;
}>();

const toast = useToastStore();
const ask = useConfirm();
const save = useSaveAlertRoutes();
const reset = useResetAlertRoutes();
const busy = computed(() => save.isPending.value || reset.isPending.value);

const rows = ref<RecipientRow[]>([]);
watch(
  () => [props.alert, props.members] as const,
  ([alert, members]) => {
    rows.value = recipientRows(alert, members);
  },
  { immediate: true },
);

const alertKey = computed(() => props.alert.key as AlertKey);
const changed = computed(() => routesChanged(rows.value, props.alert, props.members));
const channels = computed(() => editedChannels(props.textsAvailable));
const routes = computed(() => toRoutes(rows.value, props.alert.routes, channels.value));
const problem = computed(() => alertRoutesProblem(alertKey.value, routes.value, new Set(props.members.map((m) => m.userId)), new Set(props.alert.roles.map((r) => r.key))));

const columns = computed<DataTableColumn[]>(() => [
  { key: "recipient", label: "Who", width: "xl" },
  { key: "bell", label: "Dashboard", align: "center", width: "sm" },
  { key: "email", label: "Email", align: "center", width: "sm" },
  ...(props.textsAvailable ? [{ key: "sms", label: "Text", align: "center" as const, width: "sm" as const }] : []),
]);

function set(row: RecipientRow, channel: EditedChannel, on: boolean): void {
  rows.value = rows.value.map((r) => (r.id === row.id ? { ...r, [channel]: on } : r));
}
const remove = (row: RecipientRow): void => {
  rows.value = rows.value.filter((r) => r.id !== row.id);
};

const personOptions = computed(() => addablePeople(rows.value, props.members).map((m) => ({ value: m.userId, label: m.name })));
function addPerson(userId: string | number | null | undefined): void {
  const member = props.members.find((m) => m.userId === userId);
  if (member) rows.value = [...rows.value, personRow(alertKey.value, rows.value, member)];
}

async function onSave(): Promise<void> {
  if (problem.value) return;
  try {
    await save.mutateAsync({ alert: alertKey.value, routes: routes.value });
    toast.success(`${props.alert.label}: saved`);
  } catch (e) {
    toast.error("Could not save who is told", e instanceof Error ? e.message : undefined);
  }
}

async function onReset(): Promise<void> {
  const asked = await ask({
    title: `Use the defaults for "${props.alert.label}"?`,
    message: "Your own choices for this alert are removed, and it goes to whoever the defaults name.",
    confirmLabel: "Use the defaults",
  });
  if (!asked) return;
  try {
    await reset.mutateAsync({ alert: alertKey.value });
    toast.success(`${props.alert.label}: back on the defaults`);
  } catch (e) {
    toast.error("Could not go back to the defaults", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <BaseCard as="section" :data-testid="`alert-routes-${alert.key}`">
    <div class="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h3 class="text-sm font-semibold text-ink">{{ alert.label }}</h3>
        <p class="mt-1 text-xs text-ink-muted">{{ alert.description }}</p>
      </div>
      <span v-if="alert.usesDefaults && !changed" class="text-xs text-ink-muted">On the defaults</span>
    </div>

    <DataTable class="mt-3" embedded dense :columns="columns" :rows="rows" row-key="id" empty-text="Nobody is listed.">
      <template #cell-recipient="{ row }">
        <span class="font-medium text-ink">{{ row.label }}</span>
        <span v-if="row.hint" class="block whitespace-normal text-xs font-normal text-ink-muted">{{ row.hint }}</span>
      </template>
      <template #cell-bell="{ row }">
        <BaseSwitch :model-value="row.bell" :label="`${row.label}: dashboard`" :disabled="busy" @update:model-value="set(row as RecipientRow, 'bell', $event)" />
      </template>
      <template #cell-email="{ row }">
        <BaseSwitch :model-value="row.email" :label="`${row.label}: email`" :disabled="busy" @update:model-value="set(row as RecipientRow, 'email', $event)" />
      </template>
      <template #cell-sms="{ row }">
        <BaseSwitch :model-value="row.sms" :label="`${row.label}: text`" :disabled="busy" @update:model-value="set(row as RecipientRow, 'sms', $event)" />
        <span v-if="row.sms && row.textHint" class="block text-xs font-normal text-ink-muted">{{ row.textHint }}</span>
      </template>
      <!-- The table's own actions slot, not a column: a column's empty cell draws a dash on every role's row. -->
      <template #actions="{ row }">
        <BaseButton v-if="row.kind === 'user'" variant="link" class="whitespace-nowrap" :disabled="busy" :aria-label="`Take ${row.label} off this alert's list`" @click="remove(row as RecipientRow)">Take off</BaseButton>
      </template>
    </DataTable>

    <div class="mt-3 flex flex-wrap items-center gap-3">
      <AppSelect class="max-w-xs" :model-value="null" :options="personOptions" placeholder="Add a person…" :aria-label="`Add a person to ${alert.label}`" :disabled="busy || personOptions.length === 0" @update:model-value="addPerson" />
      <BaseButton variant="primary" :disabled="!changed || !!problem || busy" @click="onSave">{{ save.isPending.value ? "Saving…" : "Save" }}</BaseButton>
      <BaseButton v-if="changed" variant="secondary" :disabled="busy" @click="rows = recipientRows(alert, members)">Undo changes</BaseButton>
      <BaseButton v-if="!alert.usesDefaults" variant="link" :disabled="busy" @click="onReset">Use the defaults</BaseButton>
    </div>
    <p v-if="changed && problem" class="mt-2 text-xs text-danger-700" role="alert">{{ problem }}</p>
  </BaseCard>
</template>
