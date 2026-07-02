<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { MagnifyingGlassIcon } from "@heroicons/vue/20/solid";
import { USER_ROLES, type UserRole, type Invite, type OrgMember } from "@fuelguard/shared";
import { apiFetch } from "@/lib/api";
import AppSelect from "@/components/AppSelect.vue";
import KebabMenu from "@/components/KebabMenu.vue";
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

async function invite() {
  submitting.value = true;
  const res = await apiFetch<{ invite: Invite; emailSent: boolean }>("/api/invites", {
    method: "POST",
    body: { email: email.value, role: role.value },
  });
  if (res.ok) {
    if (res.data?.emailSent === false) {
      toast.error("Invite created but email delivery failed", "Check server logs or Supabase SMTP settings.");
    } else {
      toast.success("Invitation sent", email.value);
    }
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
  const res = await apiFetch<{ ok: boolean; emailSent: boolean }>(`/api/invites/${id}/resend`, { method: "POST" });
  if (res.ok) {
    if (res.data?.emailSent === false) {
      toast.error("Invite reset but email delivery failed", "Check Supabase SMTP settings in the dashboard.");
    } else {
      toast.success("Invitation resent", "A fresh link has been emailed to the recipient.");
    }
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
  <div class="space-y-8">
    <section class="rounded-lg bg-white p-6 shadow-sm ring-1 ring-gray-200">
      <h3 class="text-base font-semibold text-gray-900">Invite a user</h3>
      <p class="mt-1 text-sm text-gray-500">
        Only addresses on your organization's allowed domain can be invited.
      </p>
      <form class="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end" @submit.prevent="invite">
        <div class="flex-1">
          <label for="inv-email" class="block text-sm font-medium text-gray-900">Email</label>
          <input
            id="inv-email"
            v-model="email"
            type="email"
            required
            placeholder="name@silvicominc.com"
            class="mt-2 block w-full rounded-md border-0 px-3 py-1.5 text-gray-900 ring-1 ring-gray-300 ring-inset focus:ring-2 focus:ring-indigo-600 sm:text-sm"
          />
        </div>
        <div>
          <label for="inv-role" class="block text-sm font-medium text-gray-900">Role</label>
          <AppSelect
            v-model="role"
            class="mt-2"
            :options="USER_ROLES.map((r) => ({ value: r, label: r }))"
          />
        </div>
        <button
          type="submit"
          :disabled="submitting"
          class="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
        >
          {{ submitting ? "Sending…" : "Send invite" }}
        </button>
      </form>
    </section>

    <section class="rounded-lg bg-white shadow-sm ring-1 ring-gray-200">
      <div class="flex flex-col gap-3 border-b border-gray-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <h3 class="text-base font-semibold text-gray-900">Active members</h3>
        <div class="relative">
          <MagnifyingGlassIcon class="pointer-events-none absolute top-2.5 left-2.5 size-4 text-gray-400" />
          <input
            v-model="search"
            type="search"
            placeholder="Search members…"
            class="w-full rounded-md border-0 py-1.5 pr-3 pl-8 text-sm text-gray-900 ring-1 ring-gray-300 ring-inset focus:ring-2 focus:ring-indigo-600 sm:w-64"
          />
        </div>
      </div>

      <div v-if="selectedIds.size > 0" class="flex items-center justify-between bg-indigo-50 px-6 py-2.5 text-sm">
        <span class="font-medium text-indigo-900">{{ selectedIds.size }} selected</span>
        <div class="flex items-center gap-3">
          <button :disabled="bulkBusy" class="font-medium text-red-600 hover:text-red-500 disabled:opacity-50" @click="bulkRemove">Remove</button>
          <button class="font-medium text-gray-500 hover:text-gray-700" @click="selectedIds = new Set()">Clear</button>
        </div>
      </div>

      <div v-if="loading" class="px-6 py-8 text-sm text-gray-500">Loading…</div>
      <p v-else-if="filteredMembers.length === 0" class="px-6 py-8 text-sm text-gray-500">No members match.</p>
      <div v-else class="overflow-x-auto">
      <table class="min-w-full divide-y divide-gray-200 whitespace-nowrap text-sm">
        <thead>
          <tr class="text-left text-gray-500">
            <th class="w-10 px-4 py-3">
              <input type="checkbox" :checked="allChecked" class="size-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" @change="toggleAll" />
            </th>
            <th class="px-4 py-3 font-medium">Email</th>
            <th class="px-4 py-3 font-medium">Role</th>
            <th class="px-4 py-3 font-medium">Joined</th>
            <th class="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-for="m in filteredMembers" :key="m.userId" class="hover:bg-gray-50">
            <td class="px-4 py-3">
              <input
                v-if="m.userId !== session.userId"
                type="checkbox"
                :checked="selectedIds.has(m.userId)"
                class="size-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                @change="toggleRow(m.userId)"
              />
            </td>
            <td class="px-4 py-3 text-gray-900">{{ m.email ?? m.userId }}</td>
            <td class="px-4 py-3 text-gray-700 capitalize">{{ m.role }}</td>
            <td class="px-4 py-3 text-gray-500">{{ new Date(m.joinedAt).toLocaleDateString() }}</td>
            <td class="px-4 py-3 text-right">
              <KebabMenu v-if="m.userId !== session.userId">
                <button class="kebab-item kebab-item-danger" @click="removeMember(m.userId)">Remove member</button>
              </KebabMenu>
              <span v-else class="text-xs text-gray-400">You</span>
            </td>
          </tr>
        </tbody>
      </table>
      </div>
    </section>

    <section class="rounded-lg bg-white shadow-sm ring-1 ring-gray-200">
      <div class="border-b border-gray-200 px-6 py-4">
        <h3 class="text-base font-semibold text-gray-900">Invitations</h3>
      </div>
      <div v-if="loading" class="px-6 py-8 text-sm text-gray-500">Loading…</div>
      <p v-else-if="invites.length === 0" class="px-6 py-8 text-sm text-gray-500">
        No invitations yet.
      </p>
      <div v-else class="overflow-x-auto">
      <table class="min-w-full divide-y divide-gray-200 whitespace-nowrap text-sm">
        <thead>
          <tr class="text-left text-gray-500">
            <th class="px-6 py-3 font-medium">Email</th>
            <th class="px-6 py-3 font-medium">Role</th>
            <th class="px-6 py-3 font-medium">Status</th>
            <th class="px-6 py-3"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-for="inv in invites" :key="inv.id" class="hover:bg-gray-50">
            <td class="px-6 py-3 text-gray-900">{{ inv.email }}</td>
            <td class="px-6 py-3 text-gray-700 capitalize">{{ inv.role }}</td>
            <td class="px-6 py-3"><span :class="[BADGE_BASE, inviteTone(inv.status)]">{{ inv.status }}</span></td>
            <td class="px-6 py-3 text-right">
              <KebabMenu v-if="inv.status === 'pending' || inv.status === 'revoked' || inv.status === 'expired'">
                <button v-if="inv.status === 'pending'" class="kebab-item kebab-item-danger" @click="revoke(inv.id)">Revoke invite</button>
                <button v-else class="kebab-item" @click="resend(inv.id)">Resend invite</button>
              </KebabMenu>
            </td>
          </tr>
        </tbody>
      </table>
      </div>
    </section>
  </div>
</template>
