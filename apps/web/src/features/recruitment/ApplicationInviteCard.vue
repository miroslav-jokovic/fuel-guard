<script setup lang="ts">
import { computed, ref } from "vue";
import { AppButton as BaseButton, AppCard as BaseCard, AppInput as BaseInput, AppFormField as FormField } from "@fuelguard/ui";
import { rolesThatManage } from "@fuelguard/shared";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import { applicationInviteBadge, BADGE_BASE, toneClass } from "@/lib/badges";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import {
  inviteState,
  useApplicationInvitesQuery,
  useCreateApplicationInvite,
  useRevokeApplicationInvite,
  type ApplicationInvitation,
} from "@/features/recruitment/useApplicationInvites";

/**
 * Inviting an applicant to fill in their own §391.21 application (H5b).
 *
 * ── THE LINK IS SHOWN ONCE, AND THE CARD SAYS SO ───────────────────────────────────────────────
 * The server keeps only a SHA-256, so this is the single moment the token exists anywhere but the
 * applicant's inbox. The card holds it in memory until the page is left and states plainly that it
 * cannot be shown again — a UI that quietly dropped it would leave a recruiter clicking "resend" on
 * something that has no resend.
 */
const props = defineProps<{ driverId: string; driverStatus: string }>();
const driverId = computed(() => props.driverId);

const session = useSessionStore();
const toast = useToastStore();
const invitesQ = useApplicationInvitesQuery(driverId);
const create = useCreateApplicationInvite();
const revoke = useRevokeApplicationInvite();

const canInvite = computed(() => {
  const role = session.role;
  return Boolean(role) && rolesThatManage("recruitment").includes(role!);
});

const email = ref("");
const link = ref<string | null>(null);

async function invite(): Promise<void> {
  try {
    const result = await create.mutateAsync({ driverId: driverId.value, email: email.value.trim() || null });
    link.value = result.link;
    email.value = "";
  } catch (e) {
    toast.error("Could not create the invitation", e instanceof Error ? e.message : undefined);
  }
}

async function copyLink(): Promise<void> {
  if (!link.value) return;
  try {
    await navigator.clipboard.writeText(link.value);
    toast.success("Link copied");
  } catch {
    // Clipboard access is refused in some browsers and contexts; the link is on screen either way.
    toast.error("Could not copy", "Select the link and copy it manually.");
  }
}

async function revokeInvite(row: ApplicationInvitation): Promise<void> {
  try {
    await revoke.mutateAsync({ id: row.id, driverId: driverId.value });
    toast.success("Invitation revoked");
  } catch (e) {
    toast.error("Could not revoke it", e instanceof Error ? e.message : undefined);
  }
}

const stateOf = (row: ApplicationInvitation) => inviteState(row, new Date());
const stateBadge = (row: ApplicationInvitation) => applicationInviteBadge(stateOf(row));

const columns: DataTableColumn[] = [
  { key: "created_at", label: "Sent" },
  { key: "email", label: "To" },
  { key: "expires_at", label: "Expires" },
  { key: "state", label: "State" },
];
</script>

<template>
  <div class="space-y-6">
    <BaseCard>
      <div class="flex items-start justify-between gap-4">
        <div>
          <h3 class="text-sm font-semibold text-ink">Application</h3>
          <p class="mt-1 text-sm text-ink-muted">
            §391.21(b) is a form the applicant fills in and certifies themselves. Send them a link and
            their answers become the employment history and the record this file is built from.
          </p>
        </div>
      </div>

      <div v-if="canInvite && driverStatus === 'applicant'" class="mt-4 flex flex-wrap items-end gap-3">
        <FormField v-slot="{ id }" label="Their email" hint="Optional — recorded so you can see who was invited.">
          <BaseInput :id="id" v-model="email" type="email" placeholder="Optional" />
        </FormField>
        <BaseButton variant="primary" :disabled="create.isPending.value" @click="invite">
          {{ create.isPending.value ? "Creating…" : "Create an application link" }}
        </BaseButton>
      </div>
      <p v-else-if="driverStatus !== 'applicant'" class="mt-4 text-sm text-ink-muted">
        This driver is {{ driverStatus }}. An application is something somebody submits before they
        are hired.
      </p>

      <div v-if="link" class="mt-4 rounded-surface bg-surface-muted p-3">
        <p class="text-xs font-medium text-ink-secondary">Send this link to the applicant</p>
        <p class="mt-1 break-all font-mono text-xs text-ink">{{ link }}</p>
        <div class="mt-3 flex items-center gap-3">
          <BaseButton size="sm" @click="copyLink">Copy the link</BaseButton>
          <p class="text-xs text-ink-muted">
            It is shown once. We keep only a fingerprint of it, so it cannot be shown again — create a
            new invitation if it is lost.
          </p>
        </div>
      </div>
    </BaseCard>

    <BaseCard padding="none">
      <DataTable
        :columns="columns"
        :rows="invitesQ.data.value ?? []"
        row-key="id"
        :loading="invitesQ.isLoading.value"
        :error="invitesQ.isError.value ? (invitesQ.error.value?.message ?? 'Could not load the invitations.') : null"
        :retrying="invitesQ.isFetching.value"
        empty-text="No application link has been sent yet."
      >
        <template #cell-created_at="{ row }">{{ row.created_at.slice(0, 10) }}</template>
        <template #cell-email="{ row }">
          <span v-if="row.email">{{ row.email }}</span>
          <span v-else class="text-ink-muted">—</span>
        </template>
        <template #cell-expires_at="{ row }">{{ row.expires_at.slice(0, 10) }}</template>
        <template #cell-state="{ row }">
          <span :class="[BADGE_BASE, toneClass(stateBadge(row).tone)]">
            {{ stateBadge(row).label }}
          </span>
        </template>
        <template #actions="{ row }">
          <BaseButton
            v-if="canInvite && stateOf(row) === 'open'"
            size="sm"
            :disabled="revoke.isPending.value"
            @click="revokeInvite(row)"
          >
            Revoke
          </BaseButton>
        </template>
      </DataTable>
    </BaseCard>
  </div>
</template>
