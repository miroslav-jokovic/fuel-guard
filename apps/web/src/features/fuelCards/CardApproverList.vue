<script setup lang="ts">
import { computed, ref } from "vue";
import {
  CARD_CONTROL_SCOPES,
  CARD_SCOPE_DESCRIPTIONS,
  CARD_SCOPE_LABELS,
  type CardControlScope,
} from "@fuelguard/shared";
import { AppButton as BaseButton } from "@fuelguard/ui";
import { AppCheckbox as BaseCheckbox } from "@fuelguard/ui";
import { AppCombobox as ComboSelect } from "@fuelguard/ui";
import { AppFormField as FormField } from "@fuelguard/ui";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import type { CardApproverRow, EligibleMember } from "./useCardControlSettings";

/**
 * The named people who may change a fuel card, and exactly what each of them may do.
 *
 * ── Why per-person scopes rather than one on/off ─────────────────────────────────────────────────
 * The arrangement real fleets ask for is a yard manager who can lock a stolen card at 2am but cannot
 * grant fuel exceptions. Collapsing that into "approver: yes" would force every customer to choose
 * between an unlocked 2am response and unmetered fuel authority.
 *
 * ── Why an ineligible person is shown rather than hidden ─────────────────────────────────────────
 * An approver whose ROLE changed after they were named still has a row, and the capability gate
 * refuses them. That is a stale grant somebody should clean up, so it renders with a caution badge
 * instead of quietly disappearing — a permission list that hides entries is a permission list nobody
 * can audit by looking at it.
 */

const props = defineProps<{
  approvers: CardApproverRow[];
  eligible: EligibleMember[];
  eligibleRoles: string[];
  busy: boolean;
  /** When false, the list is informational: the org lets every eligible role act without naming. */
  enforced: boolean;
}>();

const emit = defineEmits<{
  grant: [userId: string, scopes: CardControlScope[]];
  revoke: [userId: string];
}>();

const addingUserId = ref("");
const addingScopes = ref<CardControlScope[]>(["lock", "unlock"]);

/** Only people who are not already on the list — re-granting is done by editing their row. */
const addable = computed(() =>
  props.eligible
    .filter((m) => !props.approvers.some((a) => a.userId === m.userId))
    .map((m) => ({ value: m.userId, label: `${m.email ?? m.userId} — ${m.role.replace(/_/g, " ")}` })),
);

const roleWords = computed(() => props.eligibleRoles.map((r) => r.replace(/_/g, " ")).join(" and "));

function toggleAddScope(scope: CardControlScope): void {
  addingScopes.value = addingScopes.value.includes(scope)
    ? addingScopes.value.filter((s) => s !== scope)
    : [...addingScopes.value, scope];
}

function toggleScope(approver: CardApproverRow, scope: CardControlScope): void {
  const next = approver.scopes.includes(scope)
    ? approver.scopes.filter((s) => s !== scope)
    : [...approver.scopes, scope];
  // Removing the LAST scope is a revoke, not a grant of nothing. An approver row with no scopes is a
  // person who looks authorised and is not, which is the worst of both.
  if (next.length === 0) emit("revoke", approver.userId);
  else emit("grant", approver.userId, next);
}

function add(): void {
  if (!addingUserId.value || addingScopes.value.length === 0) return;
  emit("grant", addingUserId.value, addingScopes.value);
  addingUserId.value = "";
  addingScopes.value = ["lock", "unlock"];
}
</script>

<template>
  <div class="space-y-5">
    <p v-if="!props.enforced" class="rounded-control bg-caution-50 px-3 py-2 text-sm text-caution-700">
      The approver list is not being enforced, so every {{ roleWords }} in this company can change
      cards. The names below are kept, and take effect again the moment you switch enforcement back on.
    </p>

    <div v-if="props.approvers.length === 0" class="text-sm text-ink-muted">
      Nobody is named yet. While the approver list is enforced, that means no one can change a card.
    </div>

    <div v-for="approver in props.approvers" :key="approver.userId" class="space-y-3 rounded-control border border-edge p-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm font-medium text-ink">{{ approver.email ?? approver.userId }}</span>
          <span :class="[BADGE_BASE, toneClass('neutral')]">{{ (approver.role ?? "unknown").replace(/_/g, " ") }}</span>
          <span v-if="!approver.eligible" :class="[BADGE_BASE, toneClass('caution')]">
            Role no longer allows this
          </span>
        </div>
        <BaseButton size="sm" variant="ghost" :disabled="props.busy" @click="emit('revoke', approver.userId)">
          Remove
        </BaseButton>
      </div>

      <p v-if="!approver.eligible" class="text-sm text-caution-700">
        Their role changed since they were named, so card changes are refused for them regardless of
        what is ticked below. Remove them, or change their role back.
      </p>

      <div class="grid gap-2 sm:grid-cols-2">
        <BaseCheckbox
          v-for="scope in CARD_CONTROL_SCOPES"
          :key="scope"
          :model-value="approver.scopes.includes(scope)"
          :disabled="props.busy"
          class="items-start"
          @update:model-value="toggleScope(approver, scope)"
        >
          <span>
            {{ CARD_SCOPE_LABELS[scope] }}
            <span class="block text-ink-muted">{{ CARD_SCOPE_DESCRIPTIONS[scope] }}</span>
          </span>
        </BaseCheckbox>
      </div>
    </div>

    <div class="space-y-3 rounded-control border border-dashed border-edge p-3">
      <h3 class="text-sm font-medium text-ink">Name someone</h3>
      <p v-if="addable.length === 0" class="text-sm text-ink-muted">
        Everyone eligible is already named. Card changes are limited to {{ roleWords }} — change a
        person's role first if you need someone else on this list.
      </p>
      <template v-else>
        <FormField label="Who" hint="Only roles that may change cards appear here.">
          <template #default="{ id }">
            <ComboSelect
              :id="id"
              v-model="addingUserId"
              :options="addable"
              :disabled="props.busy"
              placeholder="Choose a person"
            />
          </template>
        </FormField>
        <div class="grid gap-2 sm:grid-cols-2">
          <BaseCheckbox
            v-for="scope in CARD_CONTROL_SCOPES"
            :key="scope"
            :model-value="addingScopes.includes(scope)"
            :disabled="props.busy"
            @update:model-value="toggleAddScope(scope)"
          >
            <span>{{ CARD_SCOPE_LABELS[scope] }}</span>
          </BaseCheckbox>
        </div>
        <div class="flex justify-end">
          <BaseButton
            variant="primary"
            size="sm"
            :disabled="props.busy || !addingUserId || addingScopes.length === 0"
            @click="add"
          >
            Add approver
          </BaseButton>
        </div>
      </template>
    </div>
  </div>
</template>
