<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { orgSettingsFormSchema, type OrgSettingsForm } from "@silvicom/shared";
import { useOrgSettingsQuery, useSaveOrgSettings } from "@/composables/useOrgSettings";
import { useToastStore } from "@/stores/toast";
import { AppButton as BaseButton } from "@silvicom/ui";
import { AppCard as BaseCard } from "@silvicom/ui";
import { AppCheckbox as BaseCheckbox } from "@silvicom/ui";
import { AppInput as BaseInput } from "@silvicom/ui";
import { AppFormField as FormField } from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";

const { data, isLoading } = useOrgSettingsQuery();
const save = useSaveOrgSettings();

const form = reactive({
  name: "",
  dotNumber: "",
  addressLine1: "",
  city: "",
  state: "",
  postalCode: "",
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
    form.dotNumber = o.dot_number ?? "";
    form.addressLine1 = o.address_line1 ?? "";
    form.city = o.city ?? "";
    form.state = o.state ?? "";
    form.postalCode = o.postal_code ?? "";
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
  const emails = form.emails
    .split(/[,\s]+/)
    .map((e) => e.trim())
    .filter(Boolean);
  const domains = form.allowedDomains
    .split(/[,\s]+/)
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  const result = orgSettingsFormSchema.safeParse({
    name: form.name,
    dot_number: form.dotNumber.trim(),
    address_line1: form.addressLine1.trim(),
    city: form.city.trim(),
    state: form.state.trim(),
    postal_code: form.postalCode.trim(),
    allowed_domains: domains,
    // 24/7 is encoded as start === end (the off-hours rule then never fires).
    operating_hours: form.open24_7
      ? { start: "00:00", end: "00:00", tz: form.tz }
      : { start: form.start, end: form.end, tz: form.tz },
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
    <PageHeader description="Manage organization identity, access domains, and operating hours." />
    <div v-if="isLoading" class="text-sm text-ink-muted">Loading…</div>
    <form v-else class="space-y-6" @submit.prevent="onSave">
      <BaseCard as="section">
        <h3 class="text-base font-semibold text-ink">Organization</h3>
        <FormField v-slot="{ id }" class="mt-4" label="Name" :error="fieldErr.name">
          <BaseInput :id="id" v-model="form.name" :invalid="Boolean(fieldErr.name)" />
        </FormField>

        <FormField
          v-slot="{ id }"
          class="mt-4"
          label="USDOT number"
          hint="Printed on driver qualification files exported for an audit."
          :error="fieldErr.dot_number"
        >
          <BaseInput
            :id="id"
            v-model="form.dotNumber"
            placeholder="e.g. 1234567"
            :invalid="Boolean(fieldErr.dot_number)"
          />
        </FormField>
        <FormField
          v-slot="{ id }"
          class="mt-4"
          label="Street address"
          hint="Printed on the §396.17 annual inspection report, and on the decal that goes on the vehicle — §396.17(c)(2) makes it how a roadside officer finds the report behind a sticker."
          :error="fieldErr.address_line1"
        >
          <BaseInput :id="id" v-model="form.addressLine1" placeholder="1301 Armitage Ave" :invalid="Boolean(fieldErr.address_line1)" />
        </FormField>
        <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField v-slot="{ id }" label="City" :error="fieldErr.city">
            <BaseInput :id="id" v-model="form.city" placeholder="Melrose Park" :invalid="Boolean(fieldErr.city)" />
          </FormField>
          <FormField v-slot="{ id }" label="State" :error="fieldErr.state">
            <BaseInput :id="id" v-model="form.state" placeholder="IL" :invalid="Boolean(fieldErr.state)" />
          </FormField>
          <FormField v-slot="{ id }" label="ZIP" :error="fieldErr.postal_code">
            <BaseInput :id="id" v-model="form.postalCode" placeholder="60160" :invalid="Boolean(fieldErr.postal_code)" />
          </FormField>
        </div>

        <FormField
          v-slot="{ id }"
          class="mt-4"
          label="Allowed email domains (comma-separated)"
          hint="Only emails from these domains can be invited. Leave empty to allow any domain."
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
        <p class="mt-1 text-xs text-ink-muted">
          Used by the off-hours anomaly rule. Turn on 24/7 if the fleet runs around the clock — the
          rule then never flags a fill for its time of day.
        </p>
        <div class="mt-4">
          <BaseCheckbox v-model="form.open24_7">Open 24/7 (no off-hours)</BaseCheckbox>
        </div>
        <div class="mt-4 grid grid-cols-3 gap-4" :class="form.open24_7 ? 'opacity-50' : ''">
          <FormField v-slot="{ id }" label="Start" :error="fieldErr['operating_hours.start']">
            <BaseInput
              :id="id"
              v-model="form.start"
              :disabled="form.open24_7"
              placeholder="05:00"
              :invalid="Boolean(fieldErr['operating_hours.start'])"
            />
          </FormField>
          <FormField v-slot="{ id }" label="End" :error="fieldErr['operating_hours.end']">
            <BaseInput
              :id="id"
              v-model="form.end"
              :disabled="form.open24_7"
              placeholder="20:00"
              :invalid="Boolean(fieldErr['operating_hours.end'])"
            />
          </FormField>
          <FormField v-slot="{ id }" label="Timezone">
            <BaseInput :id="id" v-model="form.tz" placeholder="America/Chicago" />
          </FormField>
        </div>
      </BaseCard>

      <p class="text-xs text-ink-muted">
        Looking for alert recipients? They now live in
        <RouterLink
          to="/settings/notifications"
          class="font-medium text-link hover:text-link-hover"
          >Settings → Notifications</RouterLink
        >.
      </p>

      <div class="flex items-center gap-3">
        <BaseButton variant="primary" type="submit" :disabled="save.isPending.value">
          {{ save.isPending.value ? "Saving…" : "Save settings" }}
        </BaseButton>
      </div>
    </form>
  </div>
</template>
