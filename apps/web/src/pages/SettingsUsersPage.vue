<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { USER_ROLES, USER_ROLE_LABELS, APP_SECTIONS, sectionAccess, type AppSection, type UserRole, type Invite, type OrgMember } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { AppSelect, AppTable } from "@silvicom/ui";
import KebabMenu from "@/components/KebabMenu.vue";
import { AppSearchField as SearchInput } from "@silvicom/ui";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import { AppCard as BaseCard } from "@silvicom/ui";
import { AppButton as BaseButton } from "@silvicom/ui";
import { AppInput as BaseInput } from "@silvicom/ui";
import { AppFormField as FormField } from "@silvicom/ui";
import { BADGE_BASE, inviteTone } from "@/lib/badges";
import { useToastStore } from "@/stores/toast";
import { useSessionStore } from "@/stores/session";
import PageHeader from "@/components/ui/PageHeader.vue";

const toast = useToastStore();
const session = useSessionStore();

const invites = ref<Invite[]>([]);
const members = ref<OrgMember[]>([]);
const loading = ref(false);

const email = ref("");
const role = ref<UserRole>("dispatcher");
const submitting = ref(false);

// Email invites are for OFFICE roles only (DRIVER-CREDENTIALS-PLAN.md DC9): driver logins are
// company-issued from the Drivers page (username + one-time password), never via email.
const inviteRoleOptions = USER_ROLES.filter((r) => r !== "driver").map((r) => ({
  value: r,
  label: USER_ROLE_LABELS[r],
}));

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

interface InviteResult { emailSent: boolean; reason?: string | null; link?: string | null }

const REASON_TEXT: Record<string, string> = {
  mail_disabled: "Email isn't configured on the server.",
  send_failed: "The email provider rejected the message — check the verified sender in Brevo.",
  link_failed: "Couldn't create the invite — try again.",
};

/**
 * The accept link for the invite we just created or resent, held so the admin can hand it over
 * directly when email did not arrive.
 *
 * `deliverInvite` has returned this since the mailer was written and the response never carried it,
 * so the only recovery from a bounced or filtered invite was to resend into the same void. It is
 * shown ONLY when delivery failed: an invite that was emailed does not need a second copy of its
 * own credential on screen.
 */
const pendingLink = ref<{ email: string; link: string } | null>(null);
const linkCopied = ref(false);

async function copyPendingLink() {
  if (!pendingLink.value) return;
  try {
    await navigator.clipboard.writeText(pendingLink.value.link);
    linkCopied.value = true;
    setTimeout(() => (linkCopied.value = false), 2000);
  } catch {
    toast.error("Couldn't copy", "Select the link and copy it manually.");
  }
}

