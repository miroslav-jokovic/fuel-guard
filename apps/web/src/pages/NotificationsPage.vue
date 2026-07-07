<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import { orgSettingsFormSchema, type OrgSettingsForm } from "@fuelguard/shared";
import { useOrgSettingsQuery, useSaveOrgSettings } from "@/features/settings/useOrgSettings";
import { useToastStore } from "@/stores/toast";

const { data, isLoading } = useOrgSettingsQuery();
const save = useSaveOrgSettings();

const form = reactive({
  notifications_enabled: true,
  emails: "",
});

watch(
  data,
  (o) => {
    if (!o) return;
    form.notifications_enabled = o.notifications_enabled;
    form.emails = (o.notification_emails ?? []).join(", ");
  },
  { immediate: true },
);

const toast = useToastStore();
const fieldErr = ref<Record<string, string>>({});

async function onSave() {
  const o = data.value;
  if (!o) return;
  const emails = form.emails.split(/[,\s]+/).map((e) => e.trim()).filter(Boolean);
  // Pass the org's other settings through unchanged — this page only edits the notification fields.
  const result = orgSettingsFormSchema.safeParse({
    name: o.name,
    allowed_domains: o.allowed_domains ?? [],
    operating_hours: o.operating_hours,
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
    toast.success("Notification settings saved");
  } catch (e) {
    toast.error("Could not save notifications", e instanceof Error ? e.message : undefined);
  }
}

const input = "mt-1 block w-full rounded-md border-0 px-3 py-1.5 text-gray-900 ring-1 ring-gray-300 ring-inset focus:ring-2 focus:ring-indigo-600 sm:text-sm";
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-6">
    <div v-if="isLoading" class="text-sm text-gray-500">Loading…</div>
    <form v-else class="space-y-6" @submit.prevent="onSave">
      <section class="rounded-lg bg-white p-6 shadow-sm ring-1 ring-gray-200">
        <h3 class="text-base font-semibold text-gray-900">Anomaly alerts</h3>
        <p class="mt-1 text-xs text-gray-500">
          Who gets emailed when the detection engine flags a high or critical anomaly.
        </p>
        <label class="mt-4 flex items-center gap-2 text-sm text-gray-700">
          <input v-model="form.notifications_enabled" type="checkbox" class="rounded border-gray-300" />
          Email recipients when high/critical anomalies are detected
        </label>
        <div class="mt-4">
          <label class="block text-sm font-medium text-gray-900">Recipient emails (comma-separated)</label>
          <input
            v-model="form.emails"
            :disabled="!form.notifications_enabled"
            placeholder="ops@silvicominc.com, manager@silvicominc.com"
            :class="[input, !form.notifications_enabled && 'opacity-50']"
          />
          <p v-if="fieldErr['notification_emails.0'] || fieldErr['notification_emails']" class="mt-1 text-xs text-red-600">
            One or more emails are invalid.
          </p>
          <p v-else class="mt-1 text-xs text-gray-500">Each address must be a valid email. Leave blank to send to no one.</p>
        </div>
      </section>

      <div class="flex items-center gap-3">
        <button type="submit" :disabled="save.isPending.value" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
          {{ save.isPending.value ? "Saving…" : "Save notifications" }}
        </button>
      </div>
    </form>
  </div>
</template>
