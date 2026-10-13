<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import StepUpPrompt from "@/components/StepUpPrompt.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import FactList, { type Fact } from "@/components/ui/FactList.vue";
import { useToastStore } from "@/stores/toast";
import { usePspPreflightQuery, useOrderPspRecord } from "@/features/recruitment/usePspOrder";

/**
 * The order confirmation (P9) — the screen whose job is to make a charge deliberate.
 *
 * ── WHAT IT SAYS ABOUT COST, AND WHAT IT REFUSES TO SAY ────────────────────────────────────────
 * PSP charges the transaction fee on Success, Partial AND Failure (§8), so the sentence that matters
 * is not "this may cost money" but "this bills even if PSP finds nothing". The outcomes are listed
 * from `billsOn`, which the API reads out of the §8.5 status table — not typed here, where they
 * would quietly stop matching.
 *
 * The per-transaction PRICE is unknown (PSP-PLAN Q2) and the drawer says so rather than showing a
 * plausible figure. `unitPriceUsd` renders only when the deployment has actually been told the
 * price. Somebody approving a spend needs the difference between a number and a guess.
 *
 * ── THE PASSWORD COMES LAST ────────────────────────────────────────────────────────────────────
 * The preflight never returns `step_up_required`; it returns the substantive blocker instead, so an
 * operator learns that the driver never signed the PSP disclosure BEFORE being asked to re-type
 * anything. The prompt appears only when the order itself asks for it.
 */
const props = defineProps<{ open: boolean; driverId: string; driverName: string }>();
const emit = defineEmits<{ close: [] }>();

const toast = useToastStore();
const open = computed(() => props.open);
const driverId = computed(() => props.driverId);
const preflight = usePspPreflightQuery(driverId, open);
const order = useOrderPspRecord();

const stepUpFor = ref<string | null>(null);
watch(open, (isOpen) => {
  if (!isOpen) stepUpFor.value = null;
});

const blocked = computed(() => preflight.data.value?.refusal ?? null);
const canOrder = computed(() => Boolean(preflight.data.value?.enabled) && !blocked.value);
/** The org's PSP allowance this month (D-US6). */
const budgetFacts = computed<Fact[]>(() => {
  const b = preflight.data.value?.budget;
  if (!b) return [];
  return [
    { label: "Used this month", value: b.used, numeric: true },
    { label: "Monthly limit", value: b.limit, numeric: true },
    { label: "Remaining", value: b.remaining, numeric: true },
  ];
});

async function place(): Promise<void> {
  try {
    const result = await order.mutateAsync(driverId.value);
    stepUpFor.value = null;
    toast.success(
      result.clean ? "PSP record filed — nothing on it" : "PSP record filed",
      "It is in the driver's qualification file.",
    );
    emit("close");
  } catch (e) {
    const refusal = e as { code?: string; message?: string };
    if (refusal.code === "step_up_required") {
      // Not an error to report — it is the next step, and the same button completes it.
      stepUpFor.value = refusal.message ?? "Confirm your password to order a PSP record.";
      return;
    }
    toast.error("Could not order the PSP record", refusal.message);
  }
}
</script>

<template>
  <SlideOver :open="open" size="lg" title="Order a PSP record" @close="emit('close')">
    <StepUpPrompt v-if="stepUpFor" :reason="stepUpFor" @confirmed="place" @cancel="stepUpFor = null" />

    <div v-else class="space-y-6">
      <div>
        <h3 class="text-sm font-semibold text-ink">{{ driverName }}</h3>
        <p class="mt-1 text-sm text-ink-muted">
          FMCSA returns five years of crash records and three years of roadside inspections. The
          request is built from this driver's licence number, state, name and date of birth — a
          mismatch in any of them is a charge for a record that does not match.
        </p>
      </div>

      <div v-if="preflight.isLoading.value" class="text-sm text-ink-muted">Checking…</div>

      <template v-else-if="preflight.data.value">
        <div class="rounded-surface bg-surface-muted p-3">
          <p class="text-xs font-medium text-ink-secondary">This transaction bills</p>
          <p class="mt-1 text-sm text-ink">
            PSP charges for
            <span class="font-medium">{{ preflight.data.value.billsOn.join(", ") }}</span>
            responses — including a search that matches nothing.
          </p>
          <p v-if="preflight.data.value.unitPriceUsd != null" class="mt-1 text-sm text-ink">
            ${{ preflight.data.value.unitPriceUsd.toFixed(2) }} per record.
          </p>
          <p v-else class="mt-1 text-sm text-ink-muted">
            The per-record price is not configured, so this screen cannot state the amount.
          </p>
        </div>

        <FactList :columns="3" :facts="budgetFacts" />

        <div v-if="blocked" class="rounded-surface bg-surface-muted p-3">
          <span :class="[BADGE_BASE, toneClass('warning')]">Cannot order</span>
          <p class="mt-2 text-sm text-ink">{{ blocked.message }}</p>
        </div>

        <p v-if="preflight.data.value.environment !== 'production'" class="text-sm text-ink-muted">
          This deployment is pointed at the PSP test environment.
        </p>
      </template>
    </div>

    <template v-if="!stepUpFor" #footer>
      <div class="flex items-center justify-end gap-3">
        <BaseButton variant="ghost" :disabled="order.isPending.value" @click="emit('close')">Cancel</BaseButton>
        <BaseButton variant="primary" :disabled="!canOrder || order.isPending.value" @click="place">
          {{ order.isPending.value ? "Ordering…" : "Order the record" }}
        </BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
