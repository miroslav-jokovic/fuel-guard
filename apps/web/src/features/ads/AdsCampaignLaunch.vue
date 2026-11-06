<script setup lang="ts">
import { computed, ref } from "vue";
import { launchMissingLines, type AdsLaunchMissing } from "@silvicom/shared";
import { AppButton as BaseButton, AppCallout, AppFormField as FormField, AppInput as BaseInput } from "@silvicom/ui";
import StepUpPrompt from "@/components/StepUpPrompt.vue";
import { useStepUpRetry } from "@/composables/useStepUpRetry";
import { useToastStore } from "@/stores/toast";
import { centsFrom } from "./adsCampaignFlow";
import { launchMissingFrom, useApproveAndLaunch } from "./useAdsCampaigns";

/**
 * Launch one paused campaign (E3b-2). The drawer shows this only to an admin, from the state the machine launches
 * from (`canLaunchFrom`): `ads.spend` is `requireAdminOnly`, and its fresh sign-in is the API's to ask for and
 * `useStepUpRetry`'s to answer. The admin approves exactly the amounts they type, and the ads go live at them.
 *
 * ── WHEN THE LAUNCH GATE SAYS NO ───────────────────────────────────────────────────────────────────
 * A real-platform campaign whose parts have not all passed their test run is refused with 409 `not_certified` and
 * the list of those parts. It is shown here in office words (`launchMissingLines`), because "Renderer / Higgsfield
 * client at L3" means nothing to the person deciding to spend. The door also writes the campaign's `last_error`,
 * which the drawer shows after it reads the campaign again. A simulator campaign is exempt, where the server
 * allows the simulator at all.
 */
const props = defineProps<{ campaignId: string }>();

const toast = useToastStore();
const launch = useApproveAndLaunch();
const { stepUpFor, holdForStepUp, confirmed, cancel } = useStepUpRetry();

const daily = ref("");
const lifetime = ref("");
const missing = ref<AdsLaunchMissing | null>(null);
const amounts = computed(() => {
  const d = centsFrom(daily.value);
  const l = centsFrom(lifetime.value);
  return d && l ? { daily_budget_cents: d, lifetime_cap_cents: l } : null;
});

async function goLive(): Promise<void> {
  const a = amounts.value;
  if (!a) return;
  missing.value = null;
  try {
    await launch.mutateAsync({ id: props.campaignId, launch: a });
    toast.success("Campaign launching");
  } catch (e) {
    if (holdForStepUp(e, goLive)) return;
    missing.value = launchMissingFrom(e);
    if (!missing.value) toast.error("Not launched", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <form class="space-y-3" novalidate data-test="launch-form" @submit.prevent="goLive">
    <h3 class="text-sm font-semibold text-ink">Launch</h3>
    <p class="text-sm text-ink-muted">This starts spending. You approve these amounts, and the ads go live at them.</p>
    <StepUpPrompt v-if="stepUpFor" :reason="stepUpFor" @confirmed="confirmed" @cancel="cancel" />
    <AppCallout v-if="missing" tone="warning" data-test="not-certified">
      <p>Not launched. These parts of the ads agent have not passed a test run against the real platform yet:</p>
      <ul class="mt-1 list-disc pl-5">
        <li v-for="line in launchMissingLines(missing)" :key="line" data-test="missing-part">{{ line }}</li>
      </ul>
      <p class="mt-1">Nothing was spent. A simulator campaign can launch meanwhile.</p>
    </AppCallout>
    <div class="grid gap-4 sm:grid-cols-2">
      <FormField v-slot="{ id }" label="Daily budget ($)" required><BaseInput :id="id" v-model="daily" inputmode="decimal" data-test="daily" /></FormField>
      <FormField v-slot="{ id }" label="Lifetime cap ($)" required><BaseInput :id="id" v-model="lifetime" inputmode="decimal" data-test="lifetime" /></FormField>
    </div>
    <div class="flex justify-end">
      <BaseButton variant="primary" type="submit" :disabled="!amounts || launch.isPending.value" data-test="launch">Approve and launch</BaseButton>
    </div>
  </form>
</template>
