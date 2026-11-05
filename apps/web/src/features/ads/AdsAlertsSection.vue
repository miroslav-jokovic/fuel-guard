<script setup lang="ts">
import { computed } from "vue";
import { ADS_ALERT_CATEGORIES, NOTIFICATION_CATEGORY_LABELS, isLeadCallAlert, type AdsAlertCategory, type OrgMember } from "@silvicom/shared";
import { AppCard as BaseCard, AppFormField as FormField, AppIconButton as IconButton, AppInput as BaseInput, AppSelect as BaseSelect } from "@silvicom/ui";
import { XMarkIcon } from "@silvicom/ui/icons";
import SettingsSection from "@/components/ui/SettingsSection.vue";

/**
 * Settings › Ads control's alerts (ADS-AGENT-PLAN §4b "Alerts"; Track S, E1b): who hears each ads and lead
 * alert, and how long a new lead may wait before `lead_uncontacted` rings. Part of the settings form, so
 * it saves in the same version (adsSettingsForm.ts, "one save, one version").
 *
 * ── WHO SEES NAMES ────────────────────────────────────────────────────────────────────────────────
 * The people come from `GET /api/members`, the Users page's read, which the API gives admins only — the
 * same people who may save this page. Everyone else reads how many were chosen, not who: a second, wider
 * directory read for this one list would be a new door into who works here, for no act they could take.
 * `members` is null when the list is not this person's to read, or did not load.
 *
 * The default audience beside each alert is read from `isLeadCallAlert`, the list both API paths type
 * their categories from, so this page cannot name a fallback the bell does not use.
 */
const props = defineProps<{ editable: boolean; members: OrgMember[] | null; membersFailed: boolean; error?: string }>();
const recipients = defineModel<Record<AdsAlertCategory, string[]>>("recipients", { required: true });
const minutes = defineModel<string>("minutes", { required: true });

/** Who hears it, now — the API (adsAlerts.ts) also drops a suspended member, so the picker does not offer one. */
const active = computed(() => (props.members ?? []).filter((m) => !m.suspendedAt));
const nameOf = (id: string): string => {
  const m = props.members?.find((x) => x.userId === id);
  if (!m) return "Someone no longer in the company";
  return (m.fullName ?? m.email ?? "A member") + (m.suspendedAt ? " (suspended)" : "");
};
const fallback = (c: AdsAlertCategory) => (isLeadCallAlert(c) ? "everyone who manages recruiting" : "the admins");
const optionsFor = (c: AdsAlertCategory) =>
  active.value.filter((m) => !recipients.value[c].includes(m.userId)).map((m) => ({ value: m.userId, label: m.fullName ?? m.email ?? "A member" }));

function add(c: AdsAlertCategory, id: unknown): void {
  if (typeof id !== "string" || recipients.value[c].includes(id)) return;
  recipients.value = { ...recipients.value, [c]: [...recipients.value[c], id] };
}
function remove(c: AdsAlertCategory, id: string): void {
  recipients.value = { ...recipients.value, [c]: recipients.value[c].filter((x) => x !== id) };
}
const countLine = (n: number) => (n === 1 ? "1 person chosen" : `${n} people chosen`);
</script>

<template>
  <SettingsSection title="Alerts" description="Who hears each alert in the bell and on their phone. Nobody chosen sends it to the people named beside it.">
    <BaseCard as="div" class="space-y-4">
      <FormField v-slot="{ id }" label="A new lead counts as waiting after (minutes)" hint="From 5 to 1,440. Then “Ad leads waiting for contact” rings." :error="error" class="max-w-sm">
        <BaseInput :id="id" v-model="minutes" type="number" inputmode="numeric" step="1" min="5" max="1440" :disabled="!editable" />
      </FormField>
      <p v-if="editable && membersFailed" class="text-sm text-danger-700">Could not load the people list, so nobody can be added right now.</p>
      <ul class="divide-y divide-edge-subtle">
        <li v-for="c in ADS_ALERT_CATEGORIES" :key="c" class="grid gap-2 py-3 sm:grid-cols-[14rem_1fr] sm:items-start" :data-alert="c">
          <div>
            <p class="text-sm font-medium text-ink">{{ NOTIFICATION_CATEGORY_LABELS[c] }}</p>
            <p v-if="recipients[c].length === 0" class="text-xs text-ink-muted">Goes to {{ fallback(c) }}.</p>
          </div>
          <div v-if="members" class="flex flex-wrap items-center gap-2">
            <span v-for="rid in recipients[c]" :key="rid" class="inline-flex items-center gap-1 rounded-full bg-surface-muted py-0.5 pl-3 pr-1 text-sm text-ink">
              {{ nameOf(rid) }}
              <IconButton v-if="editable" :icon="XMarkIcon" size="sm" :label="`Stop sending to ${nameOf(rid)}`" @click="remove(c, rid)" />
            </span>
            <div v-if="editable && optionsFor(c).length > 0" class="w-full sm:w-56">
              <BaseSelect
                :model-value="null"
                :options="optionsFor(c)"
                placeholder="Add someone…"
                :aria-label="`Add someone to ${NOTIFICATION_CATEGORY_LABELS[c]}`"
                @update:model-value="add(c, $event)"
              />
            </div>
          </div>
          <p v-else-if="recipients[c].length > 0" class="text-sm text-ink">{{ countLine(recipients[c].length) }}</p>
        </li>
      </ul>
    </BaseCard>
  </SettingsSection>
</template>
