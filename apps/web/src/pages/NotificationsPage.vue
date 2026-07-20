<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import { orgSettingsFormSchema, type OrgSettingsForm } from "@fuelguard/shared";
import { useOrgSettingsQuery, useSaveOrgSettings } from "@/composables/useOrgSettings";
import { useToastStore } from "@/stores/toast";
import BaseButton from "@/components/ui/BaseButton.vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import BaseCheckbox from "@/components/ui/BaseCheckbox.vue";
import BaseInput from "@/components/ui/BaseInput.vue";
import FormField from "@/components/ui/FormField.vue";

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
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-6">
    <div v-if="isLoading" class="text-sm text-ink-muted">Loading…</div>
    <form v-else class="space-y-6" @submit.prevent="onSave">
      <BaseCard as="section">
        <h3 class="text-base font-semibold text-ink">Anomaly alerts</h3>
        <p class="mt-1 text-xs text-ink-muted">
          Who gets emailed when the detection engine flags a high or critical anomaly.
        </p>
        <div class="mt-4">
          <BaseCheckbox v-model="form.notifications_enabled">
            Email recipients when high/critical anomalies are detected
          </BaseCheckbox>
        </div>
        <FormField
          class="mt-4"
          label="Recipient emails (comma-separated)"
          :error="fieldErr['notification_emails.0'] || fieldErr['notification_emails'] ? 'One or more emails are invalid.' : undefined"
          hint="Each address must be a valid email. Leave blank to send to no one."
          v-slot="{ id }"
        >
          <BaseInput
            :id="id"
            v-model="form.emails"
            :disabled="!form.notifications_enabled"
            placeholder="ops@silvicominc.com, manager@silvicominc.com"
            :invalid="Boolean(fieldErr['notification_emails.0'] || fieldErr['notification_emails'])"
          />
        </FormField>
      </BaseCard>

      <div class="flex items-center gap-3">
        <BaseButton variant="primary" type="submit" :disabled="save.isPending.value">
          {{ save.isPending.value ? "Saving…" : "Save notifications" }}
        </BaseButton>
      </div>
    </form>
  </div>
</template>
