<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { AppButton as BaseButton, AppFormField as FormField, AppInput as BaseInput, AppSelect, AppTextarea } from "@silvicom/ui";
import { MANUAL_LEAD_CHANNELS, leadChannelLabel, manualLeadSchema, normaliseEmail, normalisePhone } from "@silvicom/shared";
import SlideOver from "@/components/SlideOver.vue";
import { useToastStore } from "@/stores/toast";
import { useAddLead } from "./useLeadActions";
import { useOpenOpeningsQuery } from "./useLeads";

/**
 * A lead typed in by hand: a phone call, a walk-in, a referral, a pasted post (E4b4).
 *
 * `manualLeadSchema` is the rule, here as on the api. The two extra checks are for what the schema lets through on
 * purpose: it needs one good contact, so a mistyped phone beside a good email would pass, and the api would store
 * that phone as nothing. A recruiter should hear that now, while the number is in front of them.
 *
 * The opening is optional and a failed read does not block the form: a lead with no opening is still a lead.
 */
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; added: [leadId: string] }>();

const FORM = "add-lead-form";
const toast = useToastStore();
const add = useAddLead();
const openings = useOpenOpeningsQuery();
const channels = MANUAL_LEAD_CHANNELS.map((c) => ({ value: c, label: leadChannelLabel(c) }));
const openingOptions = computed(() => [{ value: null, label: "No opening" }, ...(openings.data.value ?? [])]);

const blank = () => ({ channel: null as string | null, full_name: "", phone: "", email: "", opening_id: null as string | null, note: "" });
const form = reactive(blank());
const tried = ref(false);
const busy = ref(false);
watch(
  () => props.open,
  () => {
    Object.assign(form, blank());
    tried.value = false;
  },
);

const parsed = computed(() =>
  manualLeadSchema.safeParse({ ...form, phone: form.phone.trim() || null, email: form.email.trim() || null, note: form.note.trim() || null }),
);
const errors = computed(() => {
  if (!tried.value) return {};
  const failed = new Map(parsed.value.error?.issues.map((i) => [i.path[0], i.message]));
  return {
    channel: failed.has("channel") ? "Choose how they came in." : undefined,
    full_name: failed.has("full_name") ? "Enter their name." : undefined,
    phone: failed.get("phone") ?? (form.phone.trim() && !normalisePhone(form.phone) ? "That phone number doesn't look right." : undefined),
    email: form.email.trim() && !normaliseEmail(form.email) ? "That email doesn't look right." : undefined,
  };
});

async function save(): Promise<void> {
  tried.value = true;
  if (busy.value || !parsed.value.success || Object.values(errors.value).some(Boolean)) return;
  busy.value = true;
  try {
    const { lead_id } = await add.mutateAsync(parsed.value.data);
    toast.success("Lead added");
    emit("added", lead_id);
  } catch (e) {
    toast.error("Could not add the lead", e instanceof Error ? e.message : undefined);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <SlideOver :open="open" title="Add a lead" description="Added by hand, so nobody is notified." size="lg" @close="emit('close')">
    <form :id="FORM" class="space-y-4" data-test="add-form" novalidate @submit.prevent="save">
      <FormField v-slot="{ id }" label="How they came in" required :error="errors.channel">
        <AppSelect :id="id" v-model="form.channel" :options="channels" placeholder="Choose…" data-test="channel" />
      </FormField>
      <FormField v-slot="{ id }" label="Name" required :error="errors.full_name">
        <BaseInput :id="id" v-model="form.full_name" maxlength="200" autocomplete="off" data-test="name" />
      </FormField>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField v-slot="{ id }" label="Phone" hint="A phone or an email is needed." :error="errors.phone">
          <BaseInput :id="id" v-model="form.phone" type="tel" maxlength="40" autocomplete="off" data-test="phone" />
        </FormField>
        <FormField v-slot="{ id }" label="Email" :error="errors.email">
          <BaseInput :id="id" v-model="form.email" type="email" maxlength="320" autocomplete="off" data-test="email" />
        </FormField>
      </div>
      <FormField v-slot="{ id }" label="Opening" :hint="openings.isError.value ? 'Could not load the openings. You can add the lead without one.' : undefined">
        <AppSelect :id="id" v-model="form.opening_id" :options="openingOptions" placeholder="" data-test="opening" />
      </FormField>
      <FormField v-slot="{ id }" label="Note">
        <AppTextarea :id="id" v-model="form.note" maxlength="4000" data-test="note" />
      </FormField>
    </form>
    <template #footer>
      <div class="flex items-center justify-end gap-3">
        <BaseButton :disabled="busy" @click="emit('close')">Cancel</BaseButton>
        <BaseButton variant="primary" type="submit" :form="FORM" :disabled="busy" data-test="save-add">{{ busy ? "Saving…" : "Add lead" }}</BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
