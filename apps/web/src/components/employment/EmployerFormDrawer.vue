<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { AppButton as BaseButton, useConfirm } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import EmployerForm from "./EmployerForm.vue";
import { blankEmployer, type EmployerFields } from "./employerRow";
import type { EmploymentFormCopy } from "./employmentCopy";

/**
 * One job in a panel — the one employer form, its Save, its Cancel and its Remove — for all three
 * surfaces (HW5b, HIRING-WORKFLOW-AUDIT §4.5).
 *
 * ── WHY IT EDITS A COPY ───────────────────────────────────────────────────────────────────────
 * The panel commits on Save and discards on Cancel, so somebody who opens the wrong job and backs out
 * has changed nothing. Binding straight to the row would write every keystroke of an edit they
 * abandoned, and "Cancel" would be a button that does nothing. `close` hands the copy back anyway —
 * the applicant's list keeps a half-typed new job as "Unfinished" rather than losing it (§9 P8, AF-4).
 *
 * ── WHY REMOVE ASKS FIRST, HERE, FOR EVERYONE (EM-5) ─────────────────────────────────────────
 * The office's record screen removed a job from a kebab with no question at all, and the two are not
 * equally undoable — a job carries fifteen answers and there is no undo. The confirm lives in the one
 * panel, so no surface can mount the form without it. It sits in the panel, not on the list row, where
 * it was a thumb's width from "Change" at 390 px.
 *
 * The surface judges the job (`errors`) and owns the write; this focuses the first refusal.
 */
const props = withDefaults(
  defineProps<{
    open: boolean;
    /** The job to edit, or null for a new one (`prefill` seeds its dates — a gap's "Add a job here"). */
    employer: EmployerFields | null;
    prefill?: Partial<EmployerFields> | null;
    copy: EmploymentFormCopy;
    idPrefix: string;
    asOf: string;
    errors?: Partial<Record<string, string>>;
    /** May this job be removed? A job on the list may; a new one is simply cancelled. */
    removable?: boolean;
    pending?: boolean;
    touch?: boolean;
    /** The panel's sentence under the title; the surface's own (who sees the change, and when). */
    description?: string;
  }>(),
  { prefill: null, errors: () => ({}), removable: false, pending: false, touch: false, description: undefined },
);
const emit = defineEmits<{ save: [EmployerFields]; remove: []; close: [EmployerFields] }>();
const ask = useConfirm();

const local = ref<EmployerFields>(blankEmployer());
watch(
  () => [props.open, props.employer?.key] as const,
  ([open]) => {
    if (!open) return;
    local.value = { ...(props.employer ?? { ...blankEmployer(), ...(props.prefill ?? {}) }) };
  },
  { immediate: true },
);

const name = computed(() => props.employer?.employer_name.trim() || "");
const title = computed(() => (props.employer ? name.value || props.copy.noName : props.copy.drawerNew));

/** The first refused box takes the focus, so the person is looking at what to fix. */
watch(
  // By identity: each Save hands a new object, so a second refusal of the same box focuses it again.
  () => props.errors,
  async (errors) => {
    if (Object.keys(errors).length === 0 || !props.open) return;
    await nextTick();
    const first = Object.keys(props.errors)
      .map((f) => globalThis.document?.getElementById(`${props.idPrefix}-${f}`))
      .find(Boolean);
    first?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    first?.focus?.();
  },
);

async function remove(): Promise<void> {
  const ok = await ask({
    title: props.copy.removeTitle(name.value || props.copy.noName),
    message: props.copy.removeMessage,
    confirmLabel: props.copy.removeConfirm,
    cancelLabel: props.copy.drawerCancel,
    tone: "danger",
  });
  if (ok) emit("remove");
}
</script>

<template>
  <SlideOver
    :open="open"
    :title="title"
    :description="description ?? copy.drawerIntro"
    size="lg"
    @close="emit('close', { ...local })"
  >
    <div v-if="open" class="space-y-4">
      <EmployerForm
        :key="local.key"
        v-model="local"
        :copy="copy"
        :id-prefix="idPrefix"
        :as-of="asOf"
        :errors="errors"
        :touch="touch"
      />
      <!-- The surface's own extras below the shared questions — the office record's working notes. -->
      <slot />
    </div>

    <template #footer>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <BaseButton v-if="removable" variant="ghost" :size="touch ? 'touch' : 'md'" :disabled="pending" @click="remove">
          {{ copy.removeJob }}
        </BaseButton>
        <span v-else />
        <div class="flex items-center gap-3">
          <BaseButton variant="secondary" :size="touch ? 'touch' : 'md'" @click="emit('close', { ...local })">
            {{ copy.drawerCancel }}
          </BaseButton>
          <BaseButton variant="primary" :size="touch ? 'touch' : 'md'" :disabled="pending" @click="emit('save', { ...local })">
            {{ copy.drawerSave }}
          </BaseButton>
        </div>
      </div>
    </template>
  </SlideOver>
</template>
