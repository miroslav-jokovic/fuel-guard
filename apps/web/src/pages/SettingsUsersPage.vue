<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { USER_ROLES, USER_ROLE_LABELS, type UserRole, type Invite, type OrgMember } from "@fuelguard/shared";
import { apiFetch } from "@/lib/api";
import AppSelect from "@/components/AppSelect.vue";
import KebabMenu from "@/components/KebabMenu.vue";
import SearchInput from "@/components/SearchInput.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import BaseInput from "@/components/ui/BaseInput.vue";
import FormField from "@/components/ui/FormField.vue";
import { BADGE_BASE, inviteTone } from "@/lib/badges";
import { useToastStore } from "@/stores/toast";
import { useSessionStore } from "@/stores/session";

const toast = useToastStore();
const session = useSessionStore();

const invites = ref<Invite[]>([]);
const members = ref<OrgMember[]>([]);
const loading = ref(false);

const email = ref("");
const role = ref<UserRole>("driver");
const submitting = ref(false);

async function load() {
  loading.value = true;
  const [invRes, memRes] = await Promise.all([
    apiFetch<{ invites: Invite[] }>("/api/invites"),
    apiFetch<{ members: OrgMember[] }>("/api/members"),
  ]);
  if (invRes.ok && invRes.data) invites.value = invRes.data.invites;
  else toast.error("Could not load invitations", invRes.error?.message);
  if (memRes.ok && memRes.data) members.value = memRes.data.members;
  else toast.error("Could not load members", memRes.error?.message);
  loading.value = false;
}

interface InviteResult { emailSent: boolean; reason?: string | null }

const REASON_TEXT: Record<string, string> = {
  mail_disabled: "Email isn't configured on the server.",
  send_failed: "The email provider rejected the message — check the verified sender in Brevo.",
  link_failed: "Couldn't create the invite — try again.",
};

function handleInviteResult(addr: string, data: InviteResult | undefined) {
  if (data?.emailSent) toast.success("Invitation emailed", addr);
  else toast.error("Invitation not emailed", data?.reason ? (REASON_TEXT[data.reason] ?? data.reason) : undefined);
}

interface MailTest { ok: boolean; provider: string; status?: number; detail?: string; from: string; to: string }
const mailTest = ref<MailTest | null>(null);
const testing = ref(false);
async function sendMailTest() {
  testing.value = true;
  mailTest.value = null;
  const res = await apiFetch<MailTest>("/api/invites/mail-test", { method: "POST" });
  testing.value = false;
  if (res.ok && res.data) {
    mailTest.value = res.data;
    if (res.data.ok) toast.success("Test email sent", `Check ${res.data.to}`);
    else toast.error("Provider rejected the email", res.data.detail ?? undefined);
  } else {
    toast.error("Mail test failed", res.error?.message);
  }
}

async function invite() {
  submitting.value = true;
  const addr = email.value;
  const res = await apiFetch<InviteResult>("/api/invites", { method: "POST", body: { email: addr, role: role.value } });
  if (res.ok) {
    handleInviteResult(addr, res.data);
    email.value = "";
    role.value = "driver";
    await load();
  } else {
    toast.error("Could not send invite", res.error?.message);
  }
  submitting.value = false;
}

async function revoke(id: string) {
  const res = await apiFetch(`/api/invites/${id}/revoke`, { method: "POST" });
  if (res.ok) {
    toast.success("Invitation revoked");
    await load();
  } else {
    toast.error("Could not revoke invitation", res.error?.message);
  }
}

async function resend(id: string) {
  const inv = invites.value.find((i) => i.id === id);
  const res = await apiFetch<InviteResult>(`/api/invites/${id}/resend`, { method: "POST" });
  if (res.ok) {
    handleInviteResult(inv?.email ?? "the recipient", res.data);
    await load();
  } else {
    toast.error("Could not resend invitation", res.error?.message);
  }
}

async function removeMember(userId: string) {
  const res = await apiFetch(`/api/members/${userId}`, { method: "DELETE" });
  if (res.ok) {
    toast.success("Member removed");
    await load();
  } else {
    toast.error("Could not remove member", res.error?.message);
  }
}

// ── search + multi-select (members) ─────────────────────────────────────────
const search = ref("");
const filteredMembers = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return members.value;
  return members.value.filter((m) => (m.email ?? m.userId).toLowerCase().includes(q) || m.role.toLowerCase().includes(q));
});

// DataTable owns the checkboxes + select-all; bulk remove never targets yourself.
const selectedIds = ref<Set<string>>(new Set());
const bulkBusy = ref(false);
async function bulkRemove() {
  const ids = [...selectedIds.value].filter((id) => id !== session.userId);
  if (ids.length === 0 || !confirm(`Remove ${ids.length} member${ids.length > 1 ? "s" : ""}?`)) return;
  bulkBusy.value = true;
  for (const id of ids) await apiFetch(`/api/members/${id}`, { method: "DELETE" });
  bulkBusy.value = false;
  selectedIds.value = new Set();
  toast.success("Members removed");
  await load();
}

