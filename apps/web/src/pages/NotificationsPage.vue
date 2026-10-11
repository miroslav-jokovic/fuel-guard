<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import { orgNotificationsFormSchema } from "@silvicom/shared";
import { useOrgSettingsQuery, useSaveOrgNotifications } from "@/composables/useOrgSettings";
import { useToastStore } from "@/stores/toast";
import { AppButton as BaseButton } from "@silvicom/ui";
import { AppCard as BaseCard } from "@silvicom/ui";
import { AppCheckbox as BaseCheckbox } from "@silvicom/ui";
import { AppInput as BaseInput } from "@silvicom/ui";
import { AppFormField as FormField } from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";

const { data, isLoading } = useOrgSettingsQuery();
const save = useSaveOrgNotifications();

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
  if (!data.value) return;
  const emails = form.emails.split(/[,\s]+/).map((e) => e.trim()).filter(Boolean);
  // Only this page's two fields go (SP2). It used to send the whole row, passing the rest "through
  // unchanged" — except the DOT number and the address, which it left out and the save then nulled.
  const result = orgNotificationsFormSchema.safeParse({
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
    await save.mutateAsync(result.data);
    toast.success("Notification settings saved");
  } catch (e) {
    toast.error("Could not save notifications", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-6">
    <PageHeader description="Turn the carrier's alerts on or off, and choose who is emailed." />
    <div v-if="isLoading" class="text-sm text-ink-muted">Loading…</div>
    <form v-else class="space-y-6" @submit.prevent="onSave">
      <BaseCard as="section">
        <!-- Q-AW52 (owner, 2026-09-29): this ONE switch (`organizations.notifications_enabled`) is read by
             every carrier alert, not only the anomaly emails it used to name — so turning it off to stop
             those silenced the rest without saying so. The list is each reader of the column in
             apps/api (grep `notifications_enabled`); a new reader adds its line here. -->
        <h3 class="text-base font-semibold text-ink">The carrier's alerts</h3>
        <p class="mt-1 text-xs text-ink-muted">
          One switch for all of them. Off, none of these is sent: high and critical anomalies, drivers who
          stopped part-way through an application, driver qualification expirations, the weekly digest,
          fuel and finance data that has stopped arriving, a stalled Samsara feed and its fuel events, and
          an EFS certificate about to expire. An EFS certificate that has already expired is emailed even
          when this is off, because the EFS connection stops working with it.
        </p>
        <div class="mt-4">
          <BaseCheckbox v-model="form.notifications_enabled">
            Send the carrier's alerts
          </BaseCheckbox>
        </div>
        <FormField
          v-slot="{ id }"
          class="mt-4"
          label="Recipient emails (comma-separated)"
          :error="fieldErr['notification_emails.0'] || fieldErr['notification_emails'] ? 'One or more emails are invalid.' : undefined"
          hint="Each address must be a valid email. Leave blank to send to no one."
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
