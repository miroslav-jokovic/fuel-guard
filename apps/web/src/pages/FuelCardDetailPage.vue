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
import CardEffectiveConfig from "@/features/fuelCards/CardEffectiveConfig.vue";
import CardMutationHistory from "@/features/fuelCards/CardMutationHistory.vue";
import { availability, cardStatusLabel, cardStatusTone, freshness } from "@/features/fuelCards/cardControlModel";
import {
  CARD_OPERATIONS,
  type CardOperationSpec,
  blockedSentence,
  operationBlockedBy,
  operationById,
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

/** The Edit… link on the prompts table appears only when this person can actually reach that write. */
const promptsEditable = computed(() => {
  const caps = capabilities.value;
  const spec = operationById("prompts");
  if (!caps || !spec) return false;
  return operationBlockedBy(spec, caps, caps.scopes ?? []) === null;
});

/**
 * The Actions card — one button per operation, grouped by the question an operator is asking.
 *
 * ── Why unavailable operations are SHOWN, greyed, with a reason ─────────────────────────────────
 * Hiding them makes the page look like a dead end and generates tickets for a feature that is
 * already built (the same argument `availability()` makes for the whole panel). The exception is an
 * operation the card's own state makes meaningless — Unlock on a working card — which is filtered
 * out entirely: that is not a permission problem and greying it would invite somebody to hunt for a
 * permission that would not have helped.
 *
 * The Step 6.3 verify in words: a yard manager without the override scope sees Grant exception
 * greyed with "You are not on this company's approver list for this action. Ask an admin to add
 * you." — not a missing button.
 */
const actionGroups = computed(() => {
  const c = card.value;
  const caps = capabilities.value;
  if (!c || !caps) return [];
  const context = toOperationCard(c);
  const scopes = caps.scopes ?? [];
  const rows = CARD_OPERATIONS
    .filter((op) => op.applies(context))
    .map((op) => {
      const blocked = operationBlockedBy(op, caps, scopes);
      return { op, blocked, reason: blocked ? blockedSentence(blocked) : null };
    });
  return (["Card status", "Fuel access", "At the pump"] as const)
    .map((group) => ({ group, rows: rows.filter((r) => r.op.group === group) }))
    .filter((g) => g.rows.length > 0);
});

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

      <!-- One button per operation, grouped by the question being asked (Step 6.3). -->
      <BaseCard v-else-if="canAct && actionGroups.length > 0">
        <div class="space-y-5">
          <h2 class="text-sm font-medium text-ink">Card actions</h2>
          <div v-for="group in actionGroups" :key="group.group" class="space-y-2">
            <h3 class="text-xs font-semibold uppercase tracking-wide text-ink-tertiary">{{ group.group }}</h3>
            <div v-for="row in group.rows" :key="row.op.id" class="flex flex-wrap items-center gap-x-3 gap-y-1">
              <BaseButton
                variant="secondary"
                size="sm"
                :disabled="row.blocked !== null"
                @click="openOperation = row.op"
              >
                {{ row.op.menuLabel }}
              </BaseButton>
              <!-- Invariant 6 on the page as well as in the drawer: never a bare greyed button. -->
              <span v-if="row.reason" class="text-sm text-ink-muted">{{ row.reason }}</span>
            </div>
          </div>
        </div>
      </BaseCard>

      <CardEffectiveConfig
        v-if="query.data.value"
        :effective="query.data.value.effective"
        :policy-number="card.policyNumber"
        :card-id="id"
        :can-edit-prompts="promptsEditable"
      />

      <BaseCard>
        <div class="space-y-3">
          <h2 class="text-sm font-medium text-ink">Change history</h2>
          <CardMutationHistory :card-id="id" />
        </div>
      </BaseCard>

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
