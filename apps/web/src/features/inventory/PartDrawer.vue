<script setup lang="ts">
import { computed } from "vue";
import type { PartDto, PartInput } from "@silvicom/shared";
import { AppButton as BaseButton } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import PartForm, { PART_FORM_ID } from "./PartForm.vue";
import { useCreatePart, useUpdatePart } from "./useInventory";
import { useToastStore } from "@/stores/toast";

/**
 * Add or edit a part. One drawer for both, because it is one form and one set of rules — a second
 * component for editing is how the two acquire different amounts of honesty about the same fields.
 *
 * The API's message is what the toast shows on failure. Inventory's refusals are specific by
 * design (`IV0xx` map to 409 and 422 with a sentence a technician can act on), and replacing them
 * with "Could not save" here would throw away the half of the answer that says what to do.
 *
 * The actions live in the drawer's pinned `#footer` and submit the form by id — `PartForm.vue`
 * records why the row left the body.
 */
const props = defineProps<{
  open: boolean;
  part?: PartDto | null;
  /** A scanned barcode to start a new part from — see `PartForm`'s own prop for the argument. */
  initialUpc?: string;
}>();
const emit = defineEmits<{ close: []; saved: [part: PartDto] }>();

const toast = useToastStore();
const create = useCreatePart();
const update = useUpdatePart();
const submitting = computed(() => create.isPending.value || update.isPending.value);

async function onSubmit(input: PartInput) {
  try {
    const part = props.part
      ? await update.mutateAsync({ id: props.part.id, patch: input })
      : await create.mutateAsync(input);
    toast.success(props.part ? "Part saved" : "Part added");
    emit("saved", part);
    emit("close");
  } catch (e) {
    toast.error(
      props.part ? "Could not save the part" : "Could not add the part",
      e instanceof Error ? e.message : undefined,
    );
  }
}
</script>

<template>
  <SlideOver :open="open" :title="part ? 'Edit part' : 'New part'" @close="emit('close')">
    <PartForm :part="part" :initial-upc="initialUpc" @submit="onSubmit" />
    <template #footer>
      <div class="flex items-center justify-end gap-3">
        <BaseButton variant="ghost" :disabled="submitting" @click="emit('close')">Cancel</BaseButton>
        <BaseButton :form="PART_FORM_ID" type="submit" variant="primary" :disabled="submitting">
          {{ submitting ? (part ? "Saving…" : "Adding…") : part ? "Save part" : "Add part" }}
        </BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
