<script setup lang="ts">
import { computed, ref, toRef } from "vue";
import type { AdsCampaignMove } from "@silvicom/shared";
import { AppButton as BaseButton, AppCallout, AppFormField as FormField, AppInput as BaseInput, QueryState } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import StepUpPrompt from "@/components/StepUpPrompt.vue";
import { useStepUpRetry } from "@/composables/useStepUpRetry";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import AdsCreativeReview from "./AdsCreativeReview.vue";
import { CAMPAIGN_STATE_LABEL, CAMPAIGN_STATE_TONE, canLaunchFrom, centsFrom, isWorking, personMoves } from "./adsCampaignFlow";
import { useAdsCampaign, useApproveAndLaunch, useCampaignMove, useCreativeDecision } from "./useAdsCampaigns";

/**
 * One campaign (E3): review its ads, approve it, and launch it. The moves are the machine's (`personMoves`), shown
 * to whoever manages recruiting, the door's own gate. Launch is `ads.spend`: `session.admin` is what
 * `requireAdminOnly` asks, and its fresh sign-in is the API's to ask for and `useStepUpRetry`'s to answer.
 */
const props = defineProps<{ campaignId: string }>();
const emit = defineEmits<{ close: [] }>();

const session = useSessionStore();
const toast = useToastStore();
const campaign = useAdsCampaign(toRef(props, "campaignId"));
const move = useCampaignMove();
const decide = useCreativeDecision();
const launch = useApproveAndLaunch();
const { stepUpFor, holdForStepUp, confirmed, cancel } = useStepUpRetry();

const view = computed(() => campaign.data.value ?? null);
const canManage = computed(() => session.can("recruitment"));
const moves = computed(() => (view.value && canManage.value ? personMoves(view.value.state) : []));
const showLaunch = computed(() => Boolean(view.value && session.admin && canLaunchFrom(view.value.state)));
const busy = computed(() => move.isPending.value || decide.isPending.value || launch.isPending.value);

const daily = ref("");
const lifetime = ref("");
const amounts = computed(() => {
  const d = centsFrom(daily.value);
  const l = centsFrom(lifetime.value);
  return d && l ? { daily_budget_cents: d, lifetime_cap_cents: l } : null;
});

async function act(work: () => Promise<void>, done: string): Promise<void> {
  try {
    await work();
    toast.success(done);
  } catch (e) {
    if (holdForStepUp(e, () => act(work, done))) return;
    toast.error("That did not go through", e instanceof Error ? e.message : undefined);
  }
}
const press = (m: AdsCampaignMove, done: string) => act(() => move.mutateAsync({ id: props.campaignId, move: m }), done);
const approve = (creativeId: string) => act(() => decide.mutateAsync({ id: props.campaignId, creativeId, decision: { decision: "approve" } }), "Ad approved");
const reject = (creativeId: string, reason: string) => act(() => decide.mutateAsync({ id: props.campaignId, creativeId, decision: { decision: "reject", reason } }), "Ad rejected");
const goLive = () => { const a = amounts.value; if (a) void act(() => launch.mutateAsync({ id: props.campaignId, launch: a }), "Campaign launching"); };
</script>

<template>
  <SlideOver :open="campaignId !== ''" :title="view?.name ?? 'Campaign'" size="lg" @close="emit('close')">
    <QueryState :loading="campaign.isLoading.value" :error="campaign.error.value" error-text="Could not load the campaign." :retrying="campaign.isFetching.value" @retry="campaign.refetch()">
      <div v-if="view" class="space-y-4">
        <div class="flex items-center gap-2">
          <span :class="[BADGE_BASE, toneClass(CAMPAIGN_STATE_TONE[view.state])]" data-test="campaign-state">{{ CAMPAIGN_STATE_LABEL[view.state] }}</span>
          <span v-if="isWorking(view.state)" class="text-sm text-ink-muted">The agent is working. This page updates by itself.</span>
        </div>
        <AppCallout v-if="view.last_error" tone="danger" data-test="campaign-error">{{ view.last_error }}</AppCallout>
        <StepUpPrompt v-if="stepUpFor" :reason="stepUpFor" @confirmed="confirmed" @cancel="cancel" />
        <form v-if="showLaunch" class="space-y-3" novalidate data-test="launch-form" @submit.prevent="goLive">
          <h3 class="text-sm font-semibold text-ink">Launch</h3>
          <p class="text-sm text-ink-muted">This starts spending. You approve these amounts, and the ads go live at them.</p>
          <div class="grid gap-4 sm:grid-cols-2">
            <FormField v-slot="{ id }" label="Daily budget ($)" required><BaseInput :id="id" v-model="daily" inputmode="decimal" data-test="daily" /></FormField>
            <FormField v-slot="{ id }" label="Lifetime cap ($)" required><BaseInput :id="id" v-model="lifetime" inputmode="decimal" data-test="lifetime" /></FormField>
          </div>
          <div class="flex justify-end">
            <BaseButton variant="primary" type="submit" :disabled="!amounts || busy" data-test="launch">Approve and launch</BaseButton>
          </div>
        </form>
        <p v-if="view.creatives.length === 0" class="text-sm text-ink-muted" data-test="no-ads">No ads yet.</p>
        <AdsCreativeReview
          v-for="c in view.creatives" :key="c.id" :creative="c" :can-decide="canManage && view.state === 'review'" :busy="busy"
          @approve="approve(c.id)" @reject="(why) => reject(c.id, why)"
        />
      </div>
    </QueryState>
    <template v-if="moves.length > 0" #footer>
      <div class="flex flex-wrap items-center justify-end gap-3">
        <BaseButton v-for="m in moves" :key="m.event" :variant="m.event === 'creatives_approved' ? 'primary' : 'secondary'" :disabled="busy" :data-test="`move-${m.event}`" @click="press({ event: m.event }, 'Done')">{{ m.label }}</BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
