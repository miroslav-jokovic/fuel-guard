<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { AppButton, AppCard, AppInput, AppPageHeader, AppSelect, AppTable, type SelectOption } from "@silvicom/ui";
import AppShell from "@/layouts/AppShell.vue";
import { apiGet, apiPost, ApiRequestError, type AlertRecipient } from "@/lib/api";
import { fmtDate } from "@/lib/format";

/**
 * Platform settings. First section: who hears a platform alarm (0427) — the nightly release's
 * outcome by email, and a failed or rolled-back release by text as well. Added and removed here,
 * without a deploy; scripts/release-notify.mjs reads the list at send time.
 */
const recipients = ref<AlertRecipient[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

const channel = ref<"sms" | "email">("sms");
const address = ref("");
const label = ref("");
const saving = ref(false);
const removing = ref<string | null>(null);

const CHANNELS: SelectOption[] = [
  { value: "sms", label: "Text message" },
  { value: "email", label: "Email" },
];

const texts = computed(() => recipients.value.filter((r) => r.channel === "sms"));
const emails = computed(() => recipients.value.filter((r) => r.channel === "email"));

/** What to tell the person about a refused change, from the API's own error code. */
function explain(e: unknown, fallback: string): string {
  if (e instanceof ApiRequestError) {
    if (e.code === "step_up_required") return "For this change, sign out and sign in again with your authenticator code, then retry.";
    if (e.status === 403) return "Only a platform owner or admin can change who is alerted.";
    if (e.detail) return e.detail;
  }
  return fallback;
}

async function load() {
  try {
    recipients.value = (await apiGet<{ recipients: AlertRecipient[] }>("/admin/alert-recipients")).recipients;
    error.value = null;
  } catch (e) {
    error.value = explain(e, "Could not load alert recipients");
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function add() {
  if (!address.value.trim()) return;
  saving.value = true;
  try {
    await apiPost("/admin/alert-recipients", { channel: channel.value, address: address.value, label: label.value || undefined });
    address.value = "";
    label.value = "";
    await load();
  } catch (e) {
    error.value = explain(e, "Could not add the recipient");
  } finally {
    saving.value = false;
  }
}

async function remove(r: AlertRecipient) {
  const last = r.channel === "sms" && texts.value.length === 1;
  const ask = last
    ? `Remove ${r.address}? It is the last phone on the list: a failed release at night will then reach nobody by text.`
    : `Remove ${r.address} from the alert list?`;
  if (!window.confirm(ask)) return;
  removing.value = r.id;
  try {
    await apiPost(`/admin/alert-recipients/${r.id}/remove`, {});
    await load();
  } catch (e) {
    error.value = explain(e, "Could not remove the recipient");
  } finally {
    removing.value = null;
  }
}
</script>

<template>
  <AppShell>
    <AppPageHeader title="Settings" description="Platform-wide settings. Changes apply at once and are recorded in the audit trail." />

    <AppCard class="mt-5">
      <h2 class="text-base font-semibold text-ink">Alert recipients</h2>
      <p class="mt-1 text-sm text-ink-secondary">
        Who hears about production releases. Everyone here gets an email for every release night. Phones also get a text
        when a release fails or is rolled back.
      </p>

      <form class="mt-4 flex flex-wrap items-end gap-3" @submit.prevent="add">
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
        <AppButton type="submit" variant="primary" :disabled="saving || !address.trim()">
          {{ saving ? "Adding…" : "Add" }}
        </AppButton>
      </form>
      <p v-if="error" class="mt-3 text-sm text-danger-600" role="alert">{{ error }}</p>
    </AppCard>

    <AppCard padding="none" class="mt-5">
      <div v-if="loading" class="p-6 text-sm text-ink-muted">Loading…</div>
      <AppTable v-else class="w-full text-sm">
        <thead class="bg-surface-subtle text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">
          <tr>
            <th class="px-4 py-2.5">Type</th>
            <th class="px-4 py-2.5">Address</th>
            <th class="px-4 py-2.5">Who</th>
            <th class="px-4 py-2.5">Added</th>
            <th class="px-4 py-2.5"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in [...texts, ...emails]" :key="r.id" class="border-t border-edge-subtle">
            <td class="px-4 py-2.5 text-ink-secondary">{{ r.channel === "sms" ? "Text" : "Email" }}</td>
            <td class="px-4 py-2.5 font-medium text-ink tabular-nums">{{ r.address }}</td>
            <td class="px-4 py-2.5 text-ink-secondary">{{ r.label ?? "—" }}</td>
            <td class="px-4 py-2.5 text-ink-secondary">{{ fmtDate(r.createdAt) }}</td>
            <td class="px-4 py-2.5 text-right">
              <AppButton size="sm" variant="ghost" :disabled="removing === r.id" @click="remove(r)">
                {{ removing === r.id ? "Removing…" : "Remove" }}
              </AppButton>
            </td>
          </tr>
          <tr v-if="recipients.length === 0">
            <td colspan="5" class="px-4 py-6 text-center text-ink-muted">
              No one on the list. Until someone is added, release alerts go to the addresses set in the repository's
              RELEASE_NOTIFY secrets.
            </td>
          </tr>
        </tbody>
      </AppTable>
    </AppCard>
  </AppShell>
</template>
