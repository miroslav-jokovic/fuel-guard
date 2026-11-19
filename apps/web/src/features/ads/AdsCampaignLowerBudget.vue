<script setup lang="ts">
import { computed, ref } from "vue";
import { AppButton as BaseButton, AppFormField as FormField, AppInput as BaseInput, AppTextarea } from "@silvicom/ui";
import { useToastStore } from "@/stores/toast";
import { centsFrom } from "./adsCampaignFlow";
import { usd } from "./spendLines";
import { useLowerBudget } from "./useAdsCampaigns";

/**
 * Lower a running campaign's daily budget (V5 part 2, Q-APX21; `ADS_AUTHORITY.lower_budget`). The safe direction, so
 * no fresh sign-in and no second approver: less can only be spent. The form takes only an amount below the one in
 * force and a reason, which the ledger keeps; the API refuses anything else, and so does the platform's adapter
 * against what the platform holds at that moment.
 */
const props = defineProps<{ campaignId: string; dailyCents: number }>();

const toast = useToastStore();
const lower = useLowerBudget();
const amount = ref("");
const reason = ref("");
const cents = computed(() => centsFrom(amount.value));
const ready = computed(() => cents.value !== null && cents.value < props.dailyCents && reason.value.trim().length > 0);
const tooHigh = computed(() => cents.value !== null && cents.value >= props.dailyCents);

async function submit(): Promise<void> {
  if (!ready.value) return;
  try {
    await lower.mutateAsync({ id: props.campaignId, lower: { daily_budget_cents: cents.value!, reason: reason.value.trim() } });
    toast.success(`Daily budget lowered to ${usd(cents.value!)}`);
    amount.value = "";
    reason.value = "";
  } catch (e) {
    toast.error("The budget was not lowered", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <form class="space-y-3" novalidate data-test="lower-form" @submit.prevent="submit">
    <h3 class="text-sm font-semibold text-ink">Lower the daily budget</h3>
    <p class="text-sm text-ink-muted">Now {{ usd(dailyCents) }} a day. Lowering takes effect at the ad platform at once; raising needs an admin's approval.</p>
    <div class="grid gap-4 sm:grid-cols-2">
      <FormField v-slot="{ id }" label="New daily budget ($)" :error="tooHigh ? `Lower than ${usd(dailyCents)}.` : undefined" required>
        <BaseInput :id="id" v-model="amount" inputmode="decimal" data-test="lower-amount" />
      </FormField>
      <FormField v-slot="{ id }" label="Why" required>
        <AppTextarea :id="id" v-model="reason" :rows="2" data-test="lower-reason" />
      </FormField>
    </div>
    <div class="flex justify-end">
      <BaseButton type="submit" :disabled="!ready || lower.isPending.value" data-test="lower">Lower the budget</BaseButton>
    </div>
  </form>
</template>
