<script setup lang="ts">
/**
 * Planned downtime (G1, UI-GAPS-PLAN.md).
 *
 * Deliberately static: no query, no fetch, no session read beyond what the layout already does.
 * The circumstance in which this page is worth showing is the circumstance in which fetching does
 * not work, so a maintenance page that has to load something to render is a maintenance page that
 * shows a spinner during an outage.
 *
 * ⚠ The copy deliberately promises nothing about ingestion. The API, the worker and this SPA are
 * separate Railway services and this page cannot know which of them the window covers, so it must
 * not tell a carrier their transactions are still landing — during an API outage that would be a
 * lie, and it is exactly the kind of lie somebody reconciles a statement against.
 *
 * ⚠ Nothing sets this automatically (Q-UI4). It is a URL an operator visits or points people at.
 * Do not add a health-check poll to the SPA to trigger it — that is a new background behaviour and
 * it was not decided in UI-GAPS-PLAN.md.
 */
import { AppButton as BaseButton } from "@silvicom/ui";
import { ClockIcon } from "@silvicom/ui/icons";
import PageHeader from "@/components/ui/PageHeader.vue";
import ErrorPanel from "@/components/ErrorPanel.vue";
</script>

<template>
  <div>
    <PageHeader description="Silvicom 360 is briefly offline for planned maintenance." />
    <ErrorPanel
      :icon="ClockIcon"
      message="Nothing is required from you. Try again shortly — and if this page is still here well past the window you were told about, that is worth reporting rather than waiting out."
    >
      <BaseButton variant="primary" to="/">Try again</BaseButton>
    </ErrorPanel>
  </div>
</template>
