<script setup lang="ts">
import { computed, ref } from "vue";
import { AppIcon } from "@fuelguard/ui";
import { CheckIcon, XMarkIcon } from "@fuelguard/ui/icons";
import { AppButton as BaseButton } from "@fuelguard/ui";
import { AppCard as BaseCard } from "@fuelguard/ui";
import { AppInput as BaseInput } from "@fuelguard/ui";
import { AppCheckbox as BaseCheckbox } from "@fuelguard/ui";
import { AppFormField as FormField } from "@fuelguard/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import StepUpPrompt from "@/components/StepUpPrompt.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useToastStore } from "@/stores/toast";
import { useCardControlProbe, CardControlApiError } from "@/features/fuelCards/useCardControl";
import CardApproverList from "@/features/fuelCards/CardApproverList.vue";
import {
  useCardControlSettings,
  useGrantCardApprover,
  useRevokeCardApprover,
  useUpdateCardControlSettings,
} from "@/features/fuelCards/useCardControlSettings";
import type { CardControlScope } from "@fuelguard/shared";

/**
 * The EFS write check — the gate that decides whether card actions exist at all.
 *
 * ── What this page is for ────────────────────────────────────────────────────────────────────────
 * `setCardV2` is a full-document write: EFS accepts a well-formed request that silently deletes a
 * driver assignment and reports nothing wrong. So before this product is allowed to change ANY card,
 * six things have to be proved against real vendor data — and the sixth is the one that matters: a
 * no-op echo must leave the card's version byte-identical. If it moves, our request altered a card
 * while claiming to change nothing, and card actions stay switched off no matter what EFS said.
 *
 * ── Why the read-only run is the default ─────────────────────────────────────────────────────────
 * Steps one to four need no write permission and touch nothing, and they answer the question that
 * fails most often: does OUR echo reproduce THIS account's card XML exactly. Running that first costs
 * one paced vendor call and can be done on any card. The write half needs a card WEX has confirmed is
 * disposable, a typed confirmation naming its last four, and a sign-in from the last five minutes.
 */

const toast = useToastStore();
const probe = useCardControlProbe();
const query = useCardControlSettings();
const updateSettings = useUpdateCardControlSettings();
const grant = useGrantCardApprover();
const revoke = useRevokeCardApprover();

const settings = computed(() => query.data.value?.settings ?? null);
const busy = computed(
  () => updateSettings.isPending.value || grant.isPending.value || revoke.isPending.value,
);

/**
 * Every mutation on this page can come back asking for a password. Rather than five copies of that
 * handling, one runner: do the thing, and if the API says the sign-in is stale, park the action and
 * show the prompt. Confirming replays exactly what was parked.
 */
const pending = ref<null | (() => Promise<void>)>(null);

async function guarded(run: () => Promise<void>, failureTitle: string): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (error instanceof CardControlApiError && error.code === "step_up_required") {
      pending.value = run;
      stepUp.value = true;
      return;
    }
    toast.error(failureTitle, error instanceof Error ? error.message : undefined);
  }
}

async function afterStepUp(): Promise<void> {
  stepUp.value = false;
  const action = pending.value;
  pending.value = null;
  if (action) await guarded(action, "That did not work");
  else await run();
}

const setEnabled = (enabled: boolean) =>
  guarded(async () => {
    await updateSettings.mutateAsync({ enabled });
    toast.success(enabled ? "Card actions switched on" : "Card actions switched off");
  }, "Could not change that setting");

const setRequireApprover = (requireApprover: boolean) =>
  guarded(async () => {
    await updateSettings.mutateAsync({ requireApprover });
    toast.success(requireApprover ? "Approver list is enforced" : "Approver list is no longer enforced");
  }, "Could not change that setting");

const onGrant = (userId: string, scopes: CardControlScope[]) =>
  guarded(async () => {
    await grant.mutateAsync({ userId, scopes });
    toast.success("Permissions saved");
  }, "Could not save those permissions");

const onRevoke = (userId: string) =>
  guarded(async () => {
    await revoke.mutateAsync(userId);
    toast.success("Approver removed");
  }, "Could not remove that approver");

const cardNumber = ref("");
const confirm = ref("");
const readOnly = ref(true);
const stepUp = ref(false);

const last4 = computed(() => cardNumber.value.trim().slice(-4));
const ready = computed(
  () => /^[0-9]{10,25}$/.test(cardNumber.value.trim())
    && (readOnly.value || confirm.value.trim().toUpperCase() === `WRITE ${last4.value}`),
);

const result = computed(() => probe.data.value ?? null);

const entitlementTone = (entitlement: string): string =>
  entitlement === "confirmed" ? "success" : entitlement === "denied" ? "danger" : "caution";

