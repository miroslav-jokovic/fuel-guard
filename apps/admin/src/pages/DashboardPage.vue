<script setup lang="ts">
import { computed } from "vue";
import { AppCard, AppPageHeader, FactList, QueryState } from "@silvicom/ui";
import AppShell from "@/layouts/AppShell.vue";
import { useMeQuery } from "@/lib/queries";

/**
 * End-to-end proof of the gate: call admin-api /admin/me with the current aal2 token.
 *
 * Since US7 (D-US11) through the console's one read (`useMeQuery`) and `QueryState`. The hand-rolled
 * fetch it replaced returned early with no token and left "checking…" on screen for good, and printed
 * "admin-api returned 503" where the page's own sentence belongs.
 */
const me = useMeQuery();
const facts = computed(() =>
  me.data.value
    ? [
        { label: "admin-api", value: `Connected · ${me.data.value.role}`, tone: "text-success-700" },
        { label: "Signed in as", value: me.data.value.email },
      ]
    : [],
);
</script>

<template>
  <AppShell>
    <AppPageHeader title="Overview" description="Platform health, access, and customer operations." />

    <AppCard class="mt-5">
      <h2 class="text-sm font-semibold text-ink-secondary">Platform session</h2>
      <QueryState
        class="mt-3"
        compact
        :loading="me.isPending.value"
        :error="me.error.value"
        error-text="Could not reach admin-api."
        loading-text="Checking admin-api…"
        :retrying="me.isFetching.value"
        @retry="() => me.refetch()"
      >
        <FactList :facts="facts" layout="rows" />
      </QueryState>
    </AppCard>
  </AppShell>
</template>
