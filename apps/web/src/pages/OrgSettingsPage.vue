<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import { orgSettingsFormSchema, type OrgSettingsForm } from "@fleetguard/shared";
import { useOrgSettingsQuery, useSaveOrgSettings } from "@/features/settings/useOrgSettings";
import { useToastStore } from "@/stores/toast";

const { data, isLoading } = useOrgSettingsQuery();
const save = useSaveOrgSettings();

const form = reactive({
  name: "",
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
    form.start = o.operating_hours?.start ?? "05:00";
    form.end = o.operating_hours?.end ?? "20:00";
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
  const result = orgSettingsFormSchema.safeParse({
    name: form.name,
    operating_hours: { start: form.start, end: form.end, tz: form.tz },
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
      </section>

      <section class="rounded-lg bg-white p-6 shadow-sm ring-1 ring-gray-200">
        <h3 class="text-base font-semibold text-gray-900">Operating hours</h3>
        <p class="mt-1 text-xs text-gray-500">Used by the off-hours anomaly rule.</p>
        <div class="mt-4 grid grid-cols-3 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-900">Start</label>
            <input v-model="form.start" placeholder="05:00" :class="input" />
            <p v-if="fieldErr['operating_hours.start']" class="mt-1 text-xs text-red-600">{{ fieldErr['operating_hours.start'] }}</p>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-900">End</label>
            <input v-model="form.end" placeholder="20:00" :class="input" />
            <p v-if="fieldErr['operating_hours.end']" class="mt-1 text-xs text-red-600">{{ fieldErr['operating_hours.end'] }}</p>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-900">Timezone</label>
            <input v-model="form.tz" placeholder="America/Chicago" :class="input" />
          </div>
        </div>
      </section>

      <section class="rounded-lg bg-white p-6 shadow-sm ring-1 ring-gray-200">
        <h3 class="text-base font-semibold text-gray-900">Notifications</h3>
        <label class="mt-3 flex items-center gap-2 text-sm text-gray-700">
          <input v-model="form.notifications_enabled" type="checkbox" class="rounded border-gray-300" />
          Email recipients when high/critical anomalies are detected
        </label>
        <div class="mt-4">
          <label class="block text-sm font-medium text-gray-900">Recipient emails (comma-separated)</label>
          <input v-model="form.emails" placeholder="ops@silvicominc.com, manager@silvicominc.com" :class="input" />
          <p v-if="fieldErr['notification_emails.0'] || fieldErr['notification_emails']" class="mt-1 text-xs text-red-600">
            One or more emails are invalid.
          </p>
        </div>
      </section>

      <div class="flex items-center gap-3">
        <button type="submit" :disabled="save.isPending.value" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
          {{ save.isPending.value ? "Saving…" : "Save settings" }}
        </button>
      </div>
    </form>
  </div>
</template>
