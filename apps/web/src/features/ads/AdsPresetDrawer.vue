<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AD_FORMATS, type AdFormat, type AdPresetView } from "@silvicom/shared";
import { AppButton as BaseButton, AppCallout, AppFormField as FormField, AppInput as BaseInput, AppSelect, AppSwitch as BaseSwitch, AppTextarea } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import { useToastStore } from "@/stores/toast";
import { blankPresetForm, layoutOptions, presetFormFrom, presetSaveFrom, type PresetForm } from "./adsPresetForm";
import { useSavePreset } from "./useAdsPresets";

/**
 * Make a concept preset, or its next version (E2; plan D-AD11). A preset is a fixed recipe: the workers fill its
 * slots and change nothing else, so this form is where its wording and its limits are decided.
 */
const props = defineProps<{ open: boolean; preset: AdPresetView | null }>();
const emit = defineEmits<{ close: [] }>();

const FORM = "ads-preset-form";
const STARTS = [{ value: "equipment_photo", label: "One of our equipment photos" }, { value: "text_only", label: "Nothing: an empty road, sky or cab" }];

const toast = useToastStore();
const save = useSavePreset();
const form = ref<PresetForm>(blankPresetForm());
const refusal = ref<string | null>(null);
const nextVersion = computed(() => (props.preset?.current?.version ?? 0) + 1);
const slots = computed(() => form.value.copy_slots.map((c) => c.name.trim()).filter(Boolean).map((n) => ({ value: n, label: n })));

watch(() => props.open, (open) => {
  if (!open) return;
  refusal.value = null;
  const p = props.preset;
  form.value = p?.current ? presetFormFrom(p.key, p.current.enabled, p.current.body) : blankPresetForm();
}, { immediate: true });

function setFormat(f: AdFormat, on: boolean): void {
  form.value.formats = AD_FORMATS.filter((x) => (x === f ? on : form.value.formats.includes(x)));
}

async function submit(): Promise<void> {
  const ask = presetSaveFrom(form.value);
  if (!ask.ok) {
    refusal.value = ask.message;
    return;
  }
  refusal.value = null;
  try {
    await save.mutateAsync(ask.save);
    toast.success(props.preset ? `Saved as version ${nextVersion.value}` : "Preset saved");
    emit("close");
  } catch (e) {
    toast.error("Could not save the preset", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <SlideOver :open="open" :title="preset ? `Edit ${preset.key}` : 'New preset'" description="Ads made earlier keep the version they were made with." size="lg" @close="emit('close')">
    <form :id="FORM" class="space-y-6" novalidate data-test="preset-form" @submit.prevent="submit">
      <FormField v-if="!preset" v-slot="{ id }" label="Key" hint="Short, in capitals, like P2." required>
        <BaseInput :id="id" v-model="form.key" data-test="preset-key" />
      </FormField>
      <FormField v-slot="{ id }" label="Name" required><BaseInput :id="id" v-model="form.name" data-test="preset-name" /></FormField>
      <FormField v-slot="{ id }" label="Hook" hint="What the first line should do, for the copywriter." required>
        <AppTextarea :id="id" v-model="form.hook_formula" rows="2" />
      </FormField>
      <div class="flex items-center justify-between gap-4">
        <p class="text-sm text-ink">Use this preset for new ads</p>
        <BaseSwitch v-model="form.enabled" label="Use this preset for new ads" />
      </div>

      <fieldset class="space-y-2">
        <legend class="text-sm font-semibold text-ink">Copy</legend>
        <p class="text-sm text-ink-muted">Each piece of text the copywriter fills, in reading order, with the most characters it may hold.</p>
        <div v-for="(c, i) in form.copy_slots" :key="i" class="flex items-end gap-2">
          <FormField v-slot="{ id }" label="Slot" class="flex-1"><BaseInput :id="id" v-model="c.name" :data-test="`slot-name-${i}`" /></FormField>
          <FormField v-slot="{ id }" label="Most characters" class="flex-1"><BaseInput :id="id" v-model.number="c.max_chars" type="number" :data-test="`slot-max-${i}`" /></FormField>
          <BaseButton :disabled="form.copy_slots.length === 1" @click="form.copy_slots.splice(i, 1)">Remove</BaseButton>
        </div>
        <BaseButton @click="form.copy_slots.push({ name: '', max_chars: null })">Add a slot</BaseButton>
      </fieldset>

      <fieldset class="grid gap-4 sm:grid-cols-2">
        <legend class="text-sm font-semibold text-ink">Where the copy goes</legend>
        <FormField v-slot="{ id }" label="On the image: headline" required><AppSelect :id="id" v-model="form.overlay_headline" :options="slots" placeholder="Choose…" /></FormField>
        <FormField v-slot="{ id }" label="On the image: call to action" required><AppSelect :id="id" v-model="form.overlay_cta" :options="slots" placeholder="Choose…" /></FormField>
        <FormField v-slot="{ id }" label="Beside the image: primary text" required><AppSelect :id="id" v-model="form.platform_primary_text" :options="slots" placeholder="Choose…" /></FormField>
        <FormField v-slot="{ id }" label="Beside the image: headline" required><AppSelect :id="id" v-model="form.platform_headline" :options="slots" placeholder="Choose…" /></FormField>
      </fieldset>

      <fieldset class="space-y-3">
        <legend class="text-sm font-semibold text-ink">The picture</legend>
        <FormField v-slot="{ id }" label="Image prompt" hint="Write {a_slot} where the art director fills something in." required>
          <AppTextarea :id="id" v-model="form.image_prompt_template" rows="3" data-test="preset-template" />
        </FormField>
        <FormField v-slot="{ id }" label="The picture starts from" required><AppSelect :id="id" v-model="form.starts_from" :options="STARTS" /></FormField>
        <FormField v-slot="{ id }" label="Where the words sit" hint="Part of the concept: two presets on one picture still read as two ads." required><AppSelect :id="id" v-model="form.layout" :options="layoutOptions()" data-test="preset-layout" /></FormField>
        <div class="flex items-center justify-between gap-4"><p class="text-sm text-ink">Shows our equipment</p><BaseSwitch v-model="form.shows_equipment" label="Shows our equipment" /></div>
        <div class="flex items-center justify-between gap-4"><p class="text-sm text-ink">Shows people</p><BaseSwitch v-model="form.shows_people" label="Shows people" /></div>
      </fieldset>

      <fieldset class="space-y-2">
        <legend class="text-sm font-semibold text-ink">Formats</legend>
        <div v-for="f in AD_FORMATS" :key="f" class="flex items-center justify-between gap-4">
          <p class="text-sm text-ink">{{ f }}</p>
          <BaseSwitch :model-value="form.formats.includes(f)" :label="f" @update:model-value="(on: boolean) => setFormat(f, on)" />
        </div>
      </fieldset>
      <AppCallout v-if="refusal" tone="danger" data-test="preset-refusal">{{ refusal }}</AppCallout>
    </form>
    <template #footer>
      <div class="flex items-center justify-end gap-3">
        <BaseButton :disabled="save.isPending.value" @click="emit('close')">Cancel</BaseButton>
        <BaseButton variant="primary" type="submit" :form="FORM" :disabled="save.isPending.value" data-test="save-preset">
          {{ preset ? `Save as version ${nextVersion}` : "Save preset" }}
        </BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
