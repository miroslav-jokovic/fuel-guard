<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { formatDisplayDate } from "@silvicom/shared";
import { AppCallout } from "@silvicom/ui";
import { useSessionStore } from "@/stores/session";

/**
 * The 14-day notice (INSTALLED-APP-PLAN IA-S1; Q-IA12 (b), the owner's ruling of 2026-11-15): an admin who has
 * no authenticator yet is told the day it becomes required and given the way to set it up — on every page,
 * because the alternative is meeting it for the first time at 5 AM with a truck waiting.
 *
 * Drawn only when the API says there is a date to tell (`due_from`): an admin, with no factor, before their
 * company's date. Everybody else never sees it, and it goes the moment the person sets one up.
 */
const session = useSessionStore();
const due = computed(() => session.secondFactor?.due_from ?? null);
</script>

<template>
  <AppCallout v-if="due" tone="warning" class="mb-4" data-testid="second-factor-notice">
    From {{ formatDisplayDate(due) }}, admins sign in with a code from an authenticator app as well as their password.
    <RouterLink :to="{ name: 'two-step' }" class="font-semibold underline">Set it up now</RouterLink>
  </AppCallout>
</template>
