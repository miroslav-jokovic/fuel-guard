<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { OPENING_BRIEF_SOURCE } from "@silvicom/shared";
import { AppButton as BaseButton, AppCallout, AppFormField as FormField, AppSelect } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import { useToastStore } from "@/stores/toast";
import { useAdsBrandKits } from "./useAdsBrandKits";
import { useCreateCampaign } from "./useAdsCampaigns";
import { useAdsConnections } from "./useAdsConnections";

/**
 * Start a campaign (E3): an open opening, an ad account and a brand kit. The openings arrive as a prop because
 * they are recruiting's, and one feature may not reach into another. The id is made once per opening of this
 * drawer, so a double press finds the row the first made (S1b). With one account or one kit it is chosen already.
 */
const props = defineProps<{ open: boolean; openings: Array<{ value: string; label: string }> }>();
const emit = defineEmits<{ close: []; created: [id: string] }>();

const FORM = "ads-campaign-form";

const toast = useToastStore();
const connections = useAdsConnections();
const kits = useAdsBrandKits();
const create = useCreateCampaign();

const accounts = computed(() => (connections.data.value ?? []).filter((c) => c.status === "connected").map((c) => ({ value: c.id, label: c.provider === "simulator" ? "Simulator" : c.account_ref ?? c.provider })));
const kitOptions = computed(() => (kits.data.value ?? []).filter((k) => k.archived_at === null && k.current).map((k) => ({ value: k.id, label: k.name })));

const id = ref("");
const opening = ref<string | null>(null);
const connection = ref<string | null>(null);
const kit = ref<string | null>(null);
const refused = ref<string | null>(null);
const ready = computed(() => Boolean(opening.value && connection.value && kit.value));

watch(() => props.open, (open) => {
  if (!open) return;
  id.value = crypto.randomUUID();
  opening.value = null;
  refused.value = null;
}, { immediate: true });
watch(accounts, (a) => { if (a.length === 1) connection.value = a[0]!.value; }, { immediate: true });
watch(kitOptions, (k) => { if (k.length === 1) kit.value = k[0]!.value; }, { immediate: true });

async function submit(): Promise<void> {
  if (!ready.value) return;
  refused.value = null;
  try {
    await create.mutateAsync({ id: id.value, brief_source: OPENING_BRIEF_SOURCE, brief_ref: opening.value!, connection_id: connection.value!, brand_kit_id: kit.value! });
    toast.success("Campaign started");
    emit("created", id.value);
  } catch (e) {
    refused.value = e instanceof Error ? e.message : "Could not create the campaign";
  }
}
</script>

<template>
  <SlideOver :open="open" title="New campaign" description="The agent writes and draws the ads. Nothing spends until an admin launches it." size="md" @close="emit('close')">
    <form :id="FORM" class="space-y-4" novalidate data-test="campaign-form" @submit.prevent="submit">
      <FormField v-slot="{ id: f }" label="Opening" required>
        <AppSelect :id="f" v-model="opening" :options="openings" placeholder="Choose…" data-test="opening" />
      </FormField>
      <FormField v-slot="{ id: f }" label="Ad account" required>
        <AppSelect :id="f" v-model="connection" :options="accounts" placeholder="Choose…" data-test="connection" />
      </FormField>
      <FormField v-slot="{ id: f }" label="Brand kit" required>
        <AppSelect :id="f" v-model="kit" :options="kitOptions" placeholder="Choose…" data-test="kit" />
      </FormField>
      <p v-if="accounts.length === 0 || kitOptions.length === 0" class="text-sm text-ink-muted" data-test="setup-missing">
        A campaign needs a connected ad account and a saved brand kit, both in Settings › Ads control.
      </p>
      <AppCallout v-if="refused" tone="danger" role="alert" data-test="campaign-refusal">{{ refused }}</AppCallout>
    </form>
    <template #footer>
      <div class="flex items-center justify-end gap-3">
        <BaseButton :disabled="create.isPending.value" @click="emit('close')">Cancel</BaseButton>
        <BaseButton variant="primary" type="submit" :form="FORM" :disabled="!ready || create.isPending.value" data-test="start-campaign">Start campaign</BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
