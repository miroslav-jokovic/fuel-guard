<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AD_FORMATS, AD_PEOPLE_POLICIES, type AdBrandKitView } from "@silvicom/shared";
import { AppButton as BaseButton, AppCallout, AppFormField as FormField, AppInput as BaseInput, AppSelect, AppTextarea } from "@silvicom/ui";
import FileDropzone from "@/components/ui/FileDropzone.vue";
import SlideOver from "@/components/SlideOver.vue";
import { useToastStore } from "@/stores/toast";
import { blankKitForm, kitFormFrom, kitSaveFrom, type BrandKitForm } from "./adsBrandKitForm";
import { uploadKitAsset, useSaveBrandKit } from "./useAdsBrandKits";

/**
 * Make a brand kit, or the next version of one (E2; plan D-AD10). A saved version is never changed: saving adds
 * a version, and a creative keeps the version it was made with, which is why the button says what it does.
 */
const props = defineProps<{ open: boolean; kit: AdBrandKitView | null }>();
const emit = defineEmits<{ close: [] }>();

const FORM = "ads-brand-kit-form";
const IMAGES = "image/png,image/jpeg,image/webp";
const PEOPLE_LABEL = { none: "No people in generated images", varied: "People may appear, varied across a set" } as const;
const people = AD_PEOPLE_POLICIES.map((p) => ({ value: p, label: PEOPLE_LABEL[p] }));

const toast = useToastStore();
const save = useSaveBrandKit();
const form = ref<BrandKitForm>(blankKitForm());
const refusal = ref<string | null>(null);
const uploading = ref(false);
const nextVersion = computed(() => (props.kit?.current?.version ?? 0) + 1);

watch(() => props.open, (open) => {
  if (!open) return;
  refusal.value = null;
  form.value = props.kit?.current ? kitFormFrom(props.kit.name, props.kit.current.body) : blankKitForm();
}, { immediate: true });

async function upload(files: File[], then: (asset: Awaited<ReturnType<typeof uploadKitAsset>>, file: File) => void): Promise<void> {
  uploading.value = true;
  try {
    for (const file of files) then(await uploadKitAsset(file), file);
  } catch (e) {
    toast.error("Could not add the image", e instanceof Error ? e.message : undefined);
  } finally {
    uploading.value = false;
  }
}