async function run(): Promise<void> {
  try {
    const outcome = await probe.mutateAsync({
      cardNumber: cardNumber.value.trim(),
      confirm: confirm.value.trim(),
      readOnly: readOnly.value,
    });
    // The card number is never persisted anywhere — not by the API, and not here.
    cardNumber.value = "";
    confirm.value = "";
    if (outcome.entitlement === "confirmed") toast.success("Write access confirmed", outcome.verdict);
    else toast.warning("Write access not confirmed", outcome.verdict);
  } catch (error) {
    if (error instanceof CardControlApiError && error.code === "step_up_required") {
      stepUp.value = true;
      return;
    }
    toast.error("Could not run the write check", error instanceof Error ? error.message : undefined);
  }
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Prove EFS will accept our card changes — and that a no-op change leaves a card untouched." />

    <BaseCard v-if="stepUp">
      <StepUpPrompt
        :reason="pending ? 'Changing who may act on fuel cards needs a recent sign-in.' : 'Running the EFS write check sends a real change to a real card.'"
        @confirmed="afterStepUp"
        @cancel="stepUp = false; pending = null"
      />
    </BaseCard>

    <!-- ── Who may act ──────────────────────────────────────────────────────────────────────── -->
    <BaseCard v-if="!stepUp && settings">
      <div class="space-y-4">
        <div class="flex flex-wrap items-center gap-3">
          <h2 class="text-sm font-medium text-ink">Card actions</h2>
          <span :class="[BADGE_BASE, toneClass(settings.enabled ? 'success' : 'neutral')]">
            {{ settings.enabled ? "On" : "Off" }}
          </span>
          <span :class="[BADGE_BASE, toneClass(entitlementTone(settings.writeEntitlement))]">
            EFS write access: {{ settings.writeEntitlement }}
          </span>
        </div>

        <BaseCheckbox
          :model-value="settings.enabled"
          :disabled="busy || (!settings.enabled && settings.writeEntitlement !== 'confirmed')"
          class="items-start"
          @update:model-value="setEnabled"
        >
          <span>
            Let this company change fuel cards.
            <span class="block text-ink-muted">
              Off by default. Being able to READ cards never implies permission to change them.
            </span>
          </span>
        </BaseCheckbox>

        <p v-if="settings.writeEntitlement !== 'confirmed'" class="rounded-control bg-caution-50 px-3 py-2 text-sm text-caution-700">
          Card actions cannot be switched on until the EFS write check has passed — run it below.
          <template v-if="settings.probeVerdict"> Last check: {{ settings.probeVerdict }}</template>
        </p>

        <BaseCheckbox
          :model-value="settings.requireApprover"
          :disabled="busy"
          class="items-start"
          @update:model-value="setRequireApprover"
        >
          <span>
            Only named people may change cards.
            <span class="block text-ink-muted">
              On by default. Turning this off gives every {{ (query.data.value?.eligibleRoles ?? []).join(" and ").replace(/_/g, " ") }}
              in this company the ability to lock cards and grant fuel exceptions.
            </span>
          </span>
        </BaseCheckbox>
      </div>
    </BaseCard>

    <!-- ── The approver list ────────────────────────────────────────────────────────────────── -->
    <BaseCard v-if="!stepUp && query.data.value">
      <div class="space-y-4">
        <div class="space-y-1">
          <h2 class="text-sm font-medium text-ink">Who may change a card</h2>
          <p class="text-sm text-ink-muted">
            Card changes are limited to
            {{ (query.data.value.eligibleRoles ?? []).join(" and ").replace(/_/g, " ") }} — a dispatcher
            granting fuel exceptions is the pattern this product exists to detect. Within those roles,
            name the individuals and choose what each one may do.
          </p>
        </div>
        <CardApproverList
          :approvers="query.data.value.approvers"
          :eligible="query.data.value.eligible"
          :eligible-roles="query.data.value.eligibleRoles"
          :busy="busy"
          :enforced="query.data.value.settings.requireApprover"
          @grant="onGrant"
          @revoke="onRevoke"
        />
      </div>
    </BaseCard>

    <!-- ── The gate ─────────────────────────────────────────────────────────────────────────── -->
    <BaseCard v-if="!stepUp">
      <div class="space-y-4">
        <div class="space-y-1">
          <h2 class="text-sm font-medium text-ink">Run the check</h2>
          <p class="text-sm text-ink-muted">
            Use a card WEX has confirmed is disposable, on the QA endpoint first. The card number is
            never stored — only its last four digits appear in the audit log.
          </p>
        </div>

        <FormField label="Card number" required hint="Digits only. Never saved.">
          <template #default="{ id }">
            <BaseInput :id="id" v-model="cardNumber" type="text" inputmode="numeric" autocomplete="off" :disabled="probe.isPending.value" />
          </template>
        </FormField>

        <BaseCheckbox v-model="readOnly" :disabled="probe.isPending.value" class="items-start">
          <span>
            Check the echo only — do not send a change.
            <span class="block text-ink-muted">
              Proves our request reproduces this account's card exactly. Needs no write permission and
              changes nothing. Start here.
            </span>
          </span>
        </BaseCheckbox>

        <FormField
          v-if="!readOnly"
          label="Type the confirmation"
          required
          :hint="`Type WRITE ${last4 || '####'} to confirm a real setCardV2 against this card.`"
        >
          <template #default="{ id }">
            <BaseInput :id="id" v-model="confirm" type="text" autocomplete="off" :disabled="probe.isPending.value" />
          </template>
        </FormField>

        <div class="flex justify-end">
          <BaseButton variant="primary" :disabled="!ready || probe.isPending.value" @click="run">
            {{ probe.isPending.value ? "Checking…" : readOnly ? "Check the echo" : "Run the write check" }}
          </BaseButton>
        </div>
      </div>
    </BaseCard>

    <BaseCard v-if="result">
      <div class="space-y-4">
        <div class="flex flex-wrap items-center gap-3">
          <h2 class="text-sm font-medium text-ink">Result</h2>
          <span :class="[BADGE_BASE, toneClass(entitlementTone(result.entitlement)), 'capitalize']">{{ result.entitlement }}</span>
          <span class="text-sm text-ink-muted">{{ result.environment }}</span>
        </div>
        <p class="text-sm leading-6 text-ink">{{ result.verdict }}</p>

        <ul class="space-y-2">
          <li v-for="step in result.steps" :key="step.step" class="flex items-start gap-2 text-sm">
            <AppIcon
              :icon="step.ok ? CheckIcon : XMarkIcon"
              class="mt-0.5 size-4 shrink-0"
              :class="step.ok ? 'text-success-600' : 'text-danger-600'"
              aria-hidden="true"
            />
            <span>
              <span class="text-ink">{{ step.step }}. {{ step.name }}</span>
              <span class="ml-2 text-ink-tertiary">{{ step.ms }}ms</span>
              <span v-if="step.detail" class="block text-ink-muted">{{ step.detail }}</span>
              <span v-if="step.error" class="block text-danger-700">{{ step.error }}</span>
            </span>
          </li>
        </ul>

        <!--
          The response shape, stated next to the verdict rather than buried in the document below.

          This account answers `nested:header`; every example in the WEX guide is flat. Reading the
          wrong one gave us a parser that saw zero prompts and an echo that would have deleted them.
          A QA proof only carries to production if both environments say the same thing here.
        -->
        <p v-if="result.documentShape" class="text-sm text-ink-muted">
          EFS answered in the <span class="font-medium text-ink">{{ result.documentShape }}</span>
          shape. Compare it against the other environment before switching writes on — a proof
          obtained on one shape does not carry to the other.
        </p>

        <!--
          What a no-op echo moved. THE finding when the gate fails, so it goes above the documents
          rather than inside a collapsed section: "cardVersion moved" tells an operator to stop,
          and nothing else; the field names tell an engineer where to look.
        -->
        <div v-if="result.changed?.length" class="rounded-md border border-danger-200 bg-danger-50 p-3">
          <h3 class="text-sm font-medium text-danger-700">
            Our request changed {{ result.changed.length }} field(s) it should have left alone
          </h3>
          <ul class="mt-2 space-y-1 font-mono text-xs text-danger-700">
            <li v-for="d in result.changed" :key="d.path">
              {{ d.path }}: {{ d.expected.join("|") || "(absent)" }} → {{ d.actual.join("|") || "(absent)" }}
            </li>
          </ul>
        </div>

        <!--
          Textareas rather than a collapsed <details>: the content of a closed <details> cannot be
          selected or copied, which is how three consecutive probe runs were reported back with an
          empty document block while the diagnosis waited on exactly that text.
        -->
        <FormField v-if="result.document" label="The card as EFS sent it — card numbers masked">
          <template #default="{ id }">
            <textarea
              :id="id"
              class="h-48 w-full rounded-md border border-edge bg-surface p-2 font-mono text-xs text-ink-muted"
              readonly
              :value="result.document"
            />
          </template>
        </FormField>

        <FormField v-if="result.documentAfter" label="The card after the write — card numbers masked">
          <template #default="{ id }">
            <textarea
              :id="id"
              class="h-48 w-full rounded-md border border-edge bg-surface p-2 font-mono text-xs text-ink-muted"
              readonly
              :value="result.documentAfter"
            />
          </template>
        </FormField>

        <p v-if="result.egressIp" class="text-sm text-ink-muted">
          This request left from <span class="font-mono text-ink">{{ result.egressIp }}</span> —
          the address EFS sees, and the one that has to be on their allowlist.
        </p>

        <p v-if="!result.persisted" class="text-sm text-caution-700">
          The result above is accurate, but it could not be saved to this company's settings. Card
          actions stay switched off until it is — run the check again.
        </p>
      </div>
    </BaseCard>
  </div>
</template>
