<script setup lang="ts">
import { computed, nextTick, ref, toRef } from "vue";
import type { CampaignPlan, CampaignState } from "@silvicom/shared";
import { AppButton as BaseButton, AppCallout, AppFormField as FormField, AppSelect, AppTextarea, QueryState } from "@silvicom/ui";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useToastStore } from "@/stores/toast";
import {
  EVIDENCE_KIND_LABEL, authorLine, canRemoveAngle, conceptKey, conceptOptions, draftErrors, editFrom, editablePlan, factsFor, formatLabel, formatOptions,
  hookLabel, mayHavePlan, planIsOpen, planRefusalLines, sceneLabel, setConcept, setFormat, showsFormat,
} from "./adsPlan";
import { useCampaignPlan, useSavePlanEdit } from "./useAdsCampaigns";

/**
 * A campaign's plan (ADS-PLATFORM-V2-PLAN V2c; owner 2026-11-14: decisions "based on real research and analysis
 * and not on some assumptions"): who the ads speak to, each idea, and under each the facts it rests on — so a
 * person approves a plan they can check, not a plan they have to trust.
 *
 * While the plan waits for review, whoever manages recruiting may edit it here or approve it from the drawer's
 * footer, where a drawer's actions live. An edit is saved as a new version and the door decides whether it is
 * allowed; its refusal is listed in sentences beside the Save button, where the person is when it arrives. A person edits
 * the words and the kind of each idea — one of the kinds the carrier's enabled presets can make — and, on a campaign that can be made
 * in more than one format, whether an idea is a still image or a short video; the facts an idea cites stay as they are, because the facts are gathered
 * by the system and not typed by hand. After approval the plan stays on the campaign, read-only: it is why the
 * ads say what they say.
 */
const props = defineProps<{ campaignId: string; state: CampaignState; canManage: boolean }>();
/** An edit is open: the drawer holds Approve back, so an unsaved edit is never approved around. */
const emit = defineEmits<{ editing: [open: boolean] }>();

const toast = useToastStore();
const read = useCampaignPlan(toRef(props, "campaignId"), computed(() => mayHavePlan(props.state)));
const save = useSavePlanEdit();

const view = computed(() => read.data.value?.plan ?? null);
/** The kinds of ad the carrier can make today (the read's own answer; the door holds an edit to the same list). */
const concepts = computed(() => read.data.value?.concepts ?? []);
/** The formats this campaign can be made in (the same read): a video is offered only where the campaign can make one. */
const formats = computed(() => read.data.value?.formats ?? []);
const open = computed(() => props.canManage && planIsOpen(props.state));
const busy = computed(() => save.isPending.value);

const draft = ref<CampaignPlan | null>(null);
const refusal = ref<string[]>([]);
/** The refusal list, brought into view when it arrives: the editor is long and the list grows the page under the fold. */
const refusalBox = ref<HTMLElement | null>(null);
const errors = computed(() => (draft.value ? draftErrors(draft.value) : {}));
const sendable = computed(() => (draft.value && view.value ? editFrom(draft.value, view.value.version) : null));

function startEdit(): void {
  if (!view.value) return;
  draft.value = editablePlan(view.value.plan);
  refusal.value = [];
  emit("editing", true);
}
function stopEdit(): void {
  draft.value = null;
  refusal.value = [];
  emit("editing", false);
}
function removeAngle(i: number): void {
  if (draft.value && canRemoveAngle(draft.value)) draft.value.angles.splice(i, 1);
}
async function saveEdit(): Promise<void> {
  if (!sendable.value) return;
  try {
    await save.mutateAsync({ id: props.campaignId, edit: sendable.value });
    stopEdit();
    toast.success("Plan saved as a new version");
  } catch (e) {
    const r = e as { code?: string; detail?: unknown; message?: string };
    refusal.value = r.code === "plan_refused" ? planRefusalLines(r.detail) : [];
    toast.error("The plan was not saved", r.message);
    await nextTick();
    refusalBox.value?.scrollIntoView?.({ block: "center" });
  }
}
</script>