const memberColumns: DataTableColumn[] = [
  { key: "email", label: "Email", headerClass: "min-w-[14rem]" },
  { key: "role", label: "Role", headerClass: "min-w-[7rem]", cellClass: "text-ink-secondary capitalize" },
  { key: "joinedAt", label: "Joined", headerClass: "min-w-[8rem]", cellClass: "text-ink-muted" },
];

const inviteColumns: DataTableColumn[] = [
  { key: "email", label: "Email", headerClass: "min-w-[14rem]" },
  { key: "role", label: "Role", headerClass: "min-w-[7rem]", cellClass: "text-ink-secondary capitalize" },
  { key: "status", label: "Status", headerClass: "min-w-[7rem]" },
];

onMounted(load);
</script>

<template>
  <div class="space-y-6">
    <BaseCard as="section">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 class="text-base font-semibold text-ink">Invite a user</h3>
          <p class="mt-1 text-sm text-ink-muted">Only addresses on your organization's allowed domain can be invited.</p>
        </div>
        <BaseButton
          size="sm"
          :disabled="testing"
          title="Send a test email to your own address to verify the mail setup"
          @click="sendMailTest"
        >
          {{ testing ? "Testing…" : "Send test email" }}
        </BaseButton>
      </div>
      <div
        v-if="mailTest"
        :class="['mt-3 rounded-md p-3 text-sm ring-1', mailTest.ok ? 'bg-success-50 text-success-800 ring-success-200' : 'bg-danger-50 text-danger-800 ring-danger-200']"
      >
        <p v-if="mailTest.ok">Sent via {{ mailTest.provider }} to {{ mailTest.to }} — check your inbox.</p>
        <p v-else>
          {{ mailTest.provider }} rejected the message (status {{ mailTest.status ?? "—" }}):
          <span class="font-mono">{{ mailTest.detail ?? "no detail" }}</span>
          <br /><span class="text-xs">from: {{ mailTest.from }}</span>
        </p>
      </div>
      <form class="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end" @submit.prevent="invite">
        <FormField label="Email" class="flex-1" v-slot="{ id }">
          <BaseInput
            :id="id"
            v-model="email"
            type="email"
            required
            placeholder="name@silvicominc.com"
          />
        </FormField>
        <FormField label="Role">
          <AppSelect
            v-model="role"
            :options="USER_ROLES.map((r) => ({ value: r, label: USER_ROLE_LABELS[r] }))"
          />
        </FormField>
        <BaseButton variant="primary" type="submit" :disabled="submitting">
          {{ submitting ? "Sending…" : "Send invite" }}
        </BaseButton>
      </form>
    </BaseCard>

    <section class="space-y-3">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 class="text-base font-semibold text-ink">Active members</h3>
        <div class="w-full sm:w-64">
          <SearchInput v-model="search" placeholder="Search members…" />
        </div>
      </div>

      <div v-if="selectedIds.size > 0" class="flex items-center justify-between rounded-lg bg-brand-50 px-4 py-2.5 text-sm ring-1 ring-brand-100">
        <span class="font-medium text-brand-800">{{ selectedIds.size }} selected</span>
        <div class="flex items-center gap-3">
          <button :disabled="bulkBusy" class="font-medium text-danger-600 hover:text-danger-500 disabled:opacity-50" @click="bulkRemove">Remove</button>
          <button class="font-medium text-ink-muted hover:text-ink-secondary" @click="selectedIds = new Set()">Clear</button>
        </div>
      </div>

      <DataTable
        :columns="memberColumns"
        :rows="filteredMembers"
        row-key="userId"
        :loading="loading"
        empty-text="No members match."
        selectable
        :selected="selectedIds"
        @update:selected="selectedIds = $event"
      >
        <template #cell-email="{ row }">{{ row.email ?? row.userId }}</template>
        <template #cell-joinedAt="{ row }">{{ new Date(row.joinedAt).toLocaleDateString() }}</template>
        <template #actions="{ row }">
          <KebabMenu v-if="row.userId !== session.userId">
            <button class="kebab-item kebab-item-danger" @click="removeMember(row.userId)">Remove member</button>
          </KebabMenu>
          <span v-else class="text-xs text-ink-subtle">You</span>
        </template>
      </DataTable>
    </section>

    <section class="space-y-3">
      <h3 class="text-base font-semibold text-ink">Invitations</h3>
      <DataTable :columns="inviteColumns" :rows="invites" row-key="id" :loading="loading" empty-text="No invitations yet.">
        <template #cell-status="{ row }">
          <span :class="[BADGE_BASE, inviteTone(row.status)]">{{ row.status }}</span>
        </template>
        <template #actions="{ row }">
          <KebabMenu v-if="row.status === 'pending' || row.status === 'revoked' || row.status === 'expired'">
            <button v-if="row.status === 'pending'" class="kebab-item kebab-item-danger" @click="revoke(row.id)">Revoke invite</button>
            <button v-else class="kebab-item" @click="resend(row.id)">Resend invite</button>
          </KebabMenu>
        </template>
      </DataTable>
    </section>
  </div>
</template>
