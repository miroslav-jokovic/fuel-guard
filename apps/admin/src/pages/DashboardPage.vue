<script setup lang="ts">
import { ref, onMounted } from "vue";
import { AppCard } from "@fuelguard/ui";
import { supabase, ADMIN_API_URL } from "@/lib/supabase";
import AppShell from "@/layouts/AppShell.vue";

// End-to-end proof of the gate: call admin-api /admin/me with the current aal2 token.
const me = ref<{ email: string; role: string } | null>(null);
const meError = ref<string | null>(null);

onMounted(async () => {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    const res = await fetch(`${ADMIN_API_URL}/admin/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      meError.value = `admin-api returned ${res.status}`;
      return;
    }
    me.value = (await res.json()) as { email: string; role: string };
  } catch (e) {
    meError.value = e instanceof Error ? e.message : "Could not reach admin-api";
  }
});
</script>

<template>
  <AppShell>
    <h1 class="text-xl font-semibold text-ink">Overview</h1>
    <p class="mt-1 text-sm text-ink-muted">
      Phase 0 shell. Modules land here as later phases ship (customers, billing, backups, errors, audit).
    </p>

    <AppCard class="mt-5">
      <h2 class="text-sm font-semibold text-ink-secondary">Platform session</h2>
      <dl class="mt-3 space-y-1 text-sm">
        <div class="flex gap-2">
          <dt class="w-28 text-ink-muted">admin-api</dt>
          <dd class="text-ink">
            <span v-if="me" class="text-success-700">connected · {{ me.role }}</span>
            <span v-else-if="meError" class="text-danger-600">{{ meError }}</span>
            <span v-else class="text-ink-muted">checking…</span>
          </dd>
        </div>
        <div v-if="me" class="flex gap-2">
          <dt class="w-28 text-ink-muted">Signed in as</dt>
          <dd class="text-ink">{{ me.email }}</dd>
        </div>
      </dl>
    </AppCard>
  </AppShell>
</template>