<template>
  <section v-if="mayHavePlan(state)" class="space-y-3" data-test="campaign-plan">
    <QueryState :loading="read.isLoading.value" :error="read.error.value" error-text="Could not load the plan." :retrying="read.isFetching.value" @retry="read.refetch()">
      <template v-if="view">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 class="text-sm font-semibold text-ink">The plan</h3>
            <p class="text-xs text-ink-muted" data-test="plan-author">{{ authorLine(view) }}</p>
          </div>
          <BaseButton v-if="open && !draft" :disabled="busy" data-test="plan-edit" @click="startEdit">Edit the plan</BaseButton>
        </div>

        <!-- reading -->
        <template v-if="!draft">
          <div class="space-y-1">
            <h4 class="text-sm font-semibold text-ink">Who the ads speak to</h4>
            <p class="text-sm text-ink" data-test="plan-audience">{{ view.plan.audience }}</p>
            <details class="text-sm" data-test="plan-audience-facts">
              <summary class="cursor-pointer text-ink-muted">The facts behind this ({{ factsFor(view, view.plan.audience_evidence).length }})</summary>
              <ul class="mt-1 space-y-1">
                <li v-for="f in factsFor(view, view.plan.audience_evidence)" :key="f.id" class="text-ink-muted"><span class="text-ink">{{ EVIDENCE_KIND_LABEL[f.kind] }}: </span>{{ f.text }}</li>
              </ul>
            </details>
          </div>
          <article v-for="(a, i) in view.plan.angles" :key="i" class="space-y-2 rounded-detail p-3 ring-1 ring-edge" data-test="plan-angle">
            <div class="flex flex-wrap items-center gap-2">
              <h4 class="text-sm font-semibold text-ink">Idea {{ i + 1 }}</h4>
              <span :class="[BADGE_BASE, toneClass('info')]" data-test="plan-hook">Leads with: {{ hookLabel(a) }}</span>
              <span :class="[BADGE_BASE, toneClass('neutral')]" data-test="plan-scene">Picture: {{ sceneLabel(a) }}</span>
              <span v-if="showsFormat(formats, a)" :class="[BADGE_BASE, toneClass('neutral')]" data-test="plan-format">Made as: {{ formatLabel(a.format) }}</span>
            </div>
            <p class="text-sm text-ink">{{ a.idea }}</p>
            <p class="text-sm text-ink"><span class="text-ink-muted">What makes it true: </span>{{ a.proof }}</p>
            <p class="text-sm text-ink"><span class="text-ink-muted">Why this idea: </span>{{ a.why }}</p>
            <details class="text-sm" data-test="plan-angle-facts">
              <summary class="cursor-pointer text-ink-muted">The facts behind this ({{ factsFor(view, a.evidence).length }})</summary>
              <ul class="mt-1 space-y-1">
                <li v-for="f in factsFor(view, a.evidence)" :key="f.id" class="text-ink-muted"><span class="text-ink">{{ EVIDENCE_KIND_LABEL[f.kind] }}: </span>{{ f.text }}</li>
              </ul>
            </details>
          </article>
        </template>

        <!-- editing -->
        <section v-else class="space-y-3 rounded-detail bg-surface-muted p-3" aria-label="Edit the plan" data-test="plan-editor">
          <p class="text-sm text-ink">Change the words or the kind of any idea. Your version is saved beside the one before it, and the ads are made from the version that is approved.</p>
          <FormField v-slot="{ id }" label="Who the ads speak to" :error="errors.audience" required>
            <AppTextarea :id="id" v-model="draft.audience" :rows="3" :invalid="Boolean(errors.audience)" data-test="plan-edit-audience" />
          </FormField>
          <fieldset v-for="(a, i) in draft.angles" :key="i" class="space-y-2 rounded-detail bg-surface p-3 ring-1 ring-edge" :data-test="`plan-edit-angle-${i}`">
            <legend class="px-1 text-sm font-semibold text-ink">Idea {{ i + 1 }}</legend>
            <FormField v-slot="{ id }" label="The kind of ad: what it leads with, and its picture" required>
              <AppSelect :id="id" :model-value="conceptKey(a)" :options="conceptOptions(concepts, a)" :data-test="`plan-edit-concept-${i}`" @update:model-value="(k) => setConcept(a, String(k ?? ''))" />
            </FormField>
            <FormField v-if="showsFormat(formats, a)" v-slot="{ id }" label="Made as" required>
              <AppSelect :id="id" :model-value="a.format" :options="formatOptions(formats, a.format)" :data-test="`plan-edit-format-${i}`" @update:model-value="(k) => setFormat(a, String(k ?? ''))" />
            </FormField>
            <FormField v-slot="{ id }" label="The idea, in one sentence" :error="errors[`angles.${i}.idea`]" required>
              <AppTextarea :id="id" v-model="a.idea" :rows="2" :invalid="Boolean(errors[`angles.${i}.idea`])" :data-test="`plan-edit-idea-${i}`" />
            </FormField>
            <FormField v-slot="{ id }" label="What makes it true" :error="errors[`angles.${i}.proof`]" required>
              <AppTextarea :id="id" v-model="a.proof" :rows="2" :invalid="Boolean(errors[`angles.${i}.proof`])" :data-test="`plan-edit-proof-${i}`" />
            </FormField>
            <FormField v-slot="{ id }" label="Why this idea" :error="errors[`angles.${i}.why`]" required>
              <AppTextarea :id="id" v-model="a.why" :rows="2" :invalid="Boolean(errors[`angles.${i}.why`])" :data-test="`plan-edit-why-${i}`" />
            </FormField>
            <div v-if="canRemoveAngle(draft)" class="flex justify-end">
              <BaseButton :disabled="busy" :data-test="`plan-edit-remove-${i}`" @click="removeAngle(i)">Remove this idea</BaseButton>
            </div>
          </fieldset>
          <div v-if="refusal.length" ref="refusalBox">
            <AppCallout tone="danger" data-test="plan-refusal">
              <p>This plan cannot be saved yet:</p>
              <ul class="list-disc pl-5"><li v-for="(line, n) in refusal" :key="n">{{ line }}</li></ul>
            </AppCallout>
          </div>
          <div class="flex justify-end gap-2">
            <BaseButton :disabled="busy" data-test="plan-edit-cancel" @click="stopEdit">Cancel</BaseButton>
            <BaseButton variant="primary" :disabled="busy || !sendable" data-test="plan-edit-save" @click="saveEdit">Save as a new version</BaseButton>
          </div>
        </section>
      </template>
    </QueryState>
  </section>
</template>
