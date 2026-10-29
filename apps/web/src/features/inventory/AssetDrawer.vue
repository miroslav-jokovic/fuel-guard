<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { AssetCreateInput, AssetDto, AssetInput } from "@silvicom/shared";
import { AppButton as BaseButton } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import AssetForm, { ASSET_FORM_ID, type AssetFormSeed } from "./AssetForm.vue";
import AssetTypesDrawer from "./AssetTypesDrawer.vue";
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
 *
 * ── "SAVE AND ADD ANOTHER" (M9b) ──────────────────────────────────────────────────────────────
 * Tablets arrive ten to a box (§7a.4). After a save the drawer stays open on a fresh form that keeps
 * what the box has in common — type, model, maker, where they start, when and for how much they were
 * bought — and clears what each tablet has of its own: IMEI, serial, name, notes. The next sticker
 * is one trigger pull away. The form is remounted (`formKey`), so nothing of the last one lingers.
 */
const props = defineProps<{
  open: boolean;
  asset?: AssetDto | null;
  /** A new item's starting values — the Scan page passes the code it read ("Add this tablet"). */
  initial?: AssetFormSeed;
}>();
const emit = defineEmits<{ close: []; saved: [asset: AssetDto] }>();

const toast = useToastStore();
const create = useCreateAsset();
const update = useUpdateAsset();
const { data: types } = useAssetTypesQuery();
/** Active only: 0333 refuses a placement into a closed bay, so offering one is an error the form can prevent. */
const { data: locations } = useLocationsQuery();
const submitting = computed(() => create.isPending.value || update.isPending.value);

/**
 * Types of equipment, opened from the Type field. Inside this drawer's body, not beside it: a sibling
 * dialog and this one would both answer Escape (memory `sibling-dialogs-both-own-escape`), and nested
 * HeadlessUI dialogs close innermost first. A type added there arrives in the Type list by the
 * `["inventory"]` invalidation the create hook already does.
 */
const typesOpen = ref(false);

const another = ref(false);
const carry = ref<AssetFormSeed | undefined>(props.initial);
const formKey = ref(0);
watch(
  () => props.open,
  (open) => {
    if (open) {
      carry.value = props.initial;
      formKey.value += 1;
    }
  },
);

async function onSubmit(input: AssetCreateInput) {
  const again = another.value;
  another.value = false;
  try {
    // The holder is stripped on the edit path rather than merely hidden: `useUpdateAsset` takes a
    // `Partial<AssetInput>`, which has no holder fields at all, so the PATCH cannot carry one even
    // if a future field bound it by accident.
    const { locationId: _l, vehicleId: _v, trailerId: _t, ...describe } = input;
    const asset = props.asset
      ? await update.mutateAsync({ id: props.asset.id, patch: describe as Partial<AssetInput> })
      : await create.mutateAsync(input);
    toast.success(props.asset ? `${asset.displayNo} saved` : `${asset.displayNo} added`);
    emit("saved", asset);
    if (again && !props.asset) {
      carry.value = {
        assetTypeId: input.assetTypeId,
        model: input.model ?? "",
        manufacturer: input.manufacturer ?? "",
        locationId: input.locationId ?? "",
        purchasedAt: input.purchasedAt ?? "",
        purchaseCost: input.purchaseCost == null ? "" : String(input.purchaseCost),
        warrantyExpiresAt: input.warrantyExpiresAt ?? "",
      };
      formKey.value += 1;
      return;
    }
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
  <SlideOver :open="open" :title="asset ? 'Edit equipment' : 'Add equipment'" size="lg" @close="emit('close')">
    <AssetForm
      :key="formKey"
      :asset="asset"
      :types="types ?? []"
      :locations="locations ?? []"
      :initial="carry"
      :active="open && !typesOpen"
      @submit="onSubmit"
      @manage-types="typesOpen = true"
    />
    <AssetTypesDrawer v-if="typesOpen" :open="true" @close="typesOpen = false" />
    <template #footer>
      <div class="flex flex-wrap items-center justify-end gap-3">
        <BaseButton variant="ghost" :disabled="submitting" @click="emit('close')">Cancel</BaseButton>
        <BaseButton v-if="!asset" :form="ASSET_FORM_ID" type="submit" :disabled="submitting" data-test="save-another" @click="another = true">
          Save and add another
        </BaseButton>
        <BaseButton :form="ASSET_FORM_ID" type="submit" variant="primary" :disabled="submitting" @click="another = false">
          {{ submitting ? (asset ? "Saving…" : "Adding…") : asset ? "Save asset" : "Add asset" }}
        </BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
