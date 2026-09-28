<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { AppButton as BaseButton, AppFormField as FormField, AppInput as BaseInput } from "@silvicom/ui";
import FileDropzone from "@/components/ui/FileDropzone.vue";
import { useToastStore } from "@/stores/toast";
import { pngDataUrl, useAddRoadTestExaminer } from "@/features/recruitment/useRoadTest";
import { useAddRepresentative } from "@/features/recruitment/useHandbook";

/**
 * Adding somebody whose signature the carrier's paper prints: a Representative, who countersigns the
 * driver handbook (D-HB3), or a road-test examiner, who signs the §391.31 form and certificate (Q-RT2).
 *
 * ── ONE FORM, THREE PLACES (Q-AW42, APPLICATION-FLOW-V2-PLAN.md R1) ───────────────────────────
 * It was written twice, once inside each hiring step's panel, and the only way to add either person
 * was to open one driver's drawer at that step. Settings → Recruiting needed the same form a third
 * time. It is split out here rather than copied, so the two people keep ONE set of rules for what a
 * complete entry is — and the rule itself is the contract's (`roadTestExaminerCreateSchema`,
 * `carrierRepresentativeCreateSchema`, both 2–120 / 2–80 characters and a PNG), which the api
 * re-checks on the bytes.
 *
 * The two kinds differ only in their words and in the endpoint, so the kind picks both and nothing
 * else. The parent learns about the person added through `added` — the handbook panel selects them
 * to countersign, the road-test panel selects them to examine, the register only closes the form.
 */
type Kind = "representative" | "examiner";
/**
 * ⚠ `onAdded` is a PROP, not an emit, and a parent still writes `@added`. The form is usually shown
 * BECAUSE the list is empty, and the add's own success refetches the list — which can unmount the form
 * before `mutateAsync`'s continuation runs, and Vue drops an emit from an unmounted component. The
 * panel then never selected the person just added. Found by "puts the examiner just added in the
 * Examiner field" failing on the first run; a prop is a plain function and is called regardless.
 */
const props = withDefaults(
  defineProps<{ kind: Kind; cancellable?: boolean; onAdded?: (person: { id: string; full_name: string }) => void }>(),
  { cancellable: false, onAdded: undefined },
);
const emit = defineEmits<{ cancel: [] }>();

const COPY: Record<Kind, { heading: string; blurb: string; titlePlaceholder: string; titleHint: string; submit: string }> = {
  representative: {
    heading: "Add a representative",
    blurb:
      "Their signature prints where the carrier agrees. Upload a PNG of it — a scan or a photo of them signing on white paper.",
    titlePlaceholder: "Safety manager",
    titleHint: "Printed beside their signature.",
    submit: "Add representative",
  },
  examiner: {
    heading: "Add an examiner",
    blurb:
      "Their signature prints on every road test they give. Upload a PNG of it — a scan or a photo of them signing on white paper.",
    titlePlaceholder: "Maintenance manager",
    titleHint: "Printed on the certificate.",
    submit: "Add examiner",
  },
};
const copy = computed(() => COPY[props.kind]);

const toast = useToastStore();
// The kind is fixed for the life of a form, so one mutation is chosen once.
const add = props.kind === "representative" ? useAddRepresentative() : useAddRoadTestExaminer();

const form = reactive({ fullName: "", title: "" });
const signature = ref<File | null>(null);
const complete = computed(
  () => form.fullName.trim().length >= 2 && form.title.trim().length >= 2 && Boolean(signature.value),
);

async function save(): Promise<void> {
  if (!signature.value) return;
  try {
    const created = await add.mutateAsync({
      full_name: form.fullName.trim(),
      title: form.title.trim(),
      signature_png: await pngDataUrl(signature.value),
    });
    if (props.kind === "representative") {
      toast.success("Representative added", `${created.full_name} can now sign handbooks for the carrier.`);
    } else {
      toast.success("Examiner added", `${created.full_name}'s signature will print on the road tests they give.`);
    }
    Object.assign(form, { fullName: "", title: "" });
    signature.value = null;
    props.onAdded?.(created);
  } catch (e) {
    toast.error(
      props.kind === "representative" ? "Could not add the representative" : "Could not add the examiner",
      e instanceof Error ? e.message : undefined,
    );
  }
}
</script>

<template>
  <div class="space-y-4 rounded-surface border border-edge p-4">
    <p class="text-sm font-medium text-ink">{{ copy.heading }}</p>
    <p class="text-xs text-ink-secondary">{{ copy.blurb }}</p>
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <FormField v-slot="{ id }" label="Name">
        <BaseInput :id="id" v-model="form.fullName" />
      </FormField>
      <FormField v-slot="{ id }" label="Title" :hint="copy.titleHint">
        <BaseInput :id="id" v-model="form.title" :placeholder="copy.titlePlaceholder" />
      </FormField>
    </div>
    <FileDropzone
      accept=".png"
      :busy="add.isPending.value"
      busy-label="Saving…"
      :label="signature ? signature.name : 'Drag & drop the signature (PNG)'"
      hint="PNG only. Stored privately with the carrier's files."
      @files="signature = $event[0] ?? null"
    />
    <div class="flex gap-3">
      <BaseButton variant="primary" size="sm" :disabled="!complete || add.isPending.value" @click="save">
        {{ copy.submit }}
      </BaseButton>
      <BaseButton v-if="cancellable" variant="ghost" size="sm" @click="emit('cancel')">Cancel</BaseButton>
    </div>
  </div>
</template>
