<script setup lang="ts">
import { AppButton as BaseButton } from "@silvicom/ui";
import { useRouter } from "vue-router";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { ReconRejected, useRecheckStatement, type ReconCarried } from "./useReconRuns";

/**
 * "Check again" on a recorded weekly bill (PILOT-INVOICE-FORMAT-ANALYSIS-2026-11-24 §5).
 *
 * The server re-reads the PDF it kept with today's reader and records a NEW check, which replaces this one in
 * the list; this page then shows the newer check. Behind `session.can("fuel")` because the route is
 * `requireSection("fuel")` — the manage set, the same gate as recording a check from the drawer.
 */
const props = defineProps<{ statementId: string }>();

const session = useSessionStore();
const toast = useToastStore();
const router = useRouter();
const recheck = useRecheckStatement();

function closedSummary(c: ReconCarried | undefined): string | undefined {
  if (!c) return undefined;
  const parts = [
    c.recheckDropped && `${c.recheckDropped} no longer found`,
    c.billedLate && `${c.billedLate} billed late, now matched`,
    c.recordedLate && `${c.recordedLate} recorded late, now matched`,
  ].filter(Boolean);
  return parts.length ? `Closed earlier findings: ${parts.join(", ")}.` : undefined;
}

async function run() {
  try {
    const r = await recheck.mutateAsync(props.statementId);
    toast.success("Checked again", closedSummary(r.carried));
    if (r.runId) await router.push({ name: "fuel-invoice-check", params: { id: r.runId } });
  } catch (e) {
    const reasons = e instanceof ReconRejected && e.reasons.length ? e.reasons.join(" ") : undefined;
    toast.error(e instanceof Error ? e.message : "Could not check that invoice again", reasons);
  }
}
</script>

<template>
  <BaseButton v-if="session.can('fuel')" variant="secondary" size="sm" :disabled="recheck.isPending.value" @click="run">
    {{ recheck.isPending.value ? "Checking again…" : "Check again" }}
  </BaseButton>
</template>
