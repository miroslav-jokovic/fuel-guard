<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { orgSettingsFormSchema, type OrgSettingsForm } from "@fuelguard/shared";
import { useOrgSettingsQuery, useSaveOrgSettings } from "@/features/settings/useOrgSettings";
import { useToastStore } from "@/stores/toast";

const { data, isLoading } = useOrgSettingsQuery();
const save = useSaveOrgSettings();

const form = reactive({
  name: "",
  allowedDomains: "",
  open24_7: false,
  start: "05:00",
  end: "20:00",
  tz: "America/Chicago",
  notifications_enabled: true,
  emails: "",
});

watch(
  data,
  (o) => {
    if (!o) return;
    form.name = o.name;
    form.allowedDomains = (o.allowed_domains ?? []).join(", ");
    const oStart = o.operating_hours?.start ?? "05:00";
    const oEnd = o.operating_hours?.end ?? "20:00";
    form.open24_7 = oStart === oEnd; // start === end is our "24/7" encoding
    form.start = form.open24_7 ? "05:00" : oStart; // keep sensible values behind the toggle
    form.end = form.open24_7 ? "20:00" : oEnd;
    form.tz = o.operating_hours?.tz ?? "America/Chicago";
    form.notifications_enabled = o.notifications_enabled;
    form.emails = (o.notification_emails ?? []).join(", ");
  },
  { immediate: true },
);

const toast = useToastStore();
const fieldErr = ref<Record<string, string>>({});

async function onSave() {
  const emails = form.emails.split(/[,\s]+/).map((e) => e.trim()).filter(Boolean);
  const domains = form.allowedDomains.split(/[,\s]+/).map((d) => d.trim().toLowerCase()).filter(Boolean);
  const result = orgSettingsFormSchema.safeParse({
    name: form.name,
    allowed_domains: domains,
    // 24/7 is encoded as start === end (the off-hours rule then never fires).
    operating_hours: form.open24_7 ? { start: "00:00", end: "00:00", tz: form.tz } : { start: form.start, end: form.end, tz: form.tz },
    notifications_enabled: form.notifications_enabled,
    notification_emails: emails,
  });
  if (!result.success) {
    const m: Record<string, string> = {};
    for (const i of result.error.issues) {
      const k = i.path.join(".");
      if (!m[k]) m[k] = i.message;
    }
    fieldErr.value = m;
    return;
  }
  fieldErr.value = {};
  try {
    await save.mutateAsync(result.data as OrgSettingsForm);
    toast.success("Settings saved");
  } catch (e) {
    toast.error("Could not save settings", e instanceof Error ? e.message : undefined);
  }
}

const input = "mt-1 block w-full rounded-md border-0 px-3 py-1.5 text-gray-900 ring-1 ring-gray-300 ring-inset focus:ring-2 focus:ring-indigo-600 sm:text-sm";
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-6">
    <div v-if="isLoading" class="text-sm text-gray-500">Loading…</div>
    <form v-else class="space-y-6" @submit.prevent="onSave">
      <section class="rounded-lg bg-white p-6 shadow-sm ring-1 ring-gray-200">
        <h3 class="text-base font-semibold text-gray-900">Organization</h3>
        <div class="mt-4">
          <label class="block text-sm font-medium text-gray-900">Name</label>
          <input v-model="form.name" :class="input" />
          <p v-if="fieldErr.name" class="mt-1 text-xs text-red-600">{{ fieldErr.name }}</p>
        </div>
        <div class="mt-4">
          <label class="block text-sm font-medium text-gray-900">Allowed email domains (comma-separated)</label>
          <input
            v-model="form.allowedDomains"
            placeholder="silvicominc.com, example.com — leave blank to allow any domain"
            :class="input"
          />
          <p class="mt-1 text-xs text-gray-500">Only emails from these domains can be invited. Leave empty to allow any domain.</p>
        </div>
      </section>

      <section class="rounded-lg bg-white p-6 shadow-sm ring-1 ring-gray-200">
        <h3 class="text-base font-semibold text-gray-900">Operating hours</h3>
        <p class="mt-1 text-xs text-gray-500">Used by the off-hours anomaly rule. Turn on 24/7 if the fleet runs around the clock — the rule then never flags a fill for its time of day.</p>
        <label class="mt-4 flex items-center gap-2 text-sm font-medium text-gray-900">
          <input v-model="form.open24_7" type="checkbox" class="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600" />
          Open 24/7 (no off-hours)
        </label>
        <div class="mt-4 grid grid-cols-3 gap-4" :class="form.open24_7 ? 'opacity-50' : ''">
          <div>
            <label class="block text-sm font-medium text-gray-900">Start</label>
            <input v-model="form.start" :disabled="form.open24_7" placeholder="05:00" :class="input" />
            <p v-if="fieldErr['operating_hours.start']" class="mt-1 text-xs text-red-600">{{ fieldErr['operating_hours.start'] }}</p>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-900">End</label>
            <input v-model="form.end" :disabled="form.open24_7" placeholder="20:00" :class="input" />
            <p v-if="fieldErr['operating_hours.end']" class="mt-1 text-xs text-red-600">{{ fieldErr['operating_hours.end'] }}</p>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-900">Timezone</label>
            <input v-model="form.tz" placeholder="America/Chicago" :class="input" />
          </div>
        </div>
      </section>

      <p class="text-xs text-gray-500">
        Looking for alert recipients? They now live in
        <RouterLink to="/settings/notifications" class="font-medium text-indigo-600 hover:text-indigo-500">Settings → Notifications</RouterLink>.
      </p>

      <div class="flex items-center gap-3">
        <button type="submit" :disabled="save.isPending.value" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
          {{ save.isPending.value ? "Saving…" : "Save settings" }}
        </button>
      </div>
    </form>
  </div>
</template>
