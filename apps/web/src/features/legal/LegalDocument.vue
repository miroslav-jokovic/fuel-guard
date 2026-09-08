<script setup lang="ts">
import { AppCallout } from "@silvicom/ui";
import { LEGAL_EFFECTIVE, LEGAL_VERSION, UNDER_REVIEW } from "./legalMeta";

/**
 * The frame all three legal documents render in (P3.2).
 *
 * ── WHY A COMPONENT RATHER THAN THREE PAGES THAT EACH SET THEIR OWN HEADING ─────────────────────
 * A store reviewer opens `/privacy` and a driver opens `/support`, and the two have to look like
 * documents published by the same company on the same day. The version and effective date come from
 * `legalMeta.ts` rather than each page, so they cannot disagree — three dates, one of them stale, is
 * how a policy stops being evidence of anything.
 *
 * The measure is capped at `max-w-3xl`. Legal text is read line by line rather than scanned, and the
 * public layout's own `max-w-5xl` is a width for a landing page with a form in it, not for prose.
 */
withDefaults(
  defineProps<{
    /** The document's own title — the `<h1>`. The route's `meta.title` sets the browser tab. */
    title: string;
    /** One sentence, in a driver's words, saying what this document is for. */
    summary: string;
    /**
     * Whether this document carries the counsel-review notice. True for the two that are legal
     * INSTRUMENTS — the policy and the terms, which counsel will revise. The support page opts out:
     * it is troubleshooting guidance, nothing on it is a promise a lawyer would redraft, and telling
     * a driver whose photo will not upload that the page is "under legal review" is noise in front of
     * the answer they came for.
     */
    reviewNotice?: boolean;
  }>(),
  { reviewNotice: true },
);
</script>

<template>
  <article class="mx-auto max-w-3xl space-y-8">
    <header class="space-y-3">
      <h1 class="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{{ title }}</h1>
      <p class="text-base text-ink-secondary">{{ summary }}</p>
      <p class="text-xs text-ink-tertiary">Version {{ LEGAL_VERSION }} · Effective {{ LEGAL_EFFECTIVE }}</p>
    </header>

    <!--
      Q-PR3 — the notice is the honest state, not a disclaimer for its own sake. D-PR9 publishes
      these documents before counsel has reviewed them, because the stores need a working URL and a
      review has no date attached to it. Saying so is better than a page that implies a sign-off that
      has not happened; `UNDER_REVIEW` in `legalMeta.ts` is what removes it, in the commit that lands
      counsel's revisions.
    -->
    <AppCallout v-if="UNDER_REVIEW && reviewNotice" tone="info">
      This is a first published version and is under legal review. The practices it describes are
      what the app does today; the wording may change.
    </AppCallout>

    <div class="space-y-8">
      <slot />
    </div>
  </article>
</template>