async function submit(): Promise<void> {
  const ask = kitSaveFrom(form.value, props.kit?.id ?? null);
  if (!ask.ok) {
    refusal.value = ask.message;
    return;
  }
  refusal.value = null;
  try {
    await save.mutateAsync(ask.save);
    toast.success(props.kit ? `Saved as version ${nextVersion.value}` : "Brand kit saved");
    emit("close");
  } catch (e) {
    toast.error("Could not save the brand kit", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <SlideOver :open="open" :title="kit ? `Edit ${kit.name}` : 'New brand kit'" description="Ads made earlier keep the version they were made with." size="lg" @close="emit('close')">
    <form :id="FORM" class="space-y-6" novalidate data-test="kit-form" @submit.prevent="submit">
      <FormField v-if="!kit" v-slot="{ id }" label="Kit name" required>
        <BaseInput :id="id" v-model="form.name" data-test="kit-name" />
      </FormField>
      <FormField v-slot="{ id }" label="Company name" hint="Exactly as it should read in an ad." required>
        <BaseInput :id="id" v-model="form.company_name" data-test="company-name" />
      </FormField>
      <FormField v-slot="{ id }" label="Phone" hint="As printed. Leave empty to show no phone on the ad.">
        <BaseInput :id="id" v-model="form.phone" autocomplete="off" />
      </FormField>

      <fieldset class="space-y-2">
        <legend class="text-sm font-semibold text-ink">Colours</legend>
        <p class="text-sm text-ink-muted">Each hex value is six digits after a #. Name one colour primary and one accent: an ad uses the accent for its button and the pay figure, and the primary for its footer.</p>
        <div v-for="(c, i) in form.colors" :key="i" class="flex items-end gap-2">
          <FormField v-slot="{ id }" label="Name" class="flex-1"><BaseInput :id="id" v-model="c.name" :data-test="`color-name-${i}`" /></FormField>
          <FormField v-slot="{ id }" label="Hex" class="flex-1"><BaseInput :id="id" v-model="c.hex" :data-test="`color-hex-${i}`" /></FormField>
          <BaseButton :disabled="form.colors.length === 1" @click="form.colors.splice(i, 1)">Remove</BaseButton>
        </div>
        <BaseButton @click="form.colors.push({ name: '', hex: '' })">Add a colour</BaseButton>
      </fieldset>

      <fieldset class="space-y-2">
        <legend class="text-sm font-semibold text-ink">Logo</legend>
        <p v-if="form.logo" class="text-sm text-ink-muted" data-test="logo-set">
          Logo added, {{ form.logo.width }} × {{ form.logo.height }}.
          <BaseButton @click="form.logo = null">Remove</BaseButton>
        </p>
        <FileDropzone v-else :accept="`${IMAGES},image/svg+xml`" :busy="uploading" busy-label="Uploading…" label="Drop the logo here" hint="PNG, JPEG, WebP or SVG. Without one, ads carry no logo." @files="(f) => upload(f, (asset) => (form.logo = asset))" />
      </fieldset>

      <fieldset class="space-y-2">
        <legend class="text-sm font-semibold text-ink">Photos of our equipment</legend>
        <p class="text-sm text-ink-muted">Real photos. A scene that shows equipment starts from one of these.</p>
        <div v-for="(p, i) in form.equipment_photos" :key="p.asset.sha256" class="flex items-end gap-2">
          <FormField v-slot="{ id }" label="What it shows" class="flex-1"><BaseInput :id="id" v-model="p.label" :data-test="`photo-label-${i}`" /></FormField>
          <BaseButton @click="form.equipment_photos.splice(i, 1)">Remove</BaseButton>
        </div>
        <FileDropzone :accept="IMAGES" multiple :busy="uploading" busy-label="Uploading…" label="Drop photos here" @files="(f) => upload(f, (asset) => form.equipment_photos.push({ label: '', asset }))" />
      </fieldset>

      <fieldset class="space-y-2">
        <legend class="text-sm font-semibold text-ink">Text on the ad</legend>
        <p class="text-sm text-ink-muted">The picture is darkened toward the ground colour under the words, as much as each picture needs. Leave it empty to put the text straight on the image.</p>
        <div v-for="f in AD_FORMATS" :key="f" class="grid grid-cols-3 items-end gap-2">
          <p class="pb-2 text-sm text-ink">{{ f }}</p>
          <FormField v-slot="{ id }" label="Text colour"><BaseInput :id="id" v-model="form.overlays[f].text_color" /></FormField>
          <FormField v-slot="{ id }" label="Ground colour"><BaseInput :id="id" v-model="form.overlays[f].plate_color" /></FormField>
        </div>
      </fieldset>

      <FormField v-slot="{ id }" label="People in generated images" required>
        <AppSelect :id="id" v-model="form.people_policy" :options="people" />
      </FormField>
      <FormField v-slot="{ id }" label="Names and marks that must not appear" hint="Other companies' names, one per line. The visual check looks for them.">
        <AppTextarea :id="id" v-model="form.forbidden_marks" rows="3" />
      </FormField>
      <AppCallout v-if="refusal" tone="danger" data-test="kit-refusal">{{ refusal }}</AppCallout>
    </form>
    <template #footer>
      <div class="flex items-center justify-end gap-3">
        <BaseButton :disabled="save.isPending.value" @click="emit('close')">Cancel</BaseButton>
        <BaseButton variant="primary" type="submit" :form="FORM" :disabled="save.isPending.value || uploading" data-test="save-kit">
          {{ kit ? `Save as version ${nextVersion}` : "Save brand kit" }}
        </BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
