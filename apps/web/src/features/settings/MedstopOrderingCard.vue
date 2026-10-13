<script setup lang="ts">
import { ref, watch } from "vue";
import type { MedstopConnectionStatus } from "@silvicom/shared";
import { AppButton as BaseButton, AppCard as BaseCard, AppFormField as FormField, AppInput as BaseInput } from "@silvicom/ui";
import StepUpPrompt from "@/components/StepUpPrompt.vue";
import { useStepUpRetry } from "@/composables/useStepUpRetry";
import { useSaveMedstopOrdering } from "@/features/settings/useMedstopConnection";
import { useToastStore } from "@/stores/toast";

/**
 * Ordering tests from Silvicom 360 (MEDSTOP-PLAN.md §7A.10; 0468). Off until the owner's first watched
 * order (answer 2): every order is billed and real — Med-Stop has no test host. The office contact is
 * what every order carries in Med-Stop's required phone and e-mail fields, instead of the driver's,
 * with Med-Stop's own texts and e-mails off (answer 5).
 */
const props = defineProps<{ status: MedstopConnectionStatus }>();

const save = useSaveMedstopOrdering();
const toast = useToastStore();
const { stepUpFor, holdForStepUp, confirmed, cancel } = useStepUpRetry();

const email = ref("");
const phone = ref("");
const error = ref("");
watch(
  () => props.status,
  (s) => {
    email.value = s.orderContactEmail ?? "";
    phone.value = s.orderContactPhone ?? "";
  },
  { immediate: true },
);

async function submit(enabled: boolean): Promise<void> {
  const digits = phone.value.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  const mail = email.value.trim();
  error.value =
    (mail || digits) && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail) ? "Enter the office's e-mail address."
    : (mail || digits) && digits.length !== 10 ? "Enter the office's 10-digit phone number."
    : enabled && (!mail || !digits) ? "Ordering needs the office's e-mail and phone."
    : "";
  if (error.value) return;
  try {
    await save.mutateAsync({ enabled, email: mail || null, phone: digits || null });
    toast.success(enabled ? "Ordering switched on" : props.status.ordersEnabled ? "Ordering switched off" : "Office contact saved");
  } catch (e) {
    if (holdForStepUp(e, () => submit(enabled))) return;
    error.value = e instanceof Error ? e.message : "Could not save";
  }
}
</script>

<template>
  <BaseCard v-if="stepUpFor" as="section">
    <StepUpPrompt :reason="stepUpFor" @confirmed="confirmed" @cancel="cancel" />
  </BaseCard>
  <BaseCard v-else as="section">
    <h2 class="text-sm font-semibold text-ink">Ordering tests — {{ status.ordersEnabled ? "on" : "off" }}</h2>
    <p class="mt-1 text-xs text-ink-muted">
      When on, admins, safety managers and recruiters can order a drug or alcohol test from Safety › Drug &amp; Alcohol.
      Every order is billed to the company's Med-Stop credit and is real — Med-Stop has no test system. Med-Stop will not
      text or e-mail the driver: its notices go to the office contact below.
    </p>
    <div class="mt-4 grid gap-4 sm:grid-cols-2">
      <FormField v-slot="{ id }" label="Office e-mail" :error="error">
        <BaseInput :id="id" v-model="email" type="email" autocomplete="off" :invalid="Boolean(error)" />
      </FormField>
      <FormField v-slot="{ id }" label="Office phone">
        <BaseInput :id="id" v-model="phone" type="tel" autocomplete="off" placeholder="312 555 0100" />
      </FormField>
    </div>
    <div class="mt-4 flex flex-wrap items-center justify-end gap-2">
      <BaseButton :disabled="save.isPending.value" @click="submit(status.ordersEnabled)">Save contact</BaseButton>
      <BaseButton v-if="status.ordersEnabled" variant="secondary" :disabled="save.isPending.value" @click="submit(false)">Switch ordering off</BaseButton>
      <BaseButton v-else variant="primary" :disabled="save.isPending.value || !status.hasKey" @click="submit(true)">Switch ordering on</BaseButton>
    </div>
  </BaseCard>
</template>
