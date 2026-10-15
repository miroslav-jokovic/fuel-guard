<script setup lang="ts">
import AppIcon from "./AppIcon.vue";
import BaseButton from "./AppButton.vue";
import { ArrowPathIcon, ExclamationTriangleIcon } from "../icons";
import ErrorState from "./ErrorState.vue";
import NotFoundState from "./NotFoundState.vue";
import { isNotFound } from "../lists/notFound";

/**
 * Loading, failure and content for anything that fetches and is NOT a table (D-US5,
 * docs/plans/design-system/UI-STANDARDIZATION.md).
 *
 * ── WHY ────────────────────────────────────────────────────────────────────────────────────────
 * `DataTable` has always drawn its own three states, so every list looked the same while it loaded
 * or failed. Everything else wrote them by hand: on 2026-10-12 there were 65 hand-written
 * "Loading…" lines in six styles (`<p>`, `<div>`, bare text; `ink-muted` or `ink-tertiary`), and
 * twenty files that read `isError` either said "Reload to try again" or said nothing at all. A
 * reader cannot tell a page that is slow from one that is broken when the two look alike, and a
 * failure with no retry sends somebody to the browser's reload button, which resets everything else
 * they had open.
 *
 * So the order is the table's, `loading` → failure → content, and the failure ALWAYS carries a
 * retry: `@retry` is required in practice (pass the query's `refetch`).
 *
 * ── TWO SIZES ──────────────────────────────────────────────────────────────────────────────────
 * The default failure is `ErrorState` — the centred block a table shows — for a page or a page
 * section. `compact` is one line with the retry beside it, for a panel or a card inside a drawer,
 * where a block twelve units tall would push the drawer's own content off screen.
 *
 * ── NOT FOUND IS A FOURTH STATE (F21) ──────────────────────────────────────────────────────────
 * A record read that throws `NotFoundError` is not a failure: there is nothing to retry. It draws
 * `NotFoundState` — a sentence and the way back to the record's list — in place of the failure, and
 * the compact size says the sentence alone. `notFoundText` is the page's own sentence; without it
 * the API's reason is shown ("That asset is not on the books.").
 *
 * ⚠ The loading line is a polite live region, so a screen reader hears "Loading the part…" once and
 * then the content, rather than nothing.
 */
withDefaults(
  defineProps<{
    loading: boolean;
    /** Truthy when the fetch failed. An `Error`'s message is shown unless `errorText` is given. */
    error?: unknown;
    /** What failed, in the voice's "Could not load the part." form. */
    errorText?: string;
    retrying?: boolean;
    /** Say WHAT is loading where there is room: "Loading the part…". */
    loadingText?: string;
    compact?: boolean;
    /** What is missing when the read threw `NotFoundError`: "That asset is not on the books." */
    notFoundText?: string;
  }>(),
  {
    error: undefined,
    errorText: undefined,
    retrying: false,
    loadingText: "Loading…",
    compact: false,
    notFoundText: undefined,
  },
);
const emit = defineEmits<{ retry: [] }>();

const messageOf = (error: unknown, fallback?: string) =>
  fallback ?? (error instanceof Error && error.message ? error.message : "Could not load this.");
</script>

<template>
  <p v-if="loading" role="status" aria-live="polite" class="text-sm text-ink-muted">{{ loadingText }}</p>
  <template v-else-if="isNotFound(error)">
    <p v-if="compact" role="status" class="text-sm text-ink-secondary">{{ notFoundText ?? error.message }}</p>
    <NotFoundState v-else :message="notFoundText ?? error.message" />
  </template>
  <template v-else-if="error">
    <div v-if="compact" role="alert" class="flex flex-wrap items-center gap-2 text-sm text-ink-secondary">
      <AppIcon :icon="ExclamationTriangleIcon" class="size-4 shrink-0 text-warning-500" aria-hidden="true" />
      <span class="min-w-0">{{ messageOf(error, errorText) }}</span>
      <BaseButton variant="ghost" size="sm" :disabled="retrying" @click="emit('retry')">
        <AppIcon :icon="ArrowPathIcon" class="size-4" :class="{ 'animate-spin': retrying }" aria-hidden="true" />
        {{ retrying ? "Retrying…" : "Retry" }}
      </BaseButton>
    </div>
    <ErrorState v-else role="alert" :message="messageOf(error, errorText)" :retrying="retrying" @retry="emit('retry')" />
  </template>
  <slot v-else />
</template>
