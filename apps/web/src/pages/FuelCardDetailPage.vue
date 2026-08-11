<script setup lang="ts">
/**
 * One card, as EFS currently reports it — and everything this product can do to it.
 *
 * The action surfaces render from server-computed `capabilities`, never from a role the browser can
 * see: the answer depends on a deploy kill switch, an org opt-in, an EFS write entitlement and an
 * approver list, and the browser can see none of those. When the write entitlement has not been
 * checked the actions are visible-but-disabled with one explanatory line — hiding them makes the page
 * look like a dead end and generates tickets asking for a feature that is already built. When the
 * person's ROLE will never allow it, they are hidden instead. See availability() in cardControlModel.
 */
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import { AppIcon } from "@fuelguard/ui";
import { ArrowPathIcon } from "@fuelguard/ui/icons";
import { AppButton as BaseButton } from "@fuelguard/ui";
import { AppCard as BaseCard } from "@fuelguard/ui";
import ErrorState from "@/components/ErrorState.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import CardControlDrawer from "@/features/fuelCards/CardControlDrawer.vue";
import CardEffectiveConfig from "@/features/fuelCards/CardEffectiveConfig.vue";
import CardMutationHistory from "@/features/fuelCards/CardMutationHistory.vue";
import { availability, cardStatusLabel, cardStatusTone, freshness } from "@/features/fuelCards/cardControlModel";
import { useEfsCard, useRefreshEfsCard } from "@/features/fuelCards/useEfsCards";

const route = useRoute();
const session = useSessionStore();
const toast = useToastStore();

const id = computed(() => String(route.params.id ?? ""));
const query = useEfsCard(id);
const refresh = useRefreshEfsCard();

const card = computed(() => query.data.value?.card ?? null);
const capabilities = computed(() => query.data.value?.capabilities ?? null);
const notice = computed(() =>
  capabilities.value ? availability(capabilities.value, session.admin) : null,
);
const cardFreshness = computed(() => freshness(card.value?.syncedAt ?? null, new Date(), query.data.value?.staleAfterMinutes));

const drawerOpen = ref(false);

/** The card-level prompts, which are what the drawer edits. Policy-level records are not editable. */
const cardPrompts = computed(() =>
  (query.data.value?.effective.infos ?? [])
    .filter((row) => row.origin === "card")
    .map((row) => ({
      infoId: row.value.infoId,
      validationType: row.value.validationType,
      matchValue: row.value.matchValue,
    })),
);

/** True when the server says at least one action is reachable for this person on this card. */
const canAct = computed(() => {
  const c = capabilities.value;
  return !!c && (c.canLock || c.canUnlock || c.canOverride || c.canSetPrompts);
});

/** Every fact an operator asks for before deciding anything, in the order they ask. */
const facts = computed(() => {
  const c = card.value;
  if (!c) return [];
  return [
    { label: "Policy", value: c.policyNumber != null ? String(c.policyNumber) : "—" },
    { label: "Unit", value: c.unitPrompt ?? "—" },
    { label: "Driver ID", value: c.driverIdPrompt ?? "—" },
    { label: "Driver name", value: c.driverName ?? "—" },
    { label: "Company reference", value: c.companyXref ?? "—" },
    // DISALLOW here removes a whole class of skimming; it is worth surfacing even read-only.
    { label: "Hand entry", value: c.handEnter ?? "—" },
    { label: "Payroll status", value: c.payrollStatus ?? "—" },
    { label: "Last used", value: c.lastUsedDate ? new Date(c.lastUsedDate).toLocaleString() : "Never" },
    { label: "Last authorisation", value: c.lastTransaction ?? "—" },
  ];
});

async function onRefresh(): Promise<void> {
  try {
    await refresh.mutateAsync(id.value);
    toast.success("Card refreshed");
  } catch (e) {
    toast.error("Could not refresh the card", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader :description="card ? `${card.maskedRef} — settings EFS reports right now.` : 'Loading the card…'">
      <template #actions>
        <!-- Trailing ellipsis because it opens a drawer rather than doing something immediately. -->
        <BaseButton v-if="canAct" variant="primary" @click="drawerOpen = true">Card actions…</BaseButton>
        <BaseButton variant="secondary" :disabled="refresh.isPending.value" @click="onRefresh">
          <AppIcon :icon="ArrowPathIcon" class="size-4" aria-hidden="true" />
          {{ refresh.isPending.value ? "Refreshing…" : "Refresh from EFS" }}
        </BaseButton>
      </template>
    </PageHeader>

    <ErrorState
      v-if="query.isError.value"
      :message="query.error.value?.message ?? 'Could not load that card'"
      @retry="query.refetch()"
    />

    <template v-else-if="card">
      <BaseCard>
        <div class="flex flex-wrap items-center gap-3">
          <span class="text-lg font-medium text-ink">{{ card.maskedRef }}</span>
          <span :class="[BADGE_BASE, toneClass(cardStatusTone(card.status))]">
            {{ cardStatusLabel(card.status) }}
          </span>
          <span
            v-if="(card.overrideUses ?? 0) > 0"
            :class="[BADGE_BASE, toneClass('warning')]"
          >
            Override: {{ card.overrideUses }} use{{ card.overrideUses === 1 ? "" : "s" }} left
          </span>
        </div>

        <dl class="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <div v-for="fact in facts" :key="fact.label">
            <dt class="text-xs text-ink-muted">{{ fact.label }}</dt>
            <dd class="text-sm text-ink">{{ fact.value }}</dd>
          </div>
        </dl>

        <p class="mt-4 text-sm" :class="cardFreshness.stale ? 'text-caution-700' : 'text-ink-muted'">
          {{ cardFreshness.text }}
        </p>
        <p v-if="card.syncError" class="mt-1 text-sm text-caution-700">
          Last refresh reported: {{ card.syncError }}
        </p>
      </BaseCard>

      <!-- The honest answer to "why can't I lock it?", shown instead of the actions button. -->
      <BaseCard v-if="notice && notice.mode === 'disabled'">
        <div class="space-y-2">
          <h2 class="text-sm font-medium text-ink">Card actions</h2>
          <p class="text-sm text-ink-muted">{{ notice.message }}</p>
          <BaseButton
            v-if="notice.actionTo"
            variant="soft"
            size="sm"
            :to="notice.actionTo"
          >
            {{ notice.actionLabel }}
          </BaseButton>
        </div>
      </BaseCard>

      <CardEffectiveConfig
        v-if="query.data.value"
        :effective="query.data.value.effective"
        :policy-number="card.policyNumber"
      />

      <BaseCard>
        <div class="space-y-3">
          <h2 class="text-sm font-medium text-ink">Change history</h2>
          <CardMutationHistory :card-id="id" />
        </div>
      </BaseCard>

      <CardControlDrawer
        v-if="capabilities"
        :open="drawerOpen"
        :card-id="id"
        :masked-ref="card.maskedRef"
        :version="card.version"
        :status="card.status"
        :last-used-date="card.lastUsedDate"
        :driver-name="card.driverName"
        :unit-prompt="card.unitPrompt"
        :override-uses="card.overrideUses"
        :override-all-locations="card.overrideAllLocations"
        :location-override-id="card.locationOverrideId"
        :prompts="cardPrompts"
        :capabilities="capabilities"
        @close="drawerOpen = false"
        @changed="query.refetch()"
      />
    </template>
  </div>
</template>
