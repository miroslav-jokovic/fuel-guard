<script setup lang="ts">
import { computed } from "vue";

/**
 * Which deployment am I looking at? — a strip that answers it without being asked.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────
 * The UAT deployment and the production one read the **same Supabase**. Every org, every driver and
 * every qualification file therefore renders identically on both, and on 2026-08-20 that cost real
 * time: a PSP order was attempted on the production app while the operator was correctly signed in
 * as the QA org's user, and the only thing distinguishing the two apps was the hostname.
 *
 * Three things are independent and were being conflated — the PSP account a request reaches
 * (`PSP_ENVIRONMENT`), the Silvicom 360 org you are signed into, and the deployment serving the page.
 * This names the third, which is the one with no other visible signal.
 *
 * ── IT DOES NOT CLOSE, AND IT TAKES UP SPACE ───────────────────────────────────────────────────
 * `UpdateBanner` floats and can be dismissed because it reports a transient event. This reports a
 * standing fact about where you are, so it is neither: a strip that can be dismissed is one that is
 * absent exactly when somebody has stopped paying attention, and an overlay that never shifts the
 * layout is one that can sit behind a drawer. It occupies its own row above every layout.
 *
 * Silent in production. `VITE_APP_ENVIRONMENT` is unset there, and a marker that appears everywhere
 * marks nothing.
 */
const environment = computed(() => {
  const raw = (import.meta.env.VITE_APP_ENVIRONMENT ?? "").trim();
  return raw && raw.toLowerCase() !== "production" ? raw : null;
});

/**
 * The consequence, not just the label. "UAT" alone tells somebody which deployment they are on only
 * if they already know what that implies; what they actually need to know is where an order lands.
 */
const detail = computed(() =>
  environment.value?.toLowerCase() === "uat"
    ? "PSP orders reach the FMCSA test account, never the carrier's real one."
    : "This is not the production deployment.",
);
</script>

<template>
  <div
    v-if="environment"
    class="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 bg-warning-50 px-4 py-1.5 text-center text-xs text-warning-800 ring-1 ring-inset ring-warning-200"
    role="status"
  >
    <!-- The eyebrow spec from the design contract §"Eyebrow / group label". The value stays lowercase
         in the data — uppercase is the CSS decision the contract allows, never a content one. -->
    <span class="font-semibold tracking-wider uppercase">{{ environment }}</span>
    <span class="text-warning-700">{{ detail }}</span>
  </div>
</template>
