<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { USER_ROLES, type UserRole, type Invite, type OrgMember } from "@fuelguard/shared";
import { apiFetch } from "@/lib/api";
import AppSelect from "@/components/AppSelect.vue";
import KebabMenu from "@/components/KebabMenu.vue";
import SearchInput from "@/components/SearchInput.vue";
import DataTable from "@/components/ui/DataTable.vue";
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
const removableMembers = computed(() => filteredMembers.value.filter((m) => m.userId !== session.userId));

const selectedIds = ref<Set<string>>(new Set());
const allChecked = computed(() => removableMembers.value.length > 0 && removableMembers.value.every((m) => selectedIds.value.has(m.userId)));
function toggleRow(id: string) {
  const next = new Set(selectedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedIds.value = next;
}
function toggleAll() {
  const next = new Set(selectedIds.value);
  if (allChecked.value) removableMembers.value.forEach((m) => next.delete(m.userId));
  else removableMembers.value.forEach((m) => next.add(m.userId));
  selectedIds.value = next;
}
const bulkBusy = ref(false);
async function bulkRemove() {
  const ids = [...selectedIds.value];
  if (ids.length === 0 || !confirm(`Remove ${ids.length} member${ids.length > 1 ? "s" : ""}?`)) return;
  bulkBusy.value = true;
  for (const id of ids) await apiFetch(`/api/members/${id}`, { method: "DELETE" });
  bulkBusy.value = false;
  selectedIds.value = new Set();
  toast.success("Members removed");
  await load();
}

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
            :options="USER_ROLES.map((r) => ({ value: r, label: r }))"
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

      <DataTable :loading="loading" :empty="filteredMembers.length === 0" empty-text="No members match." :skeleton-cols="5">
        <template #head>
          <tr>
            <th class="w-10 px-4 py-3">
              <input type="checkbox" :checked="allChecked" class="size-4 rounded border-edge-strong accent-brand-600" @change="toggleAll" />
            </th>
            <th class="px-4 py-3 font-medium min-w-[14rem]">Email</th>
            <th class="px-4 py-3 font-medium min-w-[7rem]">Role</th>
            <th class="px-4 py-3 font-medium min-w-[8rem]">Joined</th>
            <th class="px-4 py-3 w-12"></th>
          </tr>
        </template>
        <tr v-for="m in filteredMembers" :key="m.userId" class="hover:bg-surface-subtle">
          <td class="px-4 py-3">
            <input
              v-if="m.userId !== session.userId"
              type="checkbox"
              :checked="selectedIds.has(m.userId)"
              class="size-4 rounded border-edge-strong accent-brand-600"
              @change="toggleRow(m.userId)"
            />
          </td>
          <td class="px-4 py-3 text-ink">{{ m.email ?? m.userId }}</td>
          <td class="px-4 py-3 text-ink-secondary capitalize">{{ m.role }}</td>
          <td class="px-4 py-3 text-ink-muted">{{ new Date(m.joinedAt).toLocaleDateString() }}</td>
          <td class="px-4 py-3 text-right">
            <KebabMenu v-if="m.userId !== session.userId">
              <button class="kebab-item kebab-item-danger" @click="removeMember(m.userId)">Remove member</button>
            </KebabMenu>
            <span v-else class="text-xs text-ink-subtle">You</span>
          </td>
        </tr>
      </DataTable>
    </section>

    <section class="space-y-3">
      <h3 class="text-base font-semibold text-ink">Invitations</h3>
      <DataTable :loading="loading" :empty="invites.length === 0" empty-text="No invitations yet." :skeleton-cols="4">
        <template #head>
          <tr>
            <th class="px-6 py-3 font-medium min-w-[14rem]">Email</th>
            <th class="px-6 py-3 font-medium min-w-[7rem]">Role</th>
            <th class="px-6 py-3 font-medium min-w-[7rem]">Status</th>
            <th class="px-6 py-3 w-12"></th>
          </tr>
        </template>
        <tr v-for="inv in invites" :key="inv.id" class="hover:bg-surface-subtle">
          <td class="px-6 py-3 text-ink">{{ inv.email }}</td>
          <td class="px-6 py-3 text-ink-secondary capitalize">{{ inv.role }}</td>
          <td class="px-6 py-3"><span :class="[BADGE_BASE, inviteTone(inv.status)]">{{ inv.status }}</span></td>
          <td class="px-6 py-3 text-right">
            <KebabMenu v-if="inv.status === 'pending' || inv.status === 'revoked' || inv.status === 'expired'">
              <button v-if="inv.status === 'pending'" class="kebab-item kebab-item-danger" @click="revoke(inv.id)">Revoke invite</button>
              <button v-else class="kebab-item" @click="resend(inv.id)">Resend invite</button>
            </KebabMenu>
          </td>
        </tr>
      </DataTable>
    </section>
  </div>
</template>
