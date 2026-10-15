<script setup lang="ts">
import { computed, ref, toRef } from "vue";
import { AppButton, AppCallout, AppCard, useConfirm } from "@silvicom/ui";
import { ApiRequestError } from "@/lib/api";
import { useOrgSwitch } from "@/lib/queries";

/**
 * One customer's switches of one kind: its integrations' kill switches, or its module entitlements.
 *
 * ── TURNING ONE OFF ASKS FIRST (D-US7) ─────────────────────────────────────────────────────────
 * Switching an integration off stops that customer's data feed; revoking a module takes its screens
 * away from everyone in their office. Both are one click from a list, so both ask in the product's own
 * dialog and name what stops. Turning one ON does not ask: it takes nothing away.
 *
 * ── A REFUSAL STAYS IN THIS CARD ───────────────────────────────────────────────────────────────
 * Before US7 a refused switch wrote the page's one `error` ref, and the whole customer page was
 * replaced by a red line. It is this card's sentence now, beside the switch that was refused.
 */
export interface OrgSwitch {
  key: string;
  label: string;
  on: boolean;
  /** What the switch's state reads as: "enabled", "granted", "revoked", "not granted". */
  status: string;
}

const props = defineProps<{
  orgId: string;
  kind: "modules" | "entitlements";
  title: string;
  description: string;
  items: OrgSwitch[];
  canManage: boolean;
  /** The verbs: ["Enable", "Disable"] or ["Grant", "Revoke"]. */
  verbs: [on: string, off: string];
  /** What switching `label` off does, for the dialog. */
  offConsequence: (label: string) => string;
  emptyText: string;
}>();

const change = useOrgSwitch(toRef(props, "orgId"), props.kind);
const ask = useConfirm();
const pending = ref<string | null>(null);
const failure = ref<string | null>(null);
const [onVerb, offVerb] = props.verbs;

async function flip(item: OrgSwitch) {
  failure.value = null;
  if (item.on) {
    const yes = await ask({
      title: `${offVerb} ${item.label}?`,
      message: props.offConsequence(item.label),
      confirmLabel: offVerb,
      tone: "danger",
    });
    if (!yes) return;
  }
  pending.value = item.key;
  try {
    await change.mutateAsync({ key: item.key, enabled: !item.on });
  } catch (e) {
    failure.value =
      e instanceof ApiRequestError && e.code === "step_up_required"
        ? "This change needs a fresh authenticator code. Sign out and sign in again, then retry."
        : e instanceof ApiRequestError && e.status === 403
          ? "Only a platform owner or admin can change this."
          : `Could not ${item.on ? offVerb.toLowerCase() : onVerb.toLowerCase()} ${item.label}.`;
  } finally {
    pending.value = null;
  }
}
const busy = computed(() => pending.value !== null);
</script>

<template>
  <AppCard>
    <h2 class="text-sm font-semibold text-ink-secondary">{{ title }}</h2>
    <p class="mt-1 text-xs text-ink-muted">{{ description }}</p>
    <AppCallout v-if="failure" tone="danger" class="mt-3" role="alert">{{ failure }}</AppCallout>
    <ul class="mt-3 grid gap-2 text-sm sm:grid-cols-2">
      <li
        v-for="item in items"
        :key="item.key"
        class="flex items-center justify-between gap-2 rounded-control border border-edge-subtle px-3 py-2"
      >
        <span class="text-ink">{{ item.label }}</span>
        <div class="flex items-center gap-2">
          <span :class="item.on ? 'text-success-700' : 'text-ink-muted'">{{ item.status }}</span>
          <AppButton
            v-if="canManage"
            size="sm"
            :variant="item.on ? 'soft' : 'primary'"
            :disabled="busy"
            @click="flip(item)"
          >
            {{ pending === item.key ? "Saving…" : item.on ? offVerb : onVerb }}
          </AppButton>
        </div>
      </li>
      <li v-if="items.length === 0" class="text-ink-muted">{{ emptyText }}</li>
    </ul>
  </AppCard>
</template>
