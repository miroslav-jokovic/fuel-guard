<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import type { HazmatLoadRow, HazmatRunRow } from "@fuelguard/shared";
import BaseCard from "@/components/ui/BaseCard.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import BaseCheckbox from "@/components/ui/BaseCheckbox.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import {
  ATTESTATION_TEXT,
  buildAttestation,
  canSubmitClear,
  clearGate,
  deriveReviewItems,
  OVERRIDE_MIN_REASON,
  spAttestationText,
  type ReviewTier,
} from "./reviewModel";
import { useClearLoad, useLoadDocumentsQuery, useRecordReview } from "./useHazmatReview";

/**
 * The review + attestation panel (plan H7). Shown on a load in `needs_review` to a review-role user. The
 * reviewer works the flags (violations first), sees the BOL evidence, and clears ONLY on the named
 * attestation — a violation demands a typed override reason, a special-permit load the SP attestation, and a
 * provisional dataset can't clear at all (D2/D8). Field-by-field correction + pixel-crop evidence arrive when
 * H6 persists per-field bboxes; this panel is the fail-closed clearing core.
 */
const props = defineProps<{ load: HazmatLoadRow; run: HazmatRunRow }>();

const items = computed(() => deriveReviewItems(props.run.flags));
const permits = computed(() => props.load.special_permit_numbers ?? []);
const gate = computed(() => clearGate(props.run.flags, false, permits.value));

const attempt = reactive({ attested: false, spAttested: false, overrideReason: "" });
const canSubmit = computed(() => canSubmitClear(gate.value, attempt));

const { data: documents } = useLoadDocumentsQuery(computed(() => props.load.id));
const bolImages = computed(() => (documents.value ?? []).filter((d) => (d.contentType ?? "").startsWith("image/") && d.url));

const recordReview = useRecordReview();
const clearLoad = useClearLoad();
const actionError = ref<string | null>(null);
const busy = computed(() => recordReview.isPending.value || clearLoad.isPending.value);

const TONE: Record<ReviewTier, string> = { violation: "danger", conditional: "warning", warning: "warning", info: "neutral" };

async function clear() {
  actionError.value = null;
  try {
    if (gate.value.requiresOverride) {
      await recordReview.mutateAsync({ loadId: props.load.id, body: { runId: props.run.id, action: "override", newValue: attempt.overrideReason.trim() } });
    }
    await clearLoad.mutateAsync({ loadId: props.load.id, body: { runId: props.run.id, attestation: buildAttestation(gate.value, attempt, permits.value) } });
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : "Could not clear the load.";
  }
}
async function reject() {
  actionError.value = null;
  try {
    await recordReview.mutateAsync({ loadId: props.load.id, body: { runId: props.run.id, action: "rejected" } });
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : "Could not reject the load.";
  }
}
</script>

<template>
  <BaseCard>
    <h3 class="text-sm font-semibold text-ink">Review &amp; attestation</h3>

    <!-- flags to work, violations first -->
    <ul class="mt-3 space-y-2">
      <li v-for="item in items" :key="item.code" class="flex items-start gap-2 text-sm">
        <span :class="[BADGE_BASE, toneClass(TONE[item.tier]), '!capitalize']">{{ item.tier }}</span>
        <span class="text-ink">{{ item.label }}</span>
      </li>
      <li v-if="items.length === 0" class="text-sm text-ink-muted">No blocking flags — attest to clear.</li>
    </ul>

    <!-- BOL evidence -->
    <div v-if="bolImages.length" class="mt-4">
      <p class="text-xs font-medium uppercase tracking-wide text-ink-subtle">Document evidence</p>
      <div class="mt-2 flex flex-wrap gap-2">
        <a v-for="d in bolImages" :key="d.id" :href="d.url!" target="_blank" rel="noopener noreferrer" class="block">
          <img :src="d.url!" :alt="`${d.kind} page ${d.page}`" class="h-32 w-auto rounded-md ring-1 ring-edge" />
        </a>
      </div>
    </div>

    <!-- hard block -->
    <p v-if="gate.hardBlockReason" class="mt-4 rounded-md bg-warning-50 px-3 py-2 text-sm text-warning-700 ring-1 ring-inset ring-warning-600/20">
      {{ gate.hardBlockReason }}
    </p>

    <!-- clearing controls -->
    <div v-else class="mt-4 space-y-3 border-t border-edge pt-4">
      <BaseCheckbox v-model="attempt.attested">{{ ATTESTATION_TEXT }}</BaseCheckbox>
      <BaseCheckbox v-if="gate.requiresSpAttestation" v-model="attempt.spAttested">{{ spAttestationText(permits) }}</BaseCheckbox>

      <div v-if="gate.requiresOverride">
        <label class="block text-sm font-medium text-ink-secondary">Override reason (a violation is being cleared — {{ OVERRIDE_MIN_REASON }}+ chars)</label>
        <textarea
          v-model="attempt.overrideReason"
          rows="2"
          class="mt-1 block w-full rounded-md border-0 bg-surface px-3 py-1.5 text-base text-ink ring-1 ring-inset ring-edge-strong placeholder:text-ink-subtle focus:ring-2 focus:ring-brand-600 sm:text-sm"
          placeholder="Why is this being cleared despite the violation?"
        />
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <BaseButton variant="primary" size="sm" :disabled="!canSubmit || busy" @click="clear">
          {{ gate.requiresOverride ? "Override & clear" : "Attest & clear" }}
        </BaseButton>
        <BaseButton variant="danger" size="sm" :disabled="busy" @click="reject">Reject (illegible / wrong document)</BaseButton>
      </div>
      <p v-if="actionError" class="text-sm text-danger-600">{{ actionError }}</p>
    </div>
  </BaseCard>
</template>
