<script setup lang="ts">
import type { AdsConnectionCheckKey, AdsConnectionReport } from "@silvicom/shared";

/**
 * One connection test's checks, in the order the test ran them (`connectionTest.ts`): passed, failed, or
 * not reached because an earlier one failed. The detail is the API's sentence — it names the missing
 * scope, the account's state, the spending limit Meta reports — so this only gives each check its name.
 * Typed by the shared key list, so a check the test adds fails to compile here until it is named.
 * A report that passed is one line: seven "Passed" rows per account hid the one that failed (E1b browser pass).
 */
defineProps<{ report: AdsConnectionReport }>();

const CHECK_LABEL: Record<AdsConnectionCheckKey, string> = {
  token: "Token", permissions: "Permissions", ad_account: "Ad account", currency: "Currency",
  spending_limit: "Meta spending limit", page: "Facebook Page", leadgen: "New leads",
};
const MARK = (ok: boolean | null) => (ok === true ? "Passed" : ok === false ? "Failed" : "Not checked");
const TONE = (ok: boolean | null) => (ok === true ? "text-success-700" : ok === false ? "text-danger-700" : "text-ink-muted");
</script>

<template>
  <p v-if="report.ok" class="text-sm text-success-700">Every check passed ({{ report.checks.length }} of {{ report.checks.length }}).</p>
  <ul v-else class="space-y-1 text-sm">
    <li v-for="c in report.checks" :key="c.key" class="grid gap-x-4 sm:grid-cols-[10rem_6rem_1fr]">
      <span class="text-ink">{{ CHECK_LABEL[c.key] }}</span>
      <span :class="['font-medium', TONE(c.ok)]">{{ MARK(c.ok) }}</span>
      <span class="text-ink-muted">{{ c.detail }}</span>
    </li>
  </ul>
</template>
