<script setup lang="ts">
import { computed, ref } from "vue";
import { AppButton as BaseButton, QueryState } from "@silvicom/ui";
import type { RenderedDocument } from "@/lib/documentDownload";
import DocumentPreview from "@/components/DocumentPreview.vue";
import { DRUG_ALCOHOL_POLICY_PREVIEW_PATH, useDrugAlcoholPolicy } from "@/features/recruitment/useDrugAlcoholPolicy";

/**
 * Settings → Recruiting's "Drug and alcohol policy" (HIRING-WORKFLOW-AUDIT-2026-10-31 §15.2, DAP2's office
 * preview; handoff 2026-11-04 item 8).
 *
 * ── WHY IT EXISTS ─────────────────────────────────────────────────────────────────────────────
 * Every applicant is given the policy at page 28 of the packet, and their receipt names the text they were
 * given (D-DAP3). Until now the office could read that text only through somebody's application link. This
 * opens it blank, under a DRAFT band, in the viewer every other generated paper opens in — the one to
 * proofread against the paper (Q-DAP2).
 *
 * ── WHAT IT DOES NOT DO ───────────────────────────────────────────────────────────────────────
 * Nothing here edits the policy: its text is the carrier's, kept in code and changed in a reviewed PR like
 * the handbook's (D-DAP1). The version shown is the API's (`useDrugAlcoholPolicy`), so an office comparing a
 * filed receipt against the text in use compares the same `dap-…` string the receipt carries.
 */
const policy = useDrugAlcoholPolicy();
const open = ref(false);
const rendered = computed<RenderedDocument | null>(() =>
  open.value
    ? { path: DRUG_ALCOHOL_POLICY_PREVIEW_PATH, filename: "drug-alcohol-policy-preview.pdf", source: "the policy's words" }
    : null,
);
</script>

<template>
  <div class="flex flex-wrap items-start justify-between gap-3" data-testid="drug-alcohol-policy-card">
    <div class="min-w-0 space-y-1 text-sm">
      <p class="text-ink">
        Every applicant is given this policy on page 28 of the application, and signs that they received it.
        The signed copy is filed in the driver's file.
      </p>
      <div data-testid="drug-alcohol-policy-version">
        <QueryState
          :loading="policy.isLoading.value"
          :error="policy.isError.value ? policy.error.value : null"
          :retrying="policy.isFetching.value"
          loading-text="Loading the policy…"
          error-text="Could not load the policy's version."
          compact
          @retry="policy.refetch()"
        >
          <p v-if="policy.data.value" class="text-xs text-ink-muted">
            Text in use: <span class="font-mono">{{ policy.data.value.version }}</span>
          </p>
        </QueryState>
      </div>
    </div>
    <BaseButton size="sm" variant="secondary" @click="open = true">Preview the policy</BaseButton>

    <DocumentPreview
      :open="rendered !== null"
      label="Drug and alcohol policy, blank"
      :rendered="rendered"
      @close="open = false"
    />
  </div>
</template>
