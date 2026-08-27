<script setup lang="ts">
/**
 * The render-error boundary (Q-UI5, UI-GAPS-PLAN.md §6).
 *
 * ── What was actually missing ───────────────────────────────────────────────────────────────────
 * Sixty-one pages already surface DATA failures well: a vue-query error becomes an `isError` branch
 * with a retry. What nothing handled was a RENDER failure — a bug in component code — which left the
 * tree in an undefined state and the reader looking at a blank or half-drawn region with no message.
 * That is the same defect class G1 fixed for routing: the app looks broken and cannot say why.
 *
 * ── Why it renders in place instead of navigating to /error ─────────────────────────────────────
 * A redirect would discard the URL, and the URL is the one thing that makes the failure
 * reproducible — for the reader reloading, and for whoever they report it to. `/error` stays a
 * route an operator can send somebody to; this is the automatic path, and it keeps the address bar.
 *
 * ── Why it returns false, and reports the error itself ─────────────────────────────────────────
 * The first cut let the error propagate, reasoning that `Sentry.init({ app })` already installs an
 * `errorHandler` and one reporting path is better than two. That was wrong, and the tests said so
 * immediately: propagation leaves the throwing child in the tree, Vue re-patches it, and it throws
 * again — the boundary never contains anything. Returning false is what actually stops the render,
 * and the cost of that is this file being the one place in `apps/web` that calls the SDK directly.
 * It is a fair trade for a component whose entire job is containment.
 *
 * ⚠ The event id comes from the `captureException` return value ONLY behind a `getClient()` check.
 * Measured on 10.69.0: with no `Sentry.init`, `captureException` still returns a plausible 32-hex id
 * for an event that went nowhere. See `lib/errorReference.ts`.
 */
import { ref, computed, watch } from "vue";
import { onErrorCaptured } from "vue";
import { useRoute } from "vue-router";
import { AppButton as BaseButton } from "@silvicom/ui";
import { ExclamationTriangleIcon } from "@silvicom/ui/icons";
import { captureException, getClient } from "@sentry/vue";
import ErrorPanel from "@/components/ErrorPanel.vue";
import { errorReference } from "@/lib/errorReference";

const route = useRoute();
const failed = ref(false);
/**
 * Stamped once, when the error is caught — not recomputed on render. The reader is copying this into
 * an email or reading it down a phone; a timestamp that moves while they type identifies nothing.
 */
const failedAt = ref<string | null>(null);
const failedPath = ref<string | null>(null);

const failedEventId = ref<string | null>(null);

onErrorCaptured((err) => {
  failed.value = true;
  failedAt.value = new Date().toISOString();
  failedPath.value = route.fullPath;
  // Only ask Sentry for an id when a client exists; otherwise the SDK hands back a convincing one
  // that was never sent, and the reader ends up quoting an identifier that matches nothing.
  failedEventId.value = getClient() ? (captureException(err) ?? null) : null;
  return false; // stop propagation — otherwise the throwing child is re-patched and throws again
});

/**
 * Navigating away clears the boundary. Without this, one broken page would wedge the whole shell
 * until a full reload, which turns a single bad component into an unusable application.
 */
watch(
  () => route.fullPath,
  () => {
    failed.value = false;
  },
);

const reference = computed(() =>
  errorReference({ at: failedAt.value ?? "", path: failedPath.value, eventId: failedEventId.value }),
);
</script>

<template>
  <div v-if="failed">
    <header class="flex flex-col gap-4 border-b border-edge-subtle pb-5">
      <div class="min-w-0">
        <h1 class="text-2xl font-semibold tracking-tight text-ink">Something went wrong</h1>
        <p class="mt-1 max-w-3xl text-sm text-ink-tertiary">
          This page failed to render. Nothing you did caused it, and nothing you were looking at has
          been changed.
        </p>
      </div>
    </header>
    <ErrorPanel
      :icon="ExclamationTriangleIcon"
      message="Reloading usually clears it. If it keeps happening, quote the reference below when you report it — it is what lets us find this exact failure in the logs."
      detail-label="Reference:"
      :detail="reference"
    >
      <BaseButton variant="primary" @click="failed = false">Try again</BaseButton>
      <BaseButton variant="secondary" to="/">Go to the dashboard</BaseButton>
    </ErrorPanel>
  </div>
  <slot v-else />
</template>