function handleInviteResult(addr: string, data: InviteResult | undefined) {
  if (data?.emailSent) {
    pendingLink.value = null;
    toast.success("Invitation emailed", addr);
    return;
  }
  pendingLink.value = data?.link ? { email: addr, link: data.link } : null;
  toast.error("Invitation not emailed", data?.reason ? (REASON_TEXT[data.reason] ?? data.reason) : undefined);
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

// Change an existing member's role. Backend guards against demoting the last admin. Reloads on cancel/error
// so the inline picker snaps back to the true value.
const roleOptions = USER_ROLES.map((r) => ({ value: r, label: USER_ROLE_LABELS[r] }));
async function changeRole(userId: string, newRole: string) {
  const m = members.value.find((x) => x.userId === userId);
  if (!m || m.role === newRole) return;
  if (userId === session.userId && newRole !== "admin" && !confirm("Change your own role? You may lose admin access after your next sign-in.")) {
    await load();
    return;
  }
  const res = await apiFetch(`/api/members/${userId}`, { method: "PATCH", body: { role: newRole } });
  if (res.ok) {
    toast.success("Role updated", `${m.email ?? userId} is now ${USER_ROLE_LABELS[newRole as UserRole]}`);
  } else {
    toast.error("Could not change role", res.error?.message);
  }
  await load();
}

// ── roles & permissions reference (from the shared section-capability matrix) ─────────────────
// Typed on AppSection, not Record<string, string>: the permissions table renders a column per
// APP_SECTIONS entry, so a section added without a label here used to render an empty heading. Now
// it does not compile.
const SECTION_LABELS: Record<AppSection, string> = { fuel: "Fuel", dispatch: "Dispatch", safety: "Safety", hazmat: "HazmatGuard", roster: "Roster", equipment: "Equipment", recruitment: "Recruitment", admin: "Admin", settings: "Settings", accounting: "Accounting", billing: "Billing", maintenance: "Maintenance" };
const showPerms = ref(false);
const permMatrix = computed(() =>
  USER_ROLES.map((r) => ({
    role: r as UserRole,
    label: USER_ROLE_LABELS[r],
    cells: APP_SECTIONS.map((s) => ({ section: s, access: sectionAccess(r, s) })),
  })),
);
const accessText = (a: string) => (a === "manage" ? "Manage" : a === "view" ? "View" : "—");
const accessCls = (a: string) => (a === "manage" ? "font-medium text-success-700" : a === "view" ? "text-ink-secondary" : "text-ink-tertiary");

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
  { key: "email", label: "Email", width: "xl" },
  { key: "role", label: "Role", width: "md", cellClass: "text-ink-secondary capitalize" },
  { key: "joinedAt", label: "Joined", width: "md", cellClass: "text-ink-muted" },
];

const inviteColumns: DataTableColumn[] = [
  { key: "email", label: "Email", width: "xl" },
  { key: "role", label: "Role", width: "md", cellClass: "text-ink-secondary capitalize" },
  { key: "status", label: "Status", width: "md" },
];

