<script setup lang="ts">
import { computed } from "vue";
import type { AssetCreateInput, AssetDto, AssetInput } from "@silvicom/shared";
import { AppButton as BaseButton } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import AssetForm, { ASSET_FORM_ID } from "./AssetForm.vue";
import { useCreateAsset, useUpdateAsset, useAssetTypesQuery } from "./useAssets";
import { useLocationsQuery } from "./useInventory";
import { useToastStore } from "@/stores/toast";

/**
 * Add or edit an asset. One drawer for both, because it is one form and one set of rules — a second
 * component for editing is how the two acquire different amounts of honesty about the same fields
 * (`PartDrawer.vue` makes the same call).
 *
 * The API's message is what the toast shows on failure. Inventory's refusals are specific by design
 * — `IV012` names a bay that is not ours or is closed, `IV022` a tag already on something else — and
 * replacing them with "Could not save" would throw away the half that says what to do.
 *
 * The actions live in the drawer's pinned `#footer` and submit the form by id — `PartForm.vue`
 * records why the row left the body.
 */
const props = defineProps<{ open: boolean; asset?: AssetDto | null }>();
const emit = defineEmits<{ close: []; saved: [asset: AssetDto] }>();

const toast = useToastStore();
const create = useCreateAsset();
const update = useUpdateAsset();
const { data: types } = useAssetTypesQuery();
/** Active only: 0333 refuses a placement into a closed bay, so offering one is an error the form can prevent. */
const { data: locations } = useLocationsQuery();
const submitting = computed(() => create.isPending.value || update.isPending.value);

async function onSubmit(input: AssetCreateInput) {
  try {
    // The holder is stripped on the edit path rather than merely hidden: `useUpdateAsset` takes a
    // `Partial<AssetInput>`, which has no holder fields at all, so the PATCH cannot carry one even
    // if a future field bound it by accident.
    const { locationId: _l, vehicleId: _v, trailerId: _t, ...describe } = input;
    const asset = props.asset
      ? await update.mutateAsync({ id: props.asset.id, patch: describe as Partial<AssetInput> })
      : await create.mutateAsync(input);
    toast.success(props.asset ? "Asset saved" : "Asset added");
    emit("saved", asset);
    emit("close");
  } catch (e) {
    toast.error(
      props.asset ? "Could not save the asset" : "Could not add the asset",
      e instanceof Error ? e.message : undefined,
    );
  }
}
</script>

<template>
  <SlideOver :open="open" :title="asset ? 'Edit asset' : 'New asset'" size="lg" @close="emit('close')">
    <AssetForm :asset="asset" :types="types ?? []" :locations="locations ?? []" @submit="onSubmit" />
    <template #footer>
      <div class="flex items-center justify-end gap-3">
        <BaseButton variant="ghost" :disabled="submitting" @click="emit('close')">Cancel</BaseButton>
        <BaseButton :form="ASSET_FORM_ID" type="submit" variant="primary" :disabled="submitting">
          {{ submitting ? (asset ? "Saving…" : "Adding…") : asset ? "Save asset" : "Add asset" }}
        </BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
