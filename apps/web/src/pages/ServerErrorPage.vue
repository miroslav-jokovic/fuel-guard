<script setup lang="ts">
/**
 * The dead end for a failure that is ours, not the reader's (G1, UI-GAPS-PLAN.md).
 *
 * ⚠ Nothing navigates here automatically yet. G1 deliberately ships the page and its route and
 * stops there: a global `errorCaptured` boundary is a new app-wide behaviour, it was not decided in
 * UI-GAPS-PLAN.md, and that plan's §4 says a step that starts to need one has grown past what was
 * decided. Wiring the boundary is its own change with its own argument. Until then this is a page
 * an operator can send somebody to, and a page a future boundary can `replace()` into.
 *
 * The correlation handle is Q-UI1's fallback, not its answer. Sentry is initialised in `main.ts`
 * (no-op without `VITE_SENTRY_DSN`), so a Sentry event id looks like the obvious thing to quote —
 * but whether one is actually reachable from a Vue error boundary at render time has NOT been
 * verified, and `lastEventId` is called nowhere in this codebase today. So the page quotes what is
 * certainly available and certainly useful to whoever reads the logs: when, and where.
 */
import { computed } from "vue";
import { useRoute } from "vue-router";
import { AppButton as BaseButton } from "@fuelguard/ui";
import { ExclamationTriangleIcon } from "@fuelguard/ui/icons";
import PageHeader from "@/components/ui/PageHeader.vue";
import ErrorPanel from "@/components/ErrorPanel.vue";

const route = useRoute();

/**
 * Computed once on mount, not re-evaluated: the reader is quoting this into an email or a phone
 * call, and a timestamp that ticks while they type is a timestamp that no longer identifies
 * anything. `from` carries the path that failed when a caller sends them here.
 */
const reference = computed(() => {
  const failedAt = typeof route.query.from === "string" ? route.query.from : null;
  return [new Date().toISOString(), failedAt].filter(Boolean).join("  ·  ");
});
</script>

<template>
  <div>
    <PageHeader description="Something on our side failed. This is not a problem with what you did." />
    <ErrorPanel
      :icon="ExclamationTriangleIcon"
      message="Try again in a moment. If it keeps happening, quote the reference below when you report it — it is what lets us find this exact failure in the logs."
      detail-label="Reference:"
      :detail="reference"
    >
      <BaseButton variant="primary" to="/">Go to the dashboard</BaseButton>
    </ErrorPanel>
  </div>
</template>
