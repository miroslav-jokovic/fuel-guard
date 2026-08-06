<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import type { HazmatLoadRow, HazmatRunRow } from "@fuelguard/shared";
import BaseCard from "@/components/ui/BaseCard.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import BaseCheckbox from "@/components/ui/BaseCheckbox.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import {
  ATTESTATION_TEXT,
  buildHazmatAttestation,
  checkHazmatClear,
  deriveReviewItems,
  OVERRIDE_MIN_REASON,
  spAttestationText,
  type ReviewTier,
} from "./reviewModel";
import { useClearLoad, useLoadDocumentsQuery, useRecordReview } from "./useHazmatReview";

/**
 * The review + attestation panel (plan H7). Shown on a load in `needs_review` to a review-role user. The
 * reviewer works the flags (violations first), sees the BOL evidence, and clears ONLY on the named
 * attestation. The clearing rules are enforced SERVER-SIDE (shared checkHazmatClear in clearLoad); this
 * panel mirrors them so a disabled button is explained. Field-by-field correction + pixel-crop evidence
 * arrive when H6 persists per-field bboxes.
 */
const props = defineProps<{ load: HazmatLoadRow; run: HazmatRunRow }>();

const items = computed(() => deriveReviewItems(props.run.flags));
const advisories = computed(() => props.run.advisories ?? []);
const extraction = computed(() => props.run.extraction ?? null);
const ADVISORY_TONE: Record<string, string> = { violation: "danger", conditional: "warning", warning: "warning", info: "neutral" };
const advisoryTone = (tier: string): string => ADVISORY_TONE[tier] ?? "neutral";
const prettyJson = (v: unknown): string => { try { return JSON.stringify(v, null, 2); } catch { return String(v); } };
const permits = computed(() => props.load.special_permit_numbers ?? []);

const attempt = reactive({ attested: false, spAttested: false, overrideReason: "" });
// The SAME gate the server enforces (datasetProvisional is detected from the run's flags; the API re-checks live).
const gate = computed(() =>
  checkHazmatClear({ flags: props.run.flags, datasetProvisional: false, specialPermits: permits.value, overrideReason: attempt.overrideReason, spAcknowledged: attempt.spAttested }),
);
const hardBlock = computed(() =>
  gate.value.code === "provisional_dataset" || gate.value.code === "document_unusable" ? gate.value.message ?? "This load cannot be cleared." : null,
);
const attestedGate = computed(() => attempt.attested && gate.value.ok);

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
    await clearLoad.mutateAsync({
      loadId: props.load.id,
      body: {
        runId: props.run.id,
        attestation: buildHazmatAttestation(gate.value, permits.value, attempt.overrideReason),
        overrideReason: gate.value.requiresOverride ? attempt.overrideReason.trim() : null,
        spAcknowledged: attempt.spAttested,
      },
    });
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : "Could not clear the load.";
  }
}
async function reject() {
  actionError.value = null;
  try {
    await recordReview.mutateAsync({ loadId: props.load.id, body: { runId: props.run.id, action: "rejected", newValue: "illegible_document" } });
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

    <!-- advisories (D3): non-blocking context the reviewer should see but is not blocked on -->
    <div v-if="advisories.length" class="mt-4 border-t border-edge pt-4">
      <p class="text-xs font-medium uppercase tracking-wide text-ink-subtle">Advisories (non-blocking)</p>
      <ul class="mt-2 space-y-2">
        <li v-for="(a, i) in advisories" :key="i" class="flex items-start gap-2 text-sm">
          <span :class="[BADGE_BASE, toneClass(advisoryTone(a.tier)), 'mt-0.5 shrink-0 !capitalize']">{{ a.tier }}</span>
          <span class="text-ink">{{ a.message }}</span>
        </li>
      </ul>
    </div>

    <!-- BOL evidence -->
    <div v-if="bolImages.length" class="mt-4">
      <p class="text-xs font-medium uppercase tracking-wide text-ink-subtle">Document evidence</p>
      <div class="mt-2 flex flex-wrap gap-2">
        <a v-for="d in bolImages" :key="d.id" :href="d.url!" target="_blank" rel="noopener noreferrer" class="block">
          <img :src="d.url!" :alt="`${d.kind} page ${d.page}`" class="h-32 w-auto rounded-md ring-1 ring-edge" />
        </a>
      </div>
    </div>

    <!-- extraction evidence (D3): what the model read + both vision passes — the audit trail behind a photo verdict -->
    <div v-if="extraction" class="mt-4 border-t border-edge pt-4">
      <p class="text-xs font-medium uppercase tracking-wide text-ink-subtle">Extraction evidence</p>
      <p class="mt-2 text-sm text-ink">
        Model read <span class="font-semibold">{{ extraction.engineLineCount }}</span> line{{ extraction.engineLineCount === 1 ? "" : "s" }} —
        document <span :class="extraction.usable ? 'text-success-700' : 'text-danger-600'">{{ extraction.usable ? "usable" : "unusable" }}</span>.
      </p>
      <ul v-if="extraction.usabilityReasons.length" class="mt-1 list-disc pl-5 text-sm text-ink-muted">
        <li v-for="(r, i) in extraction.usabilityReasons" :key="i">{{ r }}</li>
      </ul>
      <p v-if="extraction.flags.length" class="mt-2 text-sm text-ink-secondary">
        Cross-validation flags: <span class="font-mono text-xs">{{ extraction.flags.join(", ") }}</span>
      </p>
      <details v-if="extraction.passA || extraction.passB" class="mt-2">
        <summary class="cursor-pointer text-sm font-medium text-ink-secondary">View extracted fields (pass A / pass B)</summary>
        <div class="mt-2 grid gap-3 sm:grid-cols-2">
          <div>
            <p class="text-xs font-semibold text-ink-subtle">Pass A</p>
            <pre class="mt-1 max-h-64 overflow-auto rounded-md bg-surface-muted p-2 text-xs text-ink-secondary ring-1 ring-inset ring-edge">{{ prettyJson(extraction.passA) }}</pre>
          </div>
          <div>
            <p class="text-xs font-semibold text-ink-subtle">Pass B</p>
            <pre class="mt-1 max-h-64 overflow-auto rounded-md bg-surface-muted p-2 text-xs text-ink-secondary ring-1 ring-inset ring-edge">{{ prettyJson(extraction.passB) }}</pre>
          </div>
        </div>
      </details>
    </div>

    <!-- hard block: provisional dataset or unusable read — cannot clear, must reject/re-run -->
    <div v-if="hardBlock" class="mt-4 space-y-3 border-t border-edge pt-4">
      <p class="rounded-md bg-warning-50 px-3 py-2 text-sm text-warning-700 ring-1 ring-inset ring-warning-600/20">{{ hardBlock }}</p>
      <BaseButton variant="danger" size="sm" :disabled="busy" @click="reject">Reject (illegible / wrong document)</BaseButton>
      <p v-if="actionError" class="text-sm text-danger-600">{{ actionError }}</p>
    </div>

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
        <BaseButton variant="primary" size="sm" :disabled="!attestedGate || busy" @click="clear">
          {{ gate.requiresOverride ? "Override & clear" : "Attest & clear" }}
        </BaseButton>
        <BaseButton variant="danger" size="sm" :disabled="busy" @click="reject">Reject (illegible / wrong document)</BaseButton>
      </div>
      <p v-if="actionError" class="text-sm text-danger-600">{{ actionError }}</p>
    </div>
  </BaseCard>
</template>
