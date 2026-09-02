<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { FeedFreshness } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * When this feed last delivered, above the rows it qualifies (FUEL-T5 / A7).
 *
 * ── WHY A PAGE OF VENDOR ROWS NEEDS A LINE ABOVE IT ────────────────────────────────────────────
 * Transactions and Rejections show EFS's own records verbatim. Neither page can render a WRONG row —
 * it can only be missing one, and a poller that stopped looks exactly like a quiet week: fewer rows,
 * no error, nothing on screen. The fuel-drop webhook sat at zero rows for six months for the same
 * reason, and the fix was the same: say what you have heard, and when.
 *
 * ── ABOVE, NOT BELOW ───────────────────────────────────────────────────────────────────────────
 * IFTA's health gate makes this argument and it holds here: a caveat under a list is read after the
 * list has already been believed. This renders before the filter bar, where a reader meets it before
 * they draw a conclusion from a short list.
 *
 * ── AND ONLY WHEN IT MATTERS ───────────────────────────────────────────────────────────────────
 * A feed that delivered four minutes ago is toned as ordinary metadata; only `needsAttention` — late,
 * refused, or never collected — gets the caution treatment. Touching every freshness line with the
 * same colour is how a caution colour stops meaning anything.
 */
const props = defineProps<{ feed: "posted" | "rejected" }>();

interface Response { posted: FeedFreshness; rejected: FeedFreshness }

const state = ref<FeedFreshness | null>(null);
const failed = ref(false);
onMounted(async () => {
  // ⚠ The try/catch is not defensive noise, and it was missing. `apiFetch` returns `{ ok: false }`
  // for an HTTP error but does not wrap the `fetch` call itself, so a TRANSPORT failure — offline,
  // DNS, a dropped connection — REJECTS. In an async `onMounted` with no catch that is an unhandled
  // promise rejection, which is the one outcome this component's whole design rules out: the rows
  // below are still the vendor's rows, and a freshness line that cannot be read says nothing rather
  // than turning a caveat into an error. Found 2026-09-02 by mounting this on the Fuel Log, where a
  // suite that does not stub the API made it visible; the two pages that shipped it first have no
  // tests, so it had been silently possible in production since this component landed
  // (`claude/fuel-feed-freshness`, 2026-09-02).
  //
  // ⚠ The branch is named rather than the PR because a bare hash-plus-three-digits is a valid hex
  // colour, and `lint:tokens` reads it as one. This comment failed CI on exactly that.
  try {
    const res = await apiFetch<Response>("/api/fueling/feed-freshness");
    if (res.ok && res.data) state.value = res.data[props.feed];
    else failed.value = true;
  } catch {
    failed.value = true;
  }
});

const tone = computed(() =>
  state.value?.needsAttention
    ? "rounded-surface bg-caution-50 px-4 py-2.5 text-sm text-caution-800 ring-1 ring-caution-100"
    : "text-xs text-ink-tertiary",
);
</script>

<template>
  <p v-if="!failed && state" :class="tone">{{ state.lead }}</p>
</template>
