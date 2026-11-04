<script setup lang="ts">
import { computed, ref } from "vue";
import type { AdsSettingsView } from "@silvicom/shared";
import { AppButton as BaseButton, AppCard as BaseCard, AppFormField as FormField, AppInput as BaseInput } from "@silvicom/ui";
import StepUpPrompt from "@/components/StepUpPrompt.vue";
import { useStepUpRetry } from "@/composables/useStepUpRetry";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { useSetKillSwitch } from "./useAdsSettings";

/**
 * The kill switch (ADS-AGENT-PLAN §4b, D-AD3): one button, a reason required. Who presses it and who clears
 * it are the API's doors (routes/guard.ts), asked here through the same rules, not a role list:
 *   · press — anyone who MANAGES recruitment, and no password prompt: a brake that asks for a password
 *     first is one nobody pulls in a hurry;
 *   · clear — `ads.spend`, admin only, with a fresh sign-in, because it lets spending start again.
 * Pressing pauses every campaign that is delivering; nothing launches or raises while it is on (AX021).
 */
const props = defineProps<{ view: AdsSettingsView }>();

const session = useSessionStore();
const toast = useToastStore();
const set = useSetKillSwitch();
const { stepUpFor, holdForStepUp, confirmed, cancel } = useStepUpRetry();

const reason = ref("");
const error = ref("");
const on = computed(() => props.view.kill_switch);
/** The act this person may take now; null when the switch's state is not theirs to change. */
const act = computed<"press" | "clear" | null>(() =>
  on.value ? (session.admin ? "clear" : null) : session.can("recruitment") ? "press" : null,
);

async function submit(): Promise<void> {
  const why = reason.value.trim();
  error.value = why ? "" : "Say why, so the next person knows.";
  if (!why || !act.value) return;
  const pressing = act.value === "press";
  try {
    await set.mutateAsync({ on: pressing, reason: why });
    reason.value = "";
    toast.success(pressing ? "Ads stopped" : "Kill switch cleared");
  } catch (e) {
    if (holdForStepUp(e, submit)) return;
    error.value = e instanceof Error ? e.message : "Could not change the kill switch";
  }
}
</script>

<template>
  <BaseCard v-if="stepUpFor" as="section">
    <StepUpPrompt :reason="stepUpFor" @confirmed="confirmed" @cancel="cancel" />
  </BaseCard>
  <BaseCard v-else as="section">
    <h2 class="text-sm font-semibold text-ink">Kill switch — {{ on ? "on" : "off" }}</h2>
    <p class="mt-1 text-sm text-ink-muted">
      <template v-if="on">
        Every campaign that was running is paused, and nothing can launch or raise its budget.
        Reason given: {{ view.kill_reason ?? "none recorded" }}.
      </template>
      <template v-else>Stops every running ad at once. Anyone who manages recruiting can press it; only an admin can clear it.</template>
    </p>
    <form v-if="act" id="ads-kill-switch" class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end" @submit.prevent="submit">
      <FormField v-slot="{ id }" label="Reason" :error="error" class="flex-1">
        <BaseInput :id="id" v-model="reason" maxlength="500" :invalid="Boolean(error)" :placeholder="act === 'press' ? 'Cost per lead doubled overnight' : 'Checked the account; spend is normal again'" />
      </FormField>
      <BaseButton type="submit" :variant="act === 'press' ? 'danger' : 'secondary'" :disabled="set.isPending.value">
        {{ act === "press" ? "Stop all ads" : "Clear the kill switch" }}
      </BaseButton>
    </form>
    <p v-else-if="on" class="mt-3 text-sm text-ink-muted">Only an admin can clear it.</p>
  </BaseCard>
</template>