onMounted(load);
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Invite office users, manage roles, and review pending access." />
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
        :class="['mt-3 rounded-control p-3 text-sm ring-1', mailTest.ok ? 'bg-success-50 text-success-800 ring-success-200' : 'bg-danger-50 text-danger-800 ring-danger-200']"
      >
        <p v-if="mailTest.ok">Sent via {{ mailTest.provider }} to {{ mailTest.to }} — check your inbox.</p>
        <p v-else>
          {{ mailTest.provider }} rejected the message (status {{ mailTest.status ?? "—" }}):
          <span class="font-mono">{{ mailTest.detail ?? "no detail" }}</span>
          <br /><span class="text-xs">from: {{ mailTest.from }}</span>
        </p>
      </div>
      <form class="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end" @submit.prevent="invite">
        <FormField v-slot="{ id }" label="Email" class="flex-1">
          <BaseInput
            :id="id"
            v-model="email"
            type="email"
            required
            placeholder="name@silvicominc.com"
          />
        </FormField>
        <FormField label="Role">
          <AppSelect v-model="role" :options="inviteRoleOptions" />
        </FormField>
        <BaseButton variant="primary" type="submit" :disabled="submitting">
          {{ submitting ? "Sending…" : "Send invite" }}
        </BaseButton>
      </form>
      <div v-if="pendingLink" class="mt-4 rounded-control bg-warning-50 p-3 text-sm ring-1 ring-warning-200">
        <p class="font-medium text-warning-800">Email didn't go out — send this link to {{ pendingLink.email }} yourself</p>
        <p class="mt-1 text-xs text-warning-800">It sets their password and expires in 7 days. Treat it like a password.</p>
        <div class="mt-2 flex items-center gap-2">
          <code class="min-w-0 flex-1 truncate rounded-control bg-surface px-2 py-1.5 text-xs text-ink-secondary">{{ pendingLink.link }}</code>
          <BaseButton size="sm" @click="copyPendingLink">{{ linkCopied ? "Copied" : "Copy" }}</BaseButton>
        </div>
      </div>
      <p class="mt-2 text-xs text-ink-tertiary">
        Looking for drivers? Driver-app logins aren't invited by email — issue a username + password
        from the <RouterLink to="/drivers" class="text-brand-700 underline">Drivers page</RouterLink> (App access column).
      </p>
    </BaseCard>

    <section class="space-y-3">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 class="text-base font-semibold text-ink">Active members</h3>
        <div class="w-full sm:w-64">
          <SearchInput v-model="search" placeholder="Search members…" />
        </div>
      </div>

      <div v-if="selectedIds.size > 0" class="flex items-center justify-between rounded-surface bg-brand-50 px-4 py-2.5 text-sm ring-1 ring-brand-100">
        <span class="font-medium text-brand-800">{{ selectedIds.size }} selected</span>
        <div class="flex items-center gap-3">
          <BaseButton :disabled="bulkBusy" class="font-medium text-danger-600 hover:text-danger-500 disabled:opacity-50" @click="bulkRemove">Remove</BaseButton>
          <BaseButton class="font-medium text-ink-muted hover:text-ink-secondary" @click="selectedIds = new Set()">Clear</BaseButton>
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
        <template #cell-role="{ row }">
          <AppSelect :model-value="row.role" :options="roleOptions" @update:model-value="changeRole(row.userId, String($event))" />
        </template>
        <template #cell-joinedAt="{ row }">{{ new Date(row.joinedAt).toLocaleDateString() }}</template>
        <template #actions="{ row }">
          <KebabMenu v-if="row.userId !== session.userId">
            <BaseButton class="kebab-item kebab-item-danger" @click="removeMember(row.userId)">Remove member</BaseButton>
          </KebabMenu>
          <span v-else class="text-xs text-ink-tertiary">You</span>
        </template>
      </DataTable>
    </section>

    <section class="space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="text-base font-semibold text-ink">Roles &amp; permissions</h3>
        <BaseButton variant="ghost" size="sm" @click="showPerms = !showPerms">{{ showPerms ? "Hide" : "Show" }}</BaseButton>
      </div>
      <BaseCard v-if="showPerms" as="section">
        <p class="mb-3 text-sm text-ink-muted">What each role can access. <span class="font-medium text-success-700">Manage</span> = view + edit; View = read-only. Set a member's role in the table above.</p>
        <div class="overflow-x-auto">
          <AppTable class="min-w-full text-sm">
            <thead class="text-ink-muted">
              <tr>
                <th class="py-2 pr-4 text-left font-medium">Role</th>
                <th v-for="s in APP_SECTIONS" :key="s" class="px-3 py-2 text-center font-medium">{{ SECTION_LABELS[s] }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-edge-subtle">
              <tr v-for="prow in permMatrix" :key="prow.role">
                <td class="py-2 pr-4 font-medium text-ink">{{ prow.label }}</td>
                <td v-for="c in prow.cells" :key="c.section" class="px-3 py-2 text-center" :class="accessCls(c.access)">{{ accessText(c.access) }}</td>
              </tr>
            </tbody>
          </AppTable>
        </div>
      </BaseCard>
    </section>

    <section class="space-y-3">
      <h3 class="text-base font-semibold text-ink">Invitations</h3>
      <DataTable :columns="inviteColumns" :rows="invites" row-key="id" :loading="loading" empty-text="No invitations yet.">
        <template #cell-status="{ row }">
          <span :class="[BADGE_BASE, inviteTone(row.status), 'capitalize']">{{ row.status }}</span>
        </template>
        <template #actions="{ row }">
          <KebabMenu v-if="row.status === 'pending' || row.status === 'revoked' || row.status === 'expired'">
            <BaseButton v-if="row.status === 'pending'" class="kebab-item kebab-item-danger" @click="revoke(row.id)">Revoke invite</BaseButton>
            <BaseButton v-else class="kebab-item" @click="resend(row.id)">Resend invite</BaseButton>
          </KebabMenu>
        </template>
      </DataTable>
    </section>
  </div>
</template>
