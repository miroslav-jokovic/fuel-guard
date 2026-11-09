<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AD_AI_AGENTS, AD_PLATFORMS, ADS_BENCHMARK_SUGGESTIONS, type AdAiAgent, type AdPlatform, type AdsSettingsView, type OrgMember } from "@silvicom/shared";
import {
  AppButton as BaseButton, AppCard as BaseCard, AppFormField as FormField, AppInput as BaseInput, AppSwitch as BaseSwitch,
} from "@silvicom/ui";
import SettingsSection from "@/components/ui/SettingsSection.vue";
import StepUpPrompt from "@/components/StepUpPrompt.vue";
import { useStepUpRetry } from "@/composables/useStepUpRetry";
import { formatDateTime } from "@/lib/format";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { toFormValues, toSettings, type AdsSettingsFormValues } from "./adsSettingsForm";
import { useSaveAdsSettings } from "./useAdsSettings";
import AdsAlertsSection from "./AdsAlertsSection.vue";
import AdsOutcomeFeedSection from "./AdsOutcomeFeedSection.vue";
import AdsLeadQualitySection from "./AdsLeadQualitySection.vue";

/**
 * Settings › Ads control's limits, rules, approvals and AI budgets (ADS-AGENT-PLAN §4b; Track S, E1a). Read
 * by anyone the page opens for; saved only by an admin, freshly signed in (`ads.spend`, routes/guard.ts) —
 * `session.admin` is the same `isAdmin` the API's `requireAdminOnly` asks. Every save is a new version with
 * its author; nothing is edited in place, and nothing is in force until the first save (G5: a cap in code
 * would be a spending decision nobody made). The suggestions beside the auto-pause fields are the shared
 * benchmark's, labelled with their source, and are never saved by themselves. The alerts (E1b) are a
 * section of this form, saved in the same version; `members` is the page's to hand in (AdsAlertsSection). So is the
 * outcome feed (Q-AD40), for the same reason: a second save of the one object would undo the first's other half.
 */
const props = withDefaults(defineProps<{ view: AdsSettingsView; members?: OrgMember[] | null; membersFailed?: boolean }>(), { members: null, membersFailed: false });

const session = useSessionStore();
const toast = useToastStore();
const save = useSaveAdsSettings();
const { stepUpFor, holdForStepUp, confirmed, cancel } = useStepUpRetry();

const values = ref<AdsSettingsFormValues>(toFormValues(props.view.settings));
const error = ref<{ field: string; message: string } | null>(null);
watch(() => props.view, (v) => { values.value = toFormValues(v.settings); }, { deep: false });

const editable = computed(() => session.admin);
const PLATFORM_LABEL: Record<AdPlatform, string> = { meta: "Meta (Facebook, Instagram)", tiktok: "TikTok", x: "X", simulator: "Simulator" };
const AGENT_LABEL: Record<AdAiAgent, string> = {
  copywriter: "Writes the ad's words", art_director: "Describes the picture", renderer: "Draws the picture",
  checker: "Checks the picture", analyst: "Writes the daily report",
};
const PAUSE_TOGGLES = [
  { key: "pause_at_daily_cap", label: "Pause at the daily budget" },
  { key: "pause_when_filled", label: "Pause when the opening is filled" },
] as const;
const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US")}`;
const S = ADS_BENCHMARK_SUGGESTIONS;
const savedLine = computed(() => props.view.version === null
  ? "Nothing saved yet, so nothing can launch. Save the limits to put them in force."
  : `Version ${props.view.version}, saved by ${props.view.saved_by_name ?? "someone"} on ${formatDateTime(props.view.saved_at)}.`);
const errorOn = (prefix: string) => (error.value?.field.startsWith(prefix) ? error.value.message : undefined);

