<script setup lang="ts">
import { ref, onMounted } from "vue";
import { USER_ROLES, type UserRole, type Invite } from "@fleetguard/shared";
import { apiFetch } from "@/lib/api";
import AppSelect from "@/components/AppSelect.vue";
import { useToastStore } from "@/stores/toast";

const toast = useToastStore();
const invites = ref<Invite[]>([]);
const loading = ref(false);

const email = ref("");
const role = ref<UserRole>("driver");
const submitting = ref(false);

async function load() {
  loading.value = true;
  const res = await apiFetch<{ invites: Invite[] }>("/api/invites");
  if (res.ok && res.data) invites.value = res.data.invites;
  else toast.error("Could not load invitations", res.error?.message);
  loading.value = false;
}

async function invite() {
  submitting.value = true;
  const res = await apiFetch<{ invite: Invite }>("/api/invites", {
    method: "POST",
    body: { email: email.value, role: role.value },
  });
  if (res.ok) {
    toast.success("Invitation sent", email.value);
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
      <div class="border-b border-gray-200 px-6 py-4">
        <h3 class="text-base font-semibold text-gray-900">Invitations</h3>
      </div>
      <div v-if="loading" class="px-6 py-8 text-sm text-gray-500">Loading…</div>
      <p v-else-if="invites.length === 0" class="px-6 py-8 text-sm text-gray-500">
        No invitations yet.
      </p>
      <table v-else class="min-w-full divide-y divide-gray-200 text-sm">
        <thead>
          <tr class="text-left text-gray-500">
            <th class="px-6 py-3 font-medium">Email</th>
            <th class="px-6 py-3 font-medium">Role</th>
            <th class="px-6 py-3 font-medium">Status</th>
            <th class="px-6 py-3"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-for="inv in invites" :key="inv.id">
            <td class="px-6 py-3 text-gray-900">{{ inv.email }}</td>
            <td class="px-6 py-3 text-gray-700">{{ inv.role }}</td>
            <td class="px-6 py-3">
              <span
                :class="[
                  'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
                  inv.status === 'pending'
                    ? 'bg-amber-100 text-amber-800'
                    : inv.status === 'accepted'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-gray-100 text-gray-600',
                ]"
                >{{ inv.status }}</span
              >
            </td>
            <td class="px-6 py-3 text-right">
              <button
                v-if="inv.status === 'pending'"
                class="text-sm font-medium text-red-600 hover:text-red-500"
                @click="revoke(inv.id)"
              >
                Revoke
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>
