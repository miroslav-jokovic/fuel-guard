<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  oldestSamsaraFeed,
  worstSamsaraFeed,
  type SamsaraFeedId,
  type SamsaraFeedPulse,
} from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * How current the telematics behind THIS page is, above the figures rather than below them (SAM-S5).
 *
 * ── WHY A PAGE OF SAMSARA-DERIVED FIGURES NEEDS A LINE ABOVE IT ────────────────────────────────
 * The same argument `FeedFreshnessLine` makes for the EFS pages, and the same evidence: a collector
 * that stops does not render a wrong number, it renders a smaller one, and a smaller number looks
 * exactly like a quieter month. Production carried 17 days with no fuel at all for four months
 * (SAMSARA-COLLECTION-PLAN §8) while every page showed a confident total. This says what the figures
 * below it were built from and when it last arrived, before the reader draws a conclusion from them.
 *
 * ── IT RENDERS WHETHER OR NOT ANYTHING IS WRONG, AND THAT IS THE POINT ─────────────────────────
 * A strip that appears only on a breach has an absence that means two things — "all well" and "this
 * did not load" — and being unable to tell those apart is the failure S5 exists to remove. So a
 * healthy feed gets a quiet metadata line and only `needsAttention` gets the caution treatment;
 * touching every freshness line with the same colour is how a caution colour stops meaning anything.
 *
 * ── EACH PAGE NAMES THE FEEDS IT ACTUALLY DEPENDS ON ──────────────────────────────────────────
 * `feeds` is required rather than defaulted to "all". The collector runs eight tiers and no page
 * reads more than three of them; a strip scoped to all of them would tell a reader looking at idle
 * time that the IFTA filing is late, which is true, unactionable there, and the fastest way to teach
 * somebody to stop reading the line.
 *
 * ── WHY IT READS A SECOND ROUTE (Q-SAM7, answered (a)) ─────────────────────────────────────────
 * The settings card's route is `requireSection("settings", "view")` and every page that mounts this
 * is `requiresAuth` with no section gate at all. `/feed-pulse` matches the audience of the pages and
 * withholds the vendor's error text, which is the field that made widening the card unacceptable.
 * Reading the card's route here would 403 for most of the people this line is written for.
 */
const props = defineProps<{
  /** The tiers the figures on this page are built from. See the header — never all eight. */
  feeds: readonly SamsaraFeedId[];
}>();

const pulse = ref<SamsaraFeedPulse[] | null>(null);

onMounted(async () => {
  // ⚠ `apiFetch` returns `{ ok: false }` for an HTTP error but does not wrap the `fetch` itself, so a
  // TRANSPORT failure REJECTS — and in an async `onMounted` with no catch that is an unhandled
  // rejection. Exactly the defect found in `FeedFreshnessLine` on 2026-09-02: a caveat above a page
  // must fail by saying nothing, never by breaking the page it only annotates.
  try {
    const res = await apiFetch<{ feeds: SamsaraFeedPulse[] }>("/api/integrations/samsara/feed-pulse");
    if (res.ok && res.data) pulse.value = res.data.feeds;
  } catch {
    pulse.value = null;
  }
});

/** Worst first; the oldest healthy feed only when nothing in scope needs attention. */
const shown = computed(() =>
  pulse.value ? (worstSamsaraFeed(pulse.value, props.feeds) ?? oldestSamsaraFeed(pulse.value, props.feeds)) : null,
);

const tone = computed(() =>
  shown.value?.needsAttention
    ? "rounded-surface bg-caution-50 px-4 py-2.5 text-sm text-caution-800 ring-1 ring-caution-100"
    : "text-xs text-ink-tertiary",
);
</script>

<template>
  <p v-if="shown" :class="tone" data-testid="samsara-feed-line">{{ shown.lead }}</p>
</template>