async function submit(): Promise<void> {
  const out = toSettings(props.view.settings, values.value);
  if (!out.ok) {
    error.value = { field: out.field, message: out.message };
    return;
  }
  error.value = null;
  try {
    const saved = await save.mutateAsync(out.settings);
    toast.success(`Ads settings saved as version ${saved.version}`);
  } catch (e) {
    if (holdForStepUp(e, submit)) return;
    toast.error("Could not save the ads settings", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <BaseCard v-if="stepUpFor" as="section">
    <StepUpPrompt :reason="stepUpFor" @confirmed="confirmed" @cancel="cancel" />
  </BaseCard>
  <form v-else id="ads-settings" class="space-y-6" @submit.prevent="submit">
    <p class="text-sm text-ink-muted">{{ savedLine }}<template v-if="!editable"> Only an admin can change these.</template></p>

    <SettingsSection title="Spending limits" description="The most any ad may spend. A platform with no monthly cap cannot launch.">
      <BaseCard as="div" class="grid gap-4 sm:grid-cols-2">
        <FormField v-for="p in AD_PLATFORMS" :key="p" v-slot="{ id }" :label="`Monthly cap, ${PLATFORM_LABEL[p]} ($)`" :error="errorOn(`limits.monthly_cap_cents.${p}`)">
          <BaseInput :id="id" v-model="values.monthly_cap[p]" type="number" inputmode="decimal" step="0.01" min="0" :disabled="!editable" />
        </FormField>
        <FormField v-slot="{ id }" label="Daily budget, most per campaign ($)" :error="errorOn('limits.daily_max_cents')">
          <BaseInput :id="id" v-model="values.daily_max" type="number" inputmode="decimal" step="0.01" min="0" :disabled="!editable" />
        </FormField>
        <FormField v-slot="{ id }" label="Lifetime budget, most per campaign ($)" :error="errorOn('limits.lifetime_max_cents')">
          <BaseInput :id="id" v-model="values.lifetime_max" type="number" inputmode="decimal" step="0.01" min="0" :disabled="!editable" />
        </FormField>
        <FormField v-slot="{ id }" label="Largest raise one approval may make (%)" hint="The smaller of the percent and the amount wins." :error="errorOn('limits.max_raise_pct')">
          <BaseInput :id="id" v-model="values.max_raise_pct" type="number" inputmode="numeric" step="1" min="1" :disabled="!editable" />
        </FormField>
        <FormField v-slot="{ id }" label="Largest raise one approval may make ($)" :error="errorOn('limits.max_raise_cents')">
          <BaseInput :id="id" v-model="values.max_raise" type="number" inputmode="decimal" step="0.01" min="0" :disabled="!editable" />
        </FormField>
      </BaseCard>
    </SettingsSection>

    <SettingsSection title="Automatic pauses" description="When an ad pauses itself. Checked every hour, and sent to Meta as its own rules.">
      <BaseCard as="div" class="grid gap-4 sm:grid-cols-2">
        <FormField v-slot="{ id }" label="Pause when a lead costs more than ($)" :hint="`Suggested: ${usd(S.cpl_max_cents)} (${S.source})`" :error="errorOn('auto_pause.cpl_max_cents')">
          <BaseInput :id="id" v-model="values.cpl_max" type="number" inputmode="decimal" step="0.01" min="0" :disabled="!editable" />
        </FormField>
        <FormField v-slot="{ id }" label="…after this many leads" :hint="`Suggested: ${S.cpl_min_leads}`" :error="errorOn('auto_pause.cpl_min_leads')">
          <BaseInput :id="id" v-model="values.cpl_min_leads" type="number" inputmode="numeric" step="1" min="1" :disabled="!editable" />
        </FormField>
        <FormField v-slot="{ id }" label="Pause after this much spend with no lead ($)" :hint="`Suggested: ${usd(S.no_lead_spend_cents)}`" :error="errorOn('auto_pause.no_lead_spend_cents')">
          <BaseInput :id="id" v-model="values.no_lead_spend" type="number" inputmode="decimal" step="0.01" min="0" :disabled="!editable" />
        </FormField>
        <FormField v-slot="{ id }" label="Pause when one person has seen it more than (times)" :error="errorOn('auto_pause.frequency_max')">
          <BaseInput :id="id" v-model="values.frequency_max" type="number" inputmode="decimal" step="0.1" min="1" :disabled="!editable" />
        </FormField>
        <div v-for="t in PAUSE_TOGGLES" :key="t.key" class="flex items-center justify-between gap-4">
          <p class="text-sm text-ink">{{ t.label }}</p>
          <BaseSwitch v-model="values[t.key]" :label="t.label" :disabled="!editable" />
        </div>
      </BaseCard>
      <BaseCard as="div" class="space-y-3">
        <h3 class="text-sm font-semibold text-ink">Tired ads</h3>
        <p class="text-sm text-ink-muted">An ad is judged against its own first week: when its click-through has fallen by the share below, it is tired. Off = the report says so and nothing is retired. (Triple Whale's framework: 15–30 % over 7–10 days; our default 25 % after 7 days.)</p>
        <div class="flex items-center justify-between gap-4"><p class="text-sm text-ink">Retire a tired ad at the platform</p><BaseSwitch v-model="values.refresh_retire" label="Retire a tired ad at the platform" :disabled="!editable" data-test="refresh-retire" /></div>
        <div class="grid gap-3 sm:grid-cols-3">
          <FormField v-slot="{ id }" label="Days before judging" :error="errorOn('creative_refresh.min_days')">
            <BaseInput :id="id" v-model="values.refresh_min_days" type="number" inputmode="numeric" min="3" max="60" :disabled="!editable" />
          </FormField>
          <FormField v-slot="{ id }" label="Click-through drop (%)" :error="errorOn('creative_refresh.ctr_drop_pct')">
            <BaseInput :id="id" v-model="values.refresh_ctr_drop_pct" type="number" inputmode="numeric" min="5" max="90" :disabled="!editable" />
          </FormField>
          <FormField v-slot="{ id }" label="Impressions per week before a rate counts" :error="errorOn('creative_refresh.min_impressions')">
            <BaseInput :id="id" v-model="values.refresh_min_impressions" type="number" inputmode="numeric" min="100" :disabled="!editable" />
          </FormField>
        </div>
      </BaseCard>
    </SettingsSection>

    <SettingsSection title="Approvals" description="Every launch and every raise needs an admin's yes. Above this daily amount it needs two different admins.">
      <BaseCard as="div" class="grid gap-4 sm:grid-cols-2">
        <FormField v-slot="{ id }" label="Second approver above, per day ($)" hint="Leave blank for one approver." :error="errorOn('approvals')">
          <BaseInput :id="id" v-model="values.second_approver_above" type="number" inputmode="decimal" step="0.01" min="0" :disabled="!editable" />
        </FormField>
      </BaseCard>
    </SettingsSection>

    <SettingsSection title="AI and pictures" description="What the agents may use each month. Blank stops them; each agent is off until switched on.">
      <BaseCard as="div" class="grid gap-4 sm:grid-cols-2">
        <FormField v-slot="{ id }" label="AI tokens a month" :error="errorOn('budgets.anthropic_tokens_monthly')">
          <BaseInput :id="id" v-model="values.anthropic_tokens_monthly" type="number" inputmode="numeric" step="1" min="0" :disabled="!editable" />
        </FormField>
        <FormField v-slot="{ id }" label="Picture credits a month" :error="errorOn('budgets.higgsfield_credits_monthly')">
          <BaseInput :id="id" v-model="values.higgsfield_credits_monthly" type="number" inputmode="numeric" step="1" min="0" :disabled="!editable" />
        </FormField>
        <FormField v-slot="{ id }" label="Tries per ad before it stops" hint="From 0 to 5." :error="errorOn('budgets.max_regenerations')">
          <BaseInput :id="id" v-model="values.max_regenerations" type="number" inputmode="numeric" step="1" min="0" max="5" :disabled="!editable" />
        </FormField>
        <div class="divide-y divide-edge-subtle sm:col-span-2">
          <div v-for="a in AD_AI_AGENTS" :key="a" class="flex items-center justify-between gap-4 py-2">
            <p class="text-sm text-ink">{{ AGENT_LABEL[a] }}</p>
            <BaseSwitch v-model="values.agents_enabled[a]" :label="AGENT_LABEL[a]" :disabled="!editable" />
          </div>
        </div>
      </BaseCard>
    </SettingsSection>

    <AdsAlertsSection
      v-model:recipients="values.recipients"
      v-model:minutes="values.uncontacted_lead_minutes"
      :editable="editable"
      :members="members"
      :members-failed="membersFailed"
      :error="errorOn('alerts')"
    />

    <AdsOutcomeFeedSection
      v-model:enabled="values.outcome_feed_enabled"
      v-model:dataset-id="values.outcome_dataset_id"
      :editable="editable"
      :error="errorOn('outcome_feed')"
    />

    <AdsLeadQualitySection
      v-model:enabled="values.lead_quality_enabled"
      v-model:min-attempted="values.lead_quality_min_attempted"
      v-model:wrong-pct="values.lead_quality_wrong_number_pct"
      v-model:not-qualified-pct="values.lead_quality_not_qualified_pct"
      :editable="editable"
      :error-on="errorOn"
    />

    <div v-if="editable" class="flex justify-end">
      <BaseButton type="submit" variant="primary" :disabled="save.isPending.value">Save as a new version</BaseButton>
    </div>
  </form>
</template>
