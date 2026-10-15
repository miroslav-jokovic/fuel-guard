<script setup lang="ts">
import { computed, ref } from "vue";
import {
  AppButton,
  AppCallout,
  AppCard,
  AppInput,
  AppPageHeader,
  AppSelect,
  DataTable,
  useConfirm,
  type DataTableColumn,
  type SelectOption,
} from "@silvicom/ui";
import AppShell from "@/layouts/AppShell.vue";
import ReleaseApprovalCard from "@/components/ReleaseApprovalCard.vue";
import { ApiRequestError, type AlertRecipient } from "@/lib/api";
import { useAlertRecipientChange, useAlertRecipientsQuery } from "@/lib/queries";
import { fmtDate } from "@/lib/format";

/**
 * Platform settings. First: tonight's release, approved here (D-REL14, ReleaseApprovalCard). Then
 * who hears a platform alarm (0427) — the nightly release's
 * outcome by email, and a failed or rolled-back release by text as well. Added and removed here,
 * without a deploy; scripts/release-notify.mjs reads the list at send time.
 *
 * Since US7 (D-US11) the list is a `DataTable` with its own read states: a failed read says so in the
 * table rather than drawing "No one on the list", which on THIS list is the sentence that says
 * release alarms reach nobody. Removing asks in the product's dialog, not `window.confirm` (D-US7).
 */
const recipients = useAlertRecipientsQuery();
const { add, remove } = useAlertRecipientChange();
const ask = useConfirm();

const channel = ref<"sms" | "email">("sms");
const address = ref("");
const label = ref("");
const failure = ref<string | null>(null);

const CHANNELS: SelectOption[] = [
  { value: "sms", label: "Text message" },
  { value: "email", label: "Email" },
];

const texts = computed(() => (recipients.data.value ?? []).filter((r) => r.channel === "sms"));
const rows = computed(() => [...texts.value, ...(recipients.data.value ?? []).filter((r) => r.channel === "email")]);

const COLUMNS: DataTableColumn[] = [
  { key: "channel", label: "Type", cellClass: "text-ink-secondary", width: "sm" },
  { key: "address", label: "Address", cellClass: "font-medium text-ink tabular-nums" },
  { key: "label", label: "Who", cellClass: "text-ink-secondary" },
  { key: "createdAt", label: "Added", cellClass: "text-ink-secondary", width: "md" },
];

/** What to tell the person about a refused change, from the API's own error code. */
function explain(e: unknown, fallback: string): string {
  if (e instanceof ApiRequestError) {
    if (e.code === "step_up_required") return "For this change, sign out and sign in again with your authenticator code, then retry.";
    if (e.status === 403) return "Only a platform owner or admin can change who is alerted.";
    if (e.detail) return e.detail;
  }
  return fallback;
}

async function addRecipient() {
  if (!address.value.trim()) return;
  failure.value = null;
  try {
    await add.mutateAsync({ channel: channel.value, address: address.value, label: label.value || undefined });
    address.value = "";
    label.value = "";
  } catch (e) {
    failure.value = explain(e, "Could not add the recipient.");
  }
}

async function removeRecipient(r: AlertRecipient) {
  const last = r.channel === "sms" && texts.value.length === 1;
  const yes = await ask({
    title: `Remove ${r.address}?`,
    message: last
      ? "It is the last phone on the list: a failed release at night will then reach nobody by text."
      : "They stop hearing about production releases.",
    confirmLabel: "Remove",
    tone: "danger",
  });
  if (!yes) return;
  failure.value = null;
  try {
    await remove.mutateAsync(r.id);
  } catch (e) {
    failure.value = explain(e, "Could not remove the recipient.");
  }
}
</script>

<template>
  <AppShell>
    <AppPageHeader title="Settings" description="Platform-wide settings. Changes apply at once and are recorded in the audit trail." />

    <ReleaseApprovalCard class="mt-5" />

    <AppCard class="mt-5">
      <h2 class="text-sm font-semibold text-ink-secondary">Alert recipients</h2>
      <p class="mt-1 text-sm text-ink-secondary">
        Who hears about production releases. Everyone here gets an email for every release night. Phones also get a text
        when a release fails or is rolled back.
      </p>

      <form class="mt-4 flex flex-wrap items-end gap-3" @submit.prevent="addRecipient">
        <label class="w-40 text-sm">
          <span class="mb-1 block text-xs font-medium text-ink-secondary">Type</span>
          <AppSelect v-model="channel" :options="CHANNELS" />
        </label>
        <label class="min-w-56 flex-1 text-sm">
          <span class="mb-1 block text-xs font-medium text-ink-secondary">{{ channel === "sms" ? "Phone number" : "Email address" }}</span>
          <AppInput v-model="address" :placeholder="channel === 'sms' ? '872 800 8639' : 'name@silvicominc.com'" />
        </label>
        <label class="min-w-48 flex-1 text-sm">
          <span class="mb-1 block text-xs font-medium text-ink-secondary">Who is it (optional)</span>
          <AppInput v-model="label" placeholder="Miki — mobile" />
        </label>
        <AppButton type="submit" variant="primary" :disabled="add.isPending.value || !address.trim()">
          {{ add.isPending.value ? "Adding…" : "Add" }}
        </AppButton>
      </form>
      <AppCallout v-if="failure" tone="danger" class="mt-3" role="alert">{{ failure }}</AppCallout>
    </AppCard>

    <AppCard padding="none" class="mt-5">
      <DataTable
        embedded
        :columns="COLUMNS"
        :rows="rows"
        row-key="id"
        :loading="recipients.isPending.value"
        :error="recipients.isError.value ? 'Could not load the alert recipients.' : null"
        :retrying="recipients.isFetching.value"
        @retry="() => recipients.refetch()"
      >
        <template #cell-channel="{ value }">{{ value === "sms" ? "Text" : "Email" }}</template>
        <template #cell-label="{ value }">{{ value ?? "—" }}</template>
        <template #cell-createdAt="{ value }">{{ fmtDate(value) }}</template>
        <template #actions="{ row }">
          <AppButton size="sm" variant="ghost" :disabled="remove.isPending.value" @click="removeRecipient(row)">Remove</AppButton>
        </template>
        <template #empty>
          <p>
            No one on the list. Until someone is added, release alerts go to the addresses set in the repository's
            RELEASE_NOTIFY secrets.
          </p>
        </template>
      </DataTable>
    </AppCard>
  </AppShell>
</template>
