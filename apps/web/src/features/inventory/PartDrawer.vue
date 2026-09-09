<script setup lang="ts">
import { computed } from "vue";
import type { PartDto, PartInput } from "@silvicom/shared";
import SlideOver from "@/components/SlideOver.vue";
import PartForm from "./PartForm.vue";
import { useCreatePart, useUpdatePart } from "./useInventory";
import { useToastStore } from "@/stores/toast";

/**
 * Add or edit a part. One drawer for both, because it is one form and one set of rules — a second
 * component for editing is how the two acquire different amounts of honesty about the same fields.
 *
 * The API's message is what the toast shows on failure. Inventory's refusals are specific by
 * design (`IV0xx` map to 409 and 422 with a sentence a technician can act on), and replacing them
 * with "Could not save" here would throw away the half of the answer that says what to do.
 */
const props = defineProps<{ open: boolean; part?: PartDto | null }>();
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
    <PartForm :part="part" :submitting="submitting" @submit="onSubmit" @cancel="emit('close')" />
  </SlideOver>
</template>
