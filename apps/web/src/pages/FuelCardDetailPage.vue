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
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { } from "@fuelguard/ui/icons";
import { AppButton as BaseButton } from "@fuelguard/ui";
import { AppCard as BaseCard } from "@fuelguard/ui";
import ErrorState from "@/components/ErrorState.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useSessionStore } from "@/stores/session";
import CardOperationDrawer from "@/features/fuelCards/CardOperationDrawer.vue";
import KebabMenu from "@/components/KebabMenu.vue";
import CardEffectiveConfig from "@/features/fuelCards/CardEffectiveConfig.vue";
import { availability, cardStatusLabel, cardStatusTone, freshness } from "@/features/fuelCards/cardControlModel";
import {
  CARD_OPERATIONS,
  type CardOperationGroup,
  type CardOperationSpec,
  blockedSentence,
  operationBlockedBy,
  operationFromQuery,
  toOperationCard,
} from "@/features/fuelCards/cardOperations";
import { useEfsCard } from "@/features/fuelCards/useEfsCards";

const route = useRoute();
const session = useSessionStore();

const id = computed(() => String(route.params.id ?? ""));
const query = useEfsCard(id);

const card = computed(() => query.data.value?.card ?? null);
const capabilities = computed(() => query.data.value?.capabilities ?? null);
const notice = computed(() =>
  capabilities.value ? availability(capabilities.value, session.admin) : null,
);
const cardFreshness = computed(() => freshness(card.value?.syncedAt ?? null, new Date(), query.data.value?.staleAfterMinutes));

const openOperation = ref<CardOperationSpec | null>(null);

/**
 * The operations for one section's `⋮`, with the reason any of them is out of reach.
 *
 * ── Shown-and-disabled, not hidden ───────────────────────────────────────────────────────────────
 * Hiding an operation somebody lacks the scope for makes the menu look like the product cannot do
 * it at all, and generates tickets for a feature that is already built. An operation the CARD's own
 * state makes meaningless is a different case and IS filtered — `applies` — because that is not a
 * permission problem and greying it would send somebody hunting a permission that would not help.
 *
 * The Step 6.3 verify in words: a yard manager without the override scope sees Grant exception
 * greyed, and is told to ask an admin to add them.
 */
const sectionOperations = (group: CardOperationGroup) => {
  const c = card.value;
  const caps = capabilities.value;
  if (!c || !caps) return [];
  const context = toOperationCard(c);
  const scopes = caps.scopes ?? [];
  return CARD_OPERATIONS
    .filter((op) => op.group === group && op.applies(context))
    .map((op) => {
      const blocked = operationBlockedBy(op, caps, scopes);
      return { op, blocked, reason: blocked ? blockedSentence(blocked) : null };
    });
};

const cardOperations = computed(() => sectionOperations("Current card"));
const promptOperations = computed(() => sectionOperations("Prompts"));

/**
 * `?action=lock` opens straight onto that operation — what the list page's kebab links to, so
 * "lock this card" is two interactions from the inventory rather than four.
 *
 * Waits for the card to load: the drawer needs the version the screen was drawn from, and opening
 * it against `undefined` would show an operation whose diff has nothing to compare against.
 */
watch([() => route.query.action, card], ([action, loaded]) => {
  if (!loaded || openOperation.value) return;
  const spec = operationFromQuery(action);
  if (spec && spec.applies(toOperationCard(loaded))) openOperation.value = spec;
}, { immediate: true });

/** The card-level prompts, which are what the drawer edits. Policy-level records are not editable. */
const cardPrompts = computed(() =>
  (query.data.value?.effective.infos ?? [])
    .filter((row) => row.origin === "card")
    .map((row) => ({
      infoId: row.value.infoId,
      validationType: row.value.validationType,
      matchValue: row.value.matchValue,
      reportValue: row.value.reportValue,
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

</script>

<template>
  <div class="space-y-6">
    <PageHeader :description="card ? `${card.maskedRef} — settings EFS reports right now.` : 'Loading the card…'">
      <!-- No single "Card actions…" button: Phase 6's whole point is one button per operation, and
           the Actions card below is where they live. A header button would be a seventh way in. -->
    </PageHeader>

    <ErrorState
      v-if="query.isError.value"
      :message="query.error.value?.message ?? 'Could not load that card'"
      @retry="query.refetch()"
    />

    <template v-else-if="card">
      <!-- Section 1 — the card itself, with its own ⋮ (Step 6.5.3). -->
      <BaseCard>
        <div class="flex flex-wrap items-start justify-between gap-3">
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
          <KebabMenu v-if="canAct && cardOperations.length > 0" trigger-label="Card actions">
            <BaseButton
              v-for="row in cardOperations"
              :key="row.op.id"
              class="kebab-item"
              :disabled="row.blocked !== null"
              :title="row.reason ?? undefined"
              @click="openOperation = row.op"
            >
              {{ row.op.menuLabel }}
            </BaseButton>
          </KebabMenu>
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

      <!-- The honest answer to "why can't I lock it?", shown instead of the actions. -->
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

      <!-- Section 2 — what the pump asks for, with its own ⋮. Limits and time restrictions render
           alongside it and carry no menu: neither has a capability behind it yet. -->
      <CardEffectiveConfig
        v-if="query.data.value"
        :effective="query.data.value.effective"
        :policy-number="card.policyNumber"
      >
        <template #actions="{ section }">
          <KebabMenu
            v-if="section === 'prompts' && canAct && promptOperations.length > 0"
            trigger-label="Prompt actions"
          >
            <BaseButton
              v-for="row in promptOperations"
              :key="row.op.id"
              class="kebab-item"
              :disabled="row.blocked !== null"
              :title="row.reason ?? undefined"
              @click="openOperation = row.op"
            >
              {{ row.op.menuLabel }}
            </BaseButton>
          </KebabMenu>
        </template>
      </CardEffectiveConfig>

      <!--
        Step 6.5.5 — no change-history section here.

        Miki, 2026-08-16: "audit log section should belong on Audit Log page we have in settings and
        not on this page." A per-card audit table on the operating screen is a second place to look
        for something the Settings page already owns, and it pushed the card's own settings below
        the fold. `CardMutationHistory.vue` is kept: it is the component that page will render.
      -->

      <CardOperationDrawer
        v-if="capabilities"
        :open="openOperation !== null"
        :operation="openOperation"
        :card-id="id"
        :masked-ref="card.maskedRef"
        :version="card.version"
        :status="card.status"
        :override-uses="card.overrideUses"
        :override-all-locations="card.overrideAllLocations"
        :location-override-id="card.locationOverrideId"
        :prompts="cardPrompts"
        :capabilities="capabilities"
        :scopes="capabilities.scopes ?? []"
        @close="openOperation = null"
        @changed="query.refetch()"
      />
    </template>
  </div>
</template>
