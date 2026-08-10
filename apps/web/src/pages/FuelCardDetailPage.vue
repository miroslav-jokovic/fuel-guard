<script setup lang="ts">
/**
 * One card, as EFS currently reports it.
 *
 * Read-only in Phase A. The action panel is deliberately visible-but-disabled when the write
 * entitlement has not been checked: the read layer ships first, the product story is "you will be able
 * to lock this card", and hiding the actions makes the page look like a dead end. When the person's
 * ROLE will never allow it, the panel is hidden instead — see availability() in cardControlModel.
 */
import { computed } from "vue";
import { useRoute } from "vue-router";
import { AppIcon } from "@fuelguard/ui";
import { ArrowPathIcon } from "@fuelguard/ui/icons";
import BaseButton from "@/components/ui/BaseButton.vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import ErrorState from "@/components/ErrorState.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import CardEffectiveConfig from "@/features/fuelCards/CardEffectiveConfig.vue";
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
const cardFreshness = computed(() => freshness(card.value?.syncedAt ?? null));

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

      <!-- Phase A is read-only. This panel is the honest answer to "why can't I lock it?" -->
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
    </template>
  </div>
</template>
