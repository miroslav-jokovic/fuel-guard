<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import { RouterLink } from "vue-router";
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
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-6">
    <div v-if="isLoading" class="text-sm text-ink-muted">Loading…</div>
    <form v-else class="space-y-6" @submit.prevent="onSave">
      <BaseCard as="section">
        <h3 class="text-base font-semibold text-ink">Organization</h3>
        <FormField class="mt-4" label="Name" :error="fieldErr.name" v-slot="{ id }">
          <BaseInput :id="id" v-model="form.name" :invalid="Boolean(fieldErr.name)" />
        </FormField>
        <FormField
          class="mt-4"
          label="Allowed email domains (comma-separated)"
          hint="Only emails from these domains can be invited. Leave empty to allow any domain."
          v-slot="{ id }"
        >
          <BaseInput
            :id="id"
            v-model="form.allowedDomains"
            placeholder="silvicominc.com, example.com — leave blank to allow any domain"
          />
        </FormField>
      </BaseCard>

      <BaseCard as="section">
        <h3 class="text-base font-semibold text-ink">Operating hours</h3>
        <p class="mt-1 text-xs text-ink-muted">Used by the off-hours anomaly rule. Turn on 24/7 if the fleet runs around the clock — the rule then never flags a fill for its time of day.</p>
        <div class="mt-4">
          <BaseCheckbox v-model="form.open24_7">Open 24/7 (no off-hours)</BaseCheckbox>
        </div>
        <div class="mt-4 grid grid-cols-3 gap-4" :class="form.open24_7 ? 'opacity-50' : ''">
          <FormField label="Start" :error="fieldErr['operating_hours.start']" v-slot="{ id }">
            <BaseInput :id="id" v-model="form.start" :disabled="form.open24_7" placeholder="05:00" :invalid="Boolean(fieldErr['operating_hours.start'])" />
          </FormField>
          <FormField label="End" :error="fieldErr['operating_hours.end']" v-slot="{ id }">
            <BaseInput :id="id" v-model="form.end" :disabled="form.open24_7" placeholder="20:00" :invalid="Boolean(fieldErr['operating_hours.end'])" />
          </FormField>
          <FormField label="Timezone" v-slot="{ id }">
            <BaseInput :id="id" v-model="form.tz" placeholder="America/Chicago" />
          </FormField>
        </div>
      </BaseCard>

      <p class="text-xs text-ink-muted">
        Looking for alert recipients? They now live in
        <RouterLink to="/settings/notifications" class="font-medium text-brand-600 hover:text-brand-500">Settings → Notifications</RouterLink>.
      </p>

      <div class="flex items-center gap-3">
        <BaseButton variant="primary" type="submit" :disabled="save.isPending.value">
          {{ save.isPending.value ? "Saving…" : "Save settings" }}
        </BaseButton>
      </div>
    </form>
  </div>
</template>
