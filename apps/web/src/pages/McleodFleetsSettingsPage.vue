<script setup lang="ts">
import { computed } from "vue";
import { AppSelect } from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import SettingsSection from "@/components/ui/SettingsSection.vue";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { useDispatchLinksQuery, useLinkDispatcherUser, useLinkFleet } from "@/features/dispatch/useDispatchBoard";

/**
 * Settings → McLeod fleets: whose fleet is whose (DISPATCH-BOARD-PLAN DB2, LM11).
 *
 * Two links an office confirms, and the dispatch board's "My fleet" is derived from both:
 *   1. a McLeod fleet code ('VINNIEV') → the McLeod login that runs it ('vinniev')
 *   2. a McLeod login → the person in Silvicom 360 who IS that dispatcher
 * Fleet codes are not logins ('IVO' is run by 'ivok'), which is why the first link exists at all, and
 * the McLeod feed never writes either (D-LM4) — a re-sync must not move a dispatcher's board.
 *
 * The page opens to `settings: view` and edits on `settings: manage` (Q-DB3), the same as the API.
 */
const session = useSessionStore();
const toast = useToastStore();
const links = useDispatchLinksQuery();
const linkFleet = useLinkFleet();
const linkUser = useLinkDispatcherUser();
const canEdit = computed(() => session.can("settings"));

const data = computed(() => links.data.value);
const humans = computed(() => (data.value?.dispatchers ?? []).filter((d) => !d.isSystem));
const loginOptions = computed(() => [
  { value: null, label: "Not linked" },
  ...humans.value.map((d) => ({ value: d.id, label: d.name && d.name !== d.id ? `${d.id} · ${d.name}` : d.id })),
]);
const peopleOptions = computed(() => [
  { value: null, label: "Not linked" },
  ...(data.value?.people ?? []).map((p) => ({ value: p.userId, label: p.fullName || p.email || p.userId })),
]);

/** A suggestion, never a write: a login whose name starts with the fleet code (VINNIEV → vinniev). */
function suggestedLogin(code: string): string | null {
  const c = code.toLowerCase();
  return humans.value.find((d) => d.id.toLowerCase() === c || d.id.toLowerCase().startsWith(c))?.id ?? null;
}

const fleetColumns: DataTableColumn[] = [
  { key: "code", label: "McLeod fleet", width: "md", cellClass: "font-medium text-ink" },
  { key: "login", label: "Run by (McLeod login)", width: "xl" },
];
const loginColumns: DataTableColumn[] = [
  { key: "id", label: "McLeod login", width: "md", cellClass: "font-medium text-ink" },
  { key: "user", label: "Person in Silvicom 360", width: "xl" },
];

async function onFleet(code: string, dispatcherId: string | null) {
  try {
    await linkFleet.mutateAsync({ code, dispatcherId });
    toast.success(dispatcherId ? `${code} linked to ${dispatcherId}` : `${code} unlinked`);
  } catch (e) {
    toast.error("Could not save the fleet", e instanceof Error ? e.message : undefined);
  }
}
async function onUser(dispatcherId: string, userId: string | null) {
  try {
    await linkUser.mutateAsync({ dispatcherId, userId });
    toast.success(userId ? `${dispatcherId} linked` : `${dispatcherId} unlinked`);
  } catch (e) {
    toast.error("Could not save the dispatcher", e instanceof Error ? e.message : undefined);
  }
}
const asId = (v: string | number | null | undefined): string | null => (v == null || v === "" ? null : String(v));
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      description="Which McLeod dispatcher runs each fleet, and who each dispatcher is here. The dispatch board's My fleet is built from these two links."
    />

    <SettingsSection
      title="Fleets"
      description="McLeod's fleet codes, as the roster sweep receives them. Link each to the login that runs it; fleet 1 is the parked and shop pool and is usually left unlinked."
    >
      <DataTable
        :columns="fleetColumns"
        :rows="data?.fleets ?? []"
        row-key="code"
        :loading="links.isLoading.value"
        :error="links.isError.value ? 'Could not load the McLeod fleets' : null"
        :retrying="links.isFetching.value"
        empty-text="No fleets yet. They arrive with the next roster sweep from the McLeod connector."
        @retry="links.refetch()"
      >
        <template #cell-login="{ row }">
          <div class="flex items-center gap-2">
            <AppSelect
              class="max-w-xs"
              :model-value="row.dispatcherId"
              :options="loginOptions"
              :aria-label="`McLeod login that runs ${row.code}`"
              :disabled="!canEdit || linkFleet.isPending.value"
              @update:model-value="onFleet(row.code, asId($event))"
            />
            <span
              v-if="!row.dispatcherId && suggestedLogin(row.code)"
              :class="[BADGE_BASE, toneClass('info')]"
              :title="`The login ${suggestedLogin(row.code)} matches this fleet's name. Choose it to link.`"
            >
              Suggest {{ suggestedLogin(row.code) }}
            </span>
          </div>
        </template>
      </DataTable>
    </SettingsSection>

    <SettingsSection
      title="Dispatchers"
      description="McLeod logins that have dispatched a load. Link each to the person who uses it; McLeod's system accounts are not listed."
    >
      <DataTable
        :columns="loginColumns"
        :rows="humans"
        row-key="id"
        :loading="links.isLoading.value"
        :error="links.isError.value ? 'Could not load the McLeod dispatchers' : null"
        :retrying="links.isFetching.value"
        empty-text="No McLeod dispatchers yet. They arrive with the next load sync."
        @retry="links.refetch()"
      >
        <template #cell-id="{ row }">
          {{ row.id }}<span v-if="row.name && row.name !== row.id" class="text-ink-muted"> · {{ row.name }}</span>
        </template>
        <template #cell-user="{ row }">
          <AppSelect
            class="max-w-xs"
            :model-value="row.userId"
            :options="peopleOptions"
            :aria-label="`Person who uses ${row.id}`"
            :disabled="!canEdit || linkUser.isPending.value"
            @update:model-value="onUser(row.id, asId($event))"
          />
        </template>
      </DataTable>
    </SettingsSection>
  </div>
</template>
