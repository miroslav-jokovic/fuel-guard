<script setup lang="ts">
import { ref } from "vue";
import { adsMetaConnectSchema, type AdsMetaConnect } from "@silvicom/shared";
import { AppButton as BaseButton, AppFormField as FormField, AppInput as BaseInput, AppPasswordInput as PasswordInput, AppSwitch as BaseSwitch } from "@silvicom/ui";

/**
 * Connect a Meta ad account (workflow §6 step 4, the owner's G1 click-path): the system user's token,
 * pasted once, with the ad account and Page it is for. The contract judges it here first
 * (`adsMetaConnectSchema`) so its own sentence is shown, then the API tests it with Meta before storing
 * anything. The token never comes back: the form is cleared after every attempt that reached the API.
 */
defineProps<{ busy: boolean }>();
const emit = defineEmits<{ submit: [ask: AdsMetaConnect]; cancel: [] }>();

const token = ref("");
const account = ref("");
const page = ref("");
const sandbox = ref(false);
const error = ref<{ field: string; message: string } | null>(null);
const errorOn = (f: string) => (error.value?.field === f ? error.value.message : undefined);

function submit(): void {
  const parsed = adsMetaConnectSchema.safeParse({ token: token.value, account_id: account.value, page_id: page.value, sandbox: sandbox.value });
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    error.value = { field: String(issue.path[0]), message: issue.message };
    return;
  }
  error.value = null;
  emit("submit", parsed.data);
  token.value = "";
}
</script>

<template>
  <form id="ads-meta-connect" class="grid gap-4 sm:grid-cols-2" @submit.prevent="submit">
    <FormField v-slot="{ id }" label="System user token" hint="From Meta Business Settings › System users. Stored sealed; never shown again." :error="errorOn('token')" class="sm:col-span-2">
      <PasswordInput :id="id" v-model="token" autocomplete="off" />
    </FormField>
    <FormField v-slot="{ id }" label="Ad account id" hint="As Ads Manager shows it, act_ optional." :error="errorOn('account_id')">
      <BaseInput :id="id" v-model="account" inputmode="numeric" autocomplete="off" />
    </FormField>
    <FormField v-slot="{ id }" label="Facebook Page id" :error="errorOn('page_id')">
      <BaseInput :id="id" v-model="page" inputmode="numeric" autocomplete="off" />
    </FormField>
    <div class="flex items-center justify-between gap-4 sm:col-span-2">
      <p class="text-sm text-ink">Meta's sandbox ad account, for testing (spends nothing)</p>
      <BaseSwitch v-model="sandbox" label="Meta's sandbox ad account" />
    </div>
    <div class="flex justify-end gap-2 sm:col-span-2">
      <BaseButton variant="secondary" @click="emit('cancel')">Cancel</BaseButton>
      <BaseButton type="submit" variant="primary" :disabled="busy">Test and connect</BaseButton>
    </div>
  </form>
</template>
