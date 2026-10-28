<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { AppButton as BaseButton, DataTable, type DataTableColumn, QueryState, useConfirm } from "@silvicom/ui";
import type { CountSessionDto } from "@silvicom/shared";
import { useCloseCountSession, useCountSessionsQuery } from "@/features/inventory/useInventory";
import { formatDateTime } from "@/lib/format";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";

/**
 * The counts and kit checks somebody started and nobody has closed (R9,
 * DRIVER-EQUIPMENT-AND-UNIT-TAGS-PLAN.md §5).
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────────────────────────
 * A walk is opened by one press and closed only from inside it, and until 2026-10-27 no screen
 * listed the open ones: production held four open checks of one truck, the oldest from 09-10, that
 * nobody could reach without the link. `useCountSessionsQuery` had been written for this and never
 * called. The shop home lists every open walk; a unit's page lists that unit's.
 *
 * ── DRAWN ONLY WHEN THERE IS SOMETHING OPEN ───────────────────────────────────────────────────
 * Nothing open is the normal state, and an empty "Open counts" card on every visit is a card people
 * learn to skip. A failed read is NOT nothing open, so it draws its Retry (F3).
 *
 * ── CLOSE IS HERE, AND SAYS WHAT IT LEAVES ────────────────────────────────────────────────────
 * Closing from the list is closing a walk somebody walked away from: whatever was answered stays
 * recorded, whatever was not is left as the system has it — the same words the walk's own Close
 * uses. Continuing (the row) and Close both write, so both are for managers; a viewer still sees
 * the list.
 */

const props = defineProps<{
  /** Narrow to one unit's checks; omitted = every open walk in the shop. */
  vehicleId?: string;
  trailerId?: string;
  title: string;
}>();

const router = useRouter();
const session = useSessionStore();
const toast = useToastStore();
const ask = useConfirm();
const canManage = computed(() => session.can("maintenance"));

const filter = computed(() => ({
  status: "open" as const,
  vehicleId: props.vehicleId,
  trailerId: props.trailerId,
}));
const { data, isError, isFetching, refetch } = useCountSessionsQuery(filter);
const open = computed<CountSessionDto[]>(() => data.value?.sessions ?? []);
const closeWalk = useCloseCountSession();

const COLUMNS: DataTableColumn[] = [
  { key: "holderLabel", label: "What" },
  { key: "openedAt", label: "Started", cellClass: "text-ink-secondary" },
  { key: "startedByName", label: "By", cellClass: "text-ink-secondary" },
];

const whatOf = (s: CountSessionDto) =>
  s.kind === "unit" ? `Equipment check — ${s.holderLabel ?? "a truck or trailer"}` : `Shelf count — ${s.holderLabel ?? "a bay"}`;

const continueWalk = (s: CountSessionDto) =>
  void router.push({ name: "count-session", params: { sessionId: s.id } });

async function close(s: CountSessionDto) {
  const ok = await ask({
    title: "Close this walk?",
    message:
      "Whatever was answered stays recorded. Anything nobody looked at is left exactly as it is. Closing cannot be undone.",
    confirmLabel: "Close",
    tone: "danger",
  });
  if (!ok) return;
  try {
    await closeWalk.mutateAsync({ id: s.id });
    toast.success("Closed");
  } catch (e) {
    toast.error("Could not close it", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <section v-if="isError || open.length" class="space-y-3">
    <h2 class="text-sm font-semibold text-ink">{{ title }}</h2>
    <QueryState
      v-if="isError"
      compact
      :loading="false"
      :error="true"
      :retrying="isFetching"
      error-text="Could not load the open counts."
      @retry="refetch()"
    />
    <!-- The row is Continue — it opens the walk, as a row opens its record everywhere else — and Close
         is the row's one button (contract §5.6). Both write, so neither is offered to a viewer. -->
    <!-- ui-adoption: never-empty — the section is drawn only while something is open. -->
    <DataTable
      v-else
      :columns="COLUMNS"
      :rows="open"
      row-key="id"
      :row-class="() => (canManage ? 'cursor-pointer' : '')"
      @row-click="(row) => canManage && continueWalk(row as CountSessionDto)"
    >
      <template #cell-holderLabel="{ row }">{{ whatOf(row as CountSessionDto) }}</template>
      <template #cell-openedAt="{ value }">{{ formatDateTime(value) }}</template>
      <template #cell-startedByName="{ value }">{{ value ?? "—" }}</template>
      <template #actions="{ row }">
        <BaseButton
          v-if="canManage"
          variant="ghost"
          size="sm"
          :disabled="closeWalk.isPending.value"
          @click.stop="close(row as CountSessionDto)"
        >
          Close
        </BaseButton>
      </template>
    </DataTable>
  </section>
</template>
