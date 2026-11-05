<script setup lang="ts">
import { computed, ref } from "vue";
import type { AdsConnectionReport, AdsConnectionView, AdsMetaConnect } from "@silvicom/shared";
import { AppBadge as Badge, AppButton as BaseButton, AppCallout, AppCard as BaseCard, QueryState, useConfirm } from "@silvicom/ui";
import StepUpPrompt from "@/components/StepUpPrompt.vue";
import { useStepUpRetry } from "@/composables/useStepUpRetry";
import { formatDateTime } from "@/lib/format";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import AdsConnectionChecks from "./AdsConnectionChecks.vue";
import AdsMetaConnectForm from "./AdsMetaConnectForm.vue";
import { useAdsConnections, useConnectionAct, type ConnectionRefusal } from "./useAdsConnections";

/**
 * Settings › Ads control's ad accounts (ADS-AGENT-PLAN §2c "Company accounts"; Track S, E1b): what is
 * connected, its last test, and the acts on it. The doors are routes/connections.ts's:
 *   · read — anyone the page opens for (the section's view);
 *   · connect, connect the simulator, disconnect — `ads.connection`, an admin, freshly signed in;
 *   · test — `ads.connection`, no password prompt (it changes nothing but the stored report).
 * `session.admin` is the `isAdmin` that `requireAdminOnly` asks, as on the settings form; a fresh sign-in
 * is the API's to ask for and `useStepUpRetry`'s to answer — never guessed here.
 *
 * Stage 1 has no Meta credentials, so on staging only the simulator connects for real; the Meta form is
 * the owner's G1 click-path and is complete so that step needs no further build.
 */
const session = useSessionStore();
const toast = useToastStore();
const ask = useConfirm();
const list = useAdsConnections();
const act = useConnectionAct();
const { stepUpFor, holdForStepUp, confirmed, cancel } = useStepUpRetry();

const admin = computed(() => session.admin);
const connecting = ref(false);
/** A refused connect stores nothing, so its report lives only here, until the next attempt. */
const refused = ref<{ message: string; report: AdsConnectionReport | null } | null>(null);

const PROVIDER: Record<AdsConnectionView["provider"], string> = {
  meta: "Meta (Facebook, Instagram)", tiktok: "TikTok", x: "X", higgsfield: "Higgsfield", simulator: "Simulator",
};
const STATUS = {
  connected: { label: "Connected", tone: "success" },
  failing: { label: "Failing", tone: "danger" },
  disconnected: { label: "Disconnected", tone: "neutral" },
} as const;
const live = (c: AdsConnectionView) => c.status !== "disconnected";
const simulatorLive = computed(() => (list.data.value ?? []).some((c) => c.provider === "simulator" && live(c)));

async function run(what: Parameters<typeof act.mutateAsync>[0], done: string): Promise<void> {
  refused.value = null;
  try {
    await act.mutateAsync(what);
    if (what.kind === "meta") connecting.value = false;
    toast.success(done);
  } catch (e) {
    if (holdForStepUp(e, () => run(what, done))) return;
    const r = e as ConnectionRefusal;
    refused.value = { message: r.message, report: r.report ?? null };
  }
}

const connectMeta = (a: AdsMetaConnect) => run({ kind: "meta", ask: a }, "Meta account connected");
const connectSimulator = () => run({ kind: "simulator" }, "Simulator connected");
const test = (c: AdsConnectionView) => run({ kind: "test", id: c.id }, "Connection tested");
async function disconnect(c: AdsConnectionView): Promise<void> {
  const yes = await ask({
    title: `Disconnect ${PROVIDER[c.provider]}?`,
    message: "Its stored token is deleted. Nothing new can launch on it until it is connected again.",
    confirmLabel: "Disconnect",
    tone: "danger",
  });
  if (yes) await run({ kind: "disconnect", id: c.id }, "Disconnected");
}
</script>

<template>
  <BaseCard v-if="stepUpFor" as="section">
    <StepUpPrompt :reason="stepUpFor" @confirmed="confirmed" @cancel="cancel" />
  </BaseCard>
  <BaseCard v-else as="section" class="space-y-4">
    <div>
      <h2 class="text-sm font-semibold text-ink">Ad accounts</h2>
      <p class="mt-1 text-sm text-ink-muted">
        The company's own accounts the ads run in. Nothing can launch without one that passes its test.
        <template v-if="!admin">Only an admin can connect, test or disconnect one.</template>
      </p>
    </div>
    <QueryState
      :loading="list.isLoading.value"
      :error="list.error.value"
      error-text="Could not load the ad accounts."
      :retrying="list.isFetching.value"
      @retry="list.refetch()"
    >
      <p v-if="(list.data.value ?? []).length === 0" class="text-sm text-ink-muted">No ad account is connected yet.</p>
      <ul v-else class="divide-y divide-edge-subtle">
        <li v-for="c in list.data.value" :key="c.id" class="space-y-3 py-4" :data-connection="c.provider">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p class="text-sm font-medium text-ink">
                {{ PROVIDER[c.provider] }}<template v-if="c.is_sandbox && c.provider !== 'simulator'"> · sandbox</template>
                <Badge :tone="STATUS[c.status].tone" class="ml-2">{{ STATUS[c.status].label }}</Badge>
              </p>
              <p class="text-xs text-ink-muted">
                Account {{ c.account_ref ?? "—" }} · Page {{ c.page_ref ?? "—" }} ·
                {{ c.last_test_at ? `Last tested ${formatDateTime(c.last_test_at)}` : "Never tested" }}
              </p>
            </div>
            <div v-if="admin && live(c)" class="flex gap-2">
              <BaseButton variant="secondary" size="sm" :disabled="act.isPending.value" @click="test(c)">Test</BaseButton>
              <BaseButton variant="secondary" size="sm" :disabled="act.isPending.value" @click="disconnect(c)">Disconnect</BaseButton>
            </div>
          </div>
          <!-- A failed check already says it; last_error alone is for what the pause path met after a passing test. -->
          <p v-if="c.last_error && !c.last_test?.checks.some((k) => k.ok === false)" class="text-sm text-danger-700">{{ c.last_error }}</p>
          <AdsConnectionChecks v-if="c.last_test && live(c)" :report="c.last_test" />
        </li>
      </ul>
    </QueryState>

    <AppCallout v-if="refused" tone="danger" role="alert">
      <p class="font-medium">{{ refused.message }}</p>
      <AdsConnectionChecks v-if="refused.report" :report="refused.report" class="mt-2" />
    </AppCallout>

    <AdsMetaConnectForm v-if="connecting" :busy="act.isPending.value" @submit="connectMeta" @cancel="connecting = false" />
    <!-- Only once the list is known: before it loads, or when it fails, "no simulator yet" would be a guess (E1b browser pass). -->
    <div v-else-if="admin && list.data.value" class="flex flex-wrap justify-end gap-2">
      <BaseButton v-if="!simulatorLive" variant="secondary" :disabled="act.isPending.value" @click="connectSimulator">Connect the simulator</BaseButton>
      <BaseButton variant="primary" @click="connecting = true">Connect a Meta account</BaseButton>
    </div>
  </BaseCard>
</template>
