<script setup lang="ts">
import { computed, ref } from "vue";
import { ALERT_TEXT_CONSENT, alertPhoneConfirmSchema, normalisePhone } from "@silvicom/shared";
import { AppButton as BaseButton, AppCheckbox as BaseCheckbox, AppFormField as FormField, AppInput as BaseInput, QueryState } from "@silvicom/ui";
import { useToastStore } from "@/stores/toast";
import { useConfirmAlertPhone, useMyAlertContact, useStartAlertPhone, useStopAlertTexts } from "./useAlertRouting";
import { useMyAlertsPanel } from "./useMyAlertsPanel";

/**
 * "Text alerts" under My alerts (HOME-TIME-PLAN D-HT17): a person gives their own mobile number, is
 * texted a 6-digit code, and types it back. That is the consent, with the words shown above the button.
 *
 * The four states are the server's (`alertContactState`). The refusals are shown in the server's words —
 * "2 tries left", "wait a minute" — beside the field, because they are what the person must act on.
 * Nothing is offered on a server that cannot send a text.
 */
const panel = useMyAlertsPanel();
const contact = useMyAlertContact(panel.open);
const start = useStartAlertPhone();
const confirm = useConfirmAlertPhone();
const stop = useStopAlertTexts();
const toast = useToastStore();

const phone = ref("");
const agreed = ref(false);
const code = ref("");
const said = ref<string | null>(null);
/** Asked to type a different number while a code is out, or after stopping. */
const changing = ref(false);

const state = computed(() => contact.data.value?.state ?? "none");
const last4 = computed(() => contact.data.value?.last4 ?? "");
const busy = computed(() => start.isPending.value || confirm.isPending.value || stop.isPending.value);
const showForm = computed(() => changing.value || state.value === "none");
const phoneOk = computed(() => normalisePhone(phone.value) !== null);
const codeOk = computed(() => alertPhoneConfirmSchema.safeParse({ code: code.value.trim() }).success);

async function run(step: () => Promise<unknown>, failed: string, done?: string): Promise<boolean> {
  said.value = null;
  try {
    await step();
    if (done) toast.success(done);
    return true;
  } catch (e) {
    said.value = e instanceof Error ? e.message : failed;
    return false;
  }
}

async function onStart(): Promise<void> {
  if (!phoneOk.value || !agreed.value) return;
  if (await run(() => start.mutateAsync({ phone: phone.value }), "Could not text that number.")) {
    changing.value = false;
    code.value = "";
  }
}
async function onConfirm(): Promise<void> {
  if (!codeOk.value) return;
  if (await run(() => confirm.mutateAsync({ code: code.value.trim() }), "Could not check the code.", "Text alerts are on")) {
    code.value = "";
    phone.value = "";
    agreed.value = false;
  }
}
const onStop = () => run(() => stop.mutateAsync(), "Could not stop text alerts.", "Text alerts are off");
function change(): void {
  changing.value = true;
  said.value = null;
}
</script>

<template>
  <section class="mt-6 border-t border-edge pt-4" data-testid="my-text-alerts">
    <h3 class="text-sm font-semibold text-ink">Text alerts</h3>
    <QueryState
      :loading="contact.isLoading.value"
      :error="contact.isError.value ? contact.error.value : null"
      :retrying="contact.isFetching.value"
      loading-text="Loading your text alerts…"
      error-text="Could not load your text alerts."
      @retry="contact.refetch()"
    >
      <p v-if="contact.data.value && !contact.data.value.available" class="mt-1 text-sm text-ink-muted">Text alerts are not set up yet.</p>

      <template v-else-if="contact.data.value">
        <template v-if="!showForm">
          <div v-if="state === 'verified'" class="mt-1 space-y-3">
            <p class="text-sm text-ink-secondary">On. Alerts your company routes to you by text go to the number ending in {{ last4 }}. Texts wait for the morning during your company's quiet hours.</p>
            <div class="flex flex-wrap gap-3">
              <BaseButton variant="secondary" :disabled="busy" @click="onStop">Stop text alerts</BaseButton>
              <BaseButton variant="link" :disabled="busy" @click="change">Use a different number</BaseButton>
            </div>
          </div>

          <div v-else-if="state === 'stopped'" class="mt-1 space-y-3">
            <p class="text-sm text-ink-secondary">Off. You stopped texts to the number ending in {{ last4 }}. To turn them on again, confirm a number.</p>
            <p class="text-xs text-ink-muted">If you stopped by replying STOP, first text START to the number our texts came from, or the code cannot reach you.</p>
            <BaseButton variant="secondary" :disabled="busy" @click="change">Confirm a number</BaseButton>
          </div>

          <form v-else class="mt-1 space-y-3" @submit.prevent="onConfirm">
            <p class="text-sm text-ink-secondary">We texted a 6-digit code to the number ending in {{ last4 }}. It works for 10 minutes.</p>
            <FormField v-slot="{ id }" label="Code">
              <BaseInput :id="id" v-model="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" class="max-w-40" />
            </FormField>
            <div class="flex flex-wrap gap-3">
              <BaseButton variant="primary" type="submit" :disabled="!codeOk || busy">Confirm</BaseButton>
              <BaseButton variant="link" :disabled="busy" @click="change">Send a new code or change the number</BaseButton>
            </div>
          </form>
        </template>

        <form v-else class="mt-1 space-y-3" @submit.prevent="onStart">
          <p class="text-sm text-ink-secondary">Get the alerts your company routes to you as a text on your own mobile phone.</p>
          <FormField v-slot="{ id }" label="Mobile number" hint="A US number, for example 708 555 0100.">
            <BaseInput :id="id" v-model="phone" type="tel" inputmode="tel" autocomplete="tel" class="max-w-60" />
          </FormField>
          <BaseCheckbox v-model="agreed">{{ ALERT_TEXT_CONSENT.text }}</BaseCheckbox>
          <div class="flex flex-wrap gap-3">
            <BaseButton variant="primary" type="submit" :disabled="!phoneOk || !agreed || busy">{{ start.isPending.value ? "Sending…" : "Text me a code" }}</BaseButton>
            <BaseButton v-if="state !== 'none'" variant="link" :disabled="busy" @click="changing = false">Cancel</BaseButton>
          </div>
        </form>

        <p v-if="said" class="mt-2 text-sm text-danger-700" role="alert">{{ said }}</p>
      </template>
    </QueryState>
  </section>
</template>
