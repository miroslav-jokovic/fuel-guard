<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { USER_ROLES, USER_ROLE_LABELS, type UserRole, type Invite, type OrgMember } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { AppSelect } from "@silvicom/ui";
import KebabMenu from "@/components/KebabMenu.vue";
import { AppSearchField as SearchInput } from "@silvicom/ui";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import { AppCard as BaseCard } from "@silvicom/ui";
import { AppButton as BaseButton } from "@silvicom/ui";
import { AppInput as BaseInput } from "@silvicom/ui";
import { AppFormField as FormField } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
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
const inviteName = ref("");
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

interface InviteResult { emailSent: boolean; reason?: string | null; link?: string | null; rotated?: boolean }

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
    // A resend rotates the link (2026-09-04). Said here because two identical-looking emails with one
    // dead link is how an invitation was lost: the admin is the one who can tell the person which.
    toast.success(
      data.rotated ? "New invitation emailed" : "Invitation emailed",
      data.rotated ? `${addr} — the earlier link no longer works.` : addr,
    );
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
  const res = await apiFetch<InviteResult>("/api/invites", {
    method: "POST",
    body: { email: addr, role: role.value, fullName: inviteName.value.trim() },
  });
  if (res.ok) {
    handleInviteResult(addr, res.data);
    email.value = "";
    inviteName.value = "";
    role.value = "dispatcher";
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

async function remove(id: string) {
  const inv = invites.value.find((i) => i.id === id);
  // window.confirm, matching the destructive-action precedent on the pages beside this one. The
  // email is in the sentence because the row it names is about to stop being on screen.
  if (!confirm(`Delete the invitation for ${inv?.email ?? "this address"}? The audit log keeps a record.`)) return;
  const res = await apiFetch(`/api/invites/${id}`, { method: "DELETE" });
  if (res.ok) {
    toast.success("Invitation deleted");
    await load();
  } else {
    toast.error("Could not delete invitation", res.error?.message);
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

/**
 * Rename a member (0301). A drawer rather than an inline cell: a name is typed once and confirmed,
 * not toggled, and the drawer can say what the roster does for a driver (D-MEM3) where a cell could not.
 */
const renaming = ref<OrgMember | null>(null);
const renameValue = ref("");
const renameBusy = ref(false);
function openRename(m: OrgMember) {
  renaming.value = m;
  renameValue.value = m.fullName ?? "";
}
async function saveRename() {
  const m = renaming.value;
  const name = renameValue.value.trim();
  if (!m || name.length === 0) return;
  renameBusy.value = true;
  const res = await apiFetch(`/api/members/${m.userId}`, { method: "PATCH", body: { fullName: name } });
  renameBusy.value = false;
  if (res.ok) {
    toast.success("Name updated", `${m.email ?? m.userId} is now ${name}`);
    renaming.value = null;
    await load();
  } else {
    toast.error("Could not update name", res.error?.message);
  }
}
// ── search + multi-select (members) ─────────────────────────────────────────
const search = ref("");
const filteredMembers = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return members.value;
  return members.value.filter(
    (m) =>
      (m.fullName ?? "").toLowerCase().includes(q) ||
      (m.email ?? m.userId).toLowerCase().includes(q) ||
      m.role.toLowerCase().includes(q),
  );
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
  { key: "fullName", label: "Name", width: "lg" },
  { key: "email", label: "Email", width: "xl" },
  { key: "role", label: "Role", width: "md", cellClass: "text-ink-secondary capitalize" },
  { key: "joinedAt", label: "Joined", width: "md", cellClass: "text-ink-muted" },
];

const inviteColumns: DataTableColumn[] = [
  { key: "full_name", label: "Name", width: "lg" },
  { key: "email", label: "Email", width: "xl" },
  { key: "role", label: "Role", width: "md", cellClass: "text-ink-secondary" },
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
        <FormField v-slot="{ id }" label="Name" class="flex-1">
          <BaseInput :id="id" v-model="inviteName" type="text" required maxlength="120" placeholder="Jane Dispatcher" autocomplete="off" />
        </FormField>
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
        <template #cell-fullName="{ row }">
          <span v-if="row.fullName" class="font-medium text-ink">{{ row.fullName }}</span>
          <span v-else class="text-ink-tertiary">No name yet</span>
        </template>
        <template #cell-email="{ row }">{{ row.email ?? row.userId }}</template>
        <template #cell-role="{ row }">
          <AppSelect :model-value="row.role" :options="roleOptions" @update:model-value="changeRole(row.userId, String($event))" />
        </template>
        <template #cell-joinedAt="{ row }">{{ new Date(row.joinedAt).toLocaleDateString() }}</template>
        <template #actions="{ row }">
          <KebabMenu>
            <BaseButton class="kebab-item" @click="openRename(row)">{{ row.fullName ? "Edit name" : "Add name" }}</BaseButton>
            <BaseButton v-if="row.userId !== session.userId" class="kebab-item kebab-item-danger" @click="removeMember(row.userId)">Remove member</BaseButton>
          </KebabMenu>
        </template>
      </DataTable>
    </section>

    <!-- The matrix itself moved to /settings/permissions (P0): it was collapsed behind a toggle at
         the foot of this page, which is why the product read as having no permissions surface. It is
         rendered in exactly one place now — a second copy here would be the restated fact the
         no-workarounds rule names. -->
    <section class="space-y-3">
      <h3 class="text-base font-semibold text-ink">Roles &amp; permissions</h3>
      <BaseCard as="section">
        <p class="text-sm text-ink-muted">
          Access follows a member's role. See what each role can reach, and what a given member sees
          in the sidebar, on the
          <RouterLink to="/settings/permissions" class="text-brand-700 underline">Permissions page</RouterLink>.
        </p>
      </BaseCard>
    </section>

    <SlideOver
      :open="renaming !== null"
      :title="renaming?.fullName ? 'Edit name' : 'Add name'"
      :description="renaming?.email ?? undefined"
      @close="renaming = null"
    >
      <form id="rename-member" class="space-y-4" @submit.prevent="saveRename">
        <FormField
          v-slot="{ id }"
          label="Name"
          :hint="renaming?.role === 'driver' ? 'A driver is named by the roster until you set a name here; the roster row itself is edited on the Drivers page.' : 'How this person appears across Silvicom 360.'"
        >
          <BaseInput :id="id" v-model="renameValue" type="text" required maxlength="120" autocomplete="off" />
        </FormField>
      </form>
      <template #footer>
        <div class="flex items-center justify-end gap-3">
          <BaseButton :disabled="renameBusy" @click="renaming = null">Cancel</BaseButton>
          <BaseButton variant="primary" type="submit" form="rename-member" :disabled="renameBusy || renameValue.trim().length === 0">
            {{ renameBusy ? "Saving…" : "Save name" }}
          </BaseButton>
        </div>
      </template>
    </SlideOver>

    <section class="space-y-3">
      <h3 class="text-base font-semibold text-ink">Invitations</h3>
      <DataTable :columns="inviteColumns" :rows="invites" row-key="id" :loading="loading" empty-text="No invitations yet.">
        <template #cell-full_name="{ row }">
          <span v-if="row.full_name" class="font-medium text-ink">{{ row.full_name }}</span>
          <span v-else class="text-ink-tertiary">Not given</span>
        </template>
        <template #cell-role="{ row }">{{ USER_ROLE_LABELS[row.role as UserRole] ?? row.role }}</template>
        <template #cell-status="{ row }">
          <span :class="[BADGE_BASE, inviteTone(row.status), 'capitalize']">{{ row.status }}</span>
        </template>
        <template #actions="{ row }">
          <KebabMenu v-if="row.status === 'pending' || row.status === 'revoked' || row.status === 'expired'">
            <BaseButton v-if="row.status === 'pending'" class="kebab-item kebab-item-danger" @click="revoke(row.id)">Revoke invite</BaseButton>
            <template v-else>
              <BaseButton class="kebab-item" @click="resend(row.id)">Resend invite</BaseButton>
              <BaseButton class="kebab-item kebab-item-danger" @click="remove(row.id)">Delete invite</BaseButton>
            </template>
          </KebabMenu>
        </template>
      </DataTable>
    </section>
  </div>
</template>
