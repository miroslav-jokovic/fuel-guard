<script setup lang="ts">
import { computed, ref, toRef } from "vue";
import { isReplacement, type AdsCampaignMove, type AdsCopyChoice } from "@silvicom/shared";
import { AppButton as BaseButton, AppCallout, QueryState } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import AdsCampaignConcepts from "./AdsCampaignConcepts.vue";
import AdsCampaignLaunch from "./AdsCampaignLaunch.vue";
import AdsCreativeReview from "./AdsCreativeReview.vue";
import { CAMPAIGN_STATE_LABEL, CAMPAIGN_STATE_TONE, canLaunchFrom, isWorking, personMoves } from "./adsCampaignFlow";
import { useAdsCampaign, useCampaignMove, useChooseWords, useCreativeDecision } from "./useAdsCampaigns";

/**
 * One campaign (E3): review its ads and move it on. The moves are the machine's (`personMoves`), shown to whoever
 * manages recruiting, the door's own gate. Launch (approving the spend at its amounts, with a fresh sign-in) is
 * `AdsCampaignLaunch`, shown to an admin from the state the machine launches from: `session.admin` is what
 * `requireAdminOnly("ads.spend")` asks.
 */
const props = defineProps<{ campaignId: string }>();
const emit = defineEmits<{ close: [] }>();

const session = useSessionStore();
const toast = useToastStore();
const campaign = useAdsCampaign(toRef(props, "campaignId"));
const move = useCampaignMove();
const decide = useCreativeDecision();
const words = useChooseWords();
/** The door's last refusal of a word choice, by creative, shown in that ad's editor (`words_refused`). */
const wordsRefusal = ref<Record<string, unknown>>({});

const view = computed(() => campaign.data.value ?? null);
const canManage = computed(() => session.can("recruitment"));
const moves = computed(() => (view.value && canManage.value ? personMoves(view.value.state) : []));
/**
 * While the launch form lists the parts the gate found missing, the campaign's `last_error` holds the same refusal in
 * the door's own words (registry names and levels); showing both says it twice, and the second in engineers' terms.
 */
const launchRefused = ref(false);
const showLaunch = computed(() => Boolean(view.value && session.admin && canLaunchFrom(view.value.state)));
const busy = computed(() => move.isPending.value || decide.isPending.value || words.isPending.value);

async function act(work: () => Promise<void>, done: string): Promise<void> {
  try {
    await work();
    toast.success(done);
  } catch (e) {
    toast.error("That did not go through", e instanceof Error ? e.message : undefined);
  }
}
const press = (m: AdsCampaignMove, done: string) => act(() => move.mutateAsync({ id: props.campaignId, move: m }), done);
const approve = (creativeId: string) => act(() => decide.mutateAsync({ id: props.campaignId, creativeId, decision: { decision: "approve" } }), "Ad approved");
async function chooseWords(creativeId: string, choice: AdsCopyChoice): Promise<void> {
  try {
    await words.mutateAsync({ id: props.campaignId, creativeId, choice });
    wordsRefusal.value = { ...wordsRefusal.value, [creativeId]: null };
    toast.success("The ad is being remade with these words");
  } catch (e) {
    const r = e as { code?: string; detail?: unknown; message?: string };
    if (r.code === "words_refused") wordsRefusal.value = { ...wordsRefusal.value, [creativeId]: r.detail };
    toast.error("That did not go through", r.message);
  }
}
const reject = (creativeId: string, reason: string) => act(() => decide.mutateAsync({ id: props.campaignId, creativeId, decision: { decision: "reject", reason } }), "Ad rejected");
</script>

<template>
  <SlideOver :open="campaignId !== ''" :title="view?.name ?? 'Campaign'" size="lg" @close="emit('close')">
    <QueryState :loading="campaign.isLoading.value" :error="campaign.error.value" error-text="Could not load the campaign." :retrying="campaign.isFetching.value" @retry="campaign.refetch()">
      <div v-if="view" class="space-y-4">
        <div class="flex items-center gap-2">
          <span :class="[BADGE_BASE, toneClass(CAMPAIGN_STATE_TONE[view.state])]" data-test="campaign-state">{{ CAMPAIGN_STATE_LABEL[view.state] }}</span>
          <span v-if="isWorking(view.state)" class="text-sm text-ink-muted">The agent is working. This page updates by itself.</span>
        </div>
        <AppCallout v-if="view.last_error && !launchRefused" tone="danger" data-test="campaign-error">{{ view.last_error }}</AppCallout>
        <AdsCampaignLaunch v-if="showLaunch" :campaign-id="campaignId" @refused="(m) => (launchRefused = m !== null)" />
        <AdsCampaignConcepts :campaign-id="campaignId" :state="view.state" />
        <p v-if="view.creatives.length === 0" class="text-sm text-ink-muted" data-test="no-ads">No ads yet.</p>
        <AdsCreativeReview
          v-for="c in view.creatives" :key="c.id" :creative="c" :can-decide="canManage && (view.state === 'review' || (view.state === 'live' && isReplacement(c, view.creatives)))"
          :replaces="isReplacement(c, view.creatives)" :busy="busy"
          :can-choose-words="canManage && view.state === 'review'" :words-refusal="wordsRefusal[c.id]"
          @approve="approve(c.id)" @reject="(why) => reject(c.id, why)" @words="(choice) => chooseWords(c.id, choice)"
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
