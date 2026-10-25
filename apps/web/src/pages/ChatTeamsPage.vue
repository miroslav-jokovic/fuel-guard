<script setup lang="ts">
import { computed, ref } from "vue";
import type { ChatTeamDirectoryEntry } from "@silvicom/shared";
import { AppBadge, AppButton as BaseButton, AppIcon, DataTable, useConfirm, type DataTableColumn } from "@silvicom/ui";
import { PlusIcon } from "@silvicom/ui/icons";
import PageHeader from "@/components/ui/PageHeader.vue";
import NewTeamDialog from "@/features/chat/teams/NewTeamDialog.vue";
import { useArchiveTeam, useCreateTeam, useTeamDirectoryQuery } from "@/features/chat/teams/useChatTeamsAdmin";
import { useChatPeopleQuery } from "@/features/chat/useChat";
import { formatDate } from "@/lib/format";
import { genUuid } from "@/lib/uuid";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";

/**
 * Settings → Chat teams (OFFICE-CHAT-PLAN CH5b; D-CHAT17, D-CHAT21): every office chat team of the
 * organisation, for whoever holds the `chat.teams` permission (admins by default; Settings →
 * Permissions gives it to any office role or person). Here they make teams and archive them,
 * including teams they are not in.
 *
 * What is NOT here, on purpose: any team's messages. Managing a team is its name and its people; the
 * one place another person's messages are read is Settings → Chat compliance, with a reason (D-CHAT14).
 * Channels and posts are on the Chat page, for the people in the team.
 */
const session = useSessionStore();
const toast = useToastStore();
const confirmAsk = useConfirm();

const teams = useTeamDirectoryQuery();
const creating = ref(false);
const people = useChatPeopleQuery(creating);
const create = useCreateTeam();
const archive = useArchiveTeam();

async function makeTeam(name: string, description: string | null, memberIds: string[]) {
  try {
    await create.mutateAsync({ space_id: genUuid(), general_id: genUuid(), name, description, member_ids: memberIds });
    toast.success("The team is made.", `${name} has a General channel everyone in it is in.`);
    creating.value = false;
  } catch (e) {
    toast.error("Could not make the team.", e instanceof Error ? e.message : undefined);
  }
}

async function archiveTeam(t: ChatTeamDirectoryEntry) {
  // The product's dialog (D-US7). Not red: an archived team stays readable to its people and to the
  // compliance console, and its name is free for a new team — nothing is lost.
  const ok = await confirmAsk({
    title: `Archive ${t.name}?`,
    message: "Its channels close: nobody can post in them any more. Everything already written stays readable to the people who were in it.",
    confirmLabel: "Archive",
  });
  if (!ok) return;
  try {
    await archive.mutateAsync(t.space_id);
    toast.success(`${t.name} is archived.`);
  } catch (e) {
    toast.error("Could not archive the team.", e instanceof Error ? e.message : undefined);
  }
}

const columns: DataTableColumn[] = [
  { key: "name", label: "Team", width: "xl" },
  { key: "owners", label: "Owners", width: "xl" },
  { key: "member_count", label: "People", width: "sm", align: "right" },
  { key: "channel_count", label: "Channels", width: "sm", align: "right" },
  { key: "created_at", label: "Made", width: "md" },
];
const rows = computed(() => teams.data.value ?? []);
const ownerNames = (t: ChatTeamDirectoryEntry) => t.owners.map((o) => o.name ?? "Unnamed member").join(", ") || "Nobody";
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Every office chat team in your organisation. Make a team, or archive one, including teams you are not in. A team's messages are only for the people in it.">
      <template #actions>
        <BaseButton variant="primary" @click="creating = true">
          <AppIcon :icon="PlusIcon" class="-ml-0.5 size-5" aria-hidden="true" /> New team
        </BaseButton>
      </template>
    </PageHeader>

    <DataTable
      :columns="columns"
      :rows="rows"
      row-key="space_id"
      :loading="teams.isPending.value"
      :error="teams.isError.value ? 'Could not load the teams.' : null"
      :retrying="teams.isFetching.value"
      empty-text="No teams yet. Make the first one with New team."
      @retry="teams.refetch()"
    >
      <template #cell-name="{ row }">
        <div class="flex items-center gap-2 text-ink">
          {{ row.name }}
          <AppBadge v-if="row.archived_at" tone="neutral">Archived</AppBadge>
          <AppBadge v-else-if="row.is_member" tone="info">You're in it</AppBadge>
        </div>
        <div v-if="row.description" class="text-xs text-ink-muted">{{ row.description }}</div>
      </template>
      <template #cell-owners="{ row }">{{ ownerNames(row) }}</template>
      <template #cell-created_at="{ row }">
        <div>{{ formatDate(row.created_at) }}</div>
        <div class="text-xs text-ink-muted">by {{ row.created_by_name ?? "someone" }}</div>
      </template>
      <template #actions="{ row }">
        <BaseButton v-if="!row.archived_at" size="sm" :disabled="archive.isPending.value" @click="archiveTeam(row)">Archive</BaseButton>
      </template>
    </DataTable>

    <NewTeamDialog
      :open="creating"
      :people="people.data.value ?? []"
      :viewer-id="session.userId ?? ''"
      :busy="create.isPending.value"
      @close="creating = false"
      @create="makeTeam"
    />
  </div>
</template>
