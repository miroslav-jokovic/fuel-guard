<script setup lang="ts">
import { computed } from "vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import type { ApplyRelease } from "@/features/apply/useApplication";

/**
 * The four releases, shown READ-ONLY while the wording is draft (Q-H3, H5b).
 *
 * ── WHY THEY ARE SHOWN AT ALL RATHER THAN HIDDEN ───────────────────────────────────────────────
 * The server refuses to record a signature on `v0-draft` text, so there is nothing to sign here yet.
 * Hiding the section would let an applicant submit believing the process is complete, and then be
 * asked weeks later to sign four documents they had never seen. Showing them, clearly marked, means
 * the person knows what they are being asked to consent to and what is still outstanding — which is
 * the disclosure's own purpose, minus the signature.
 *
 * ── AND WHY THERE IS NO CHECKBOX ───────────────────────────────────────────────────────────────
 * FCRA §604(b)(2) requires the disclosure to be its own document, and the authorization to be signed
 * on it. A checkbox here would sit inside an application form beside twenty other fields — the exact
 * arrangement the regulation forbids. When counsel's wording lands, each instrument gets its own
 * signing step, not a tickbox on this page.
 *
 * The wording is served by the API and rendered verbatim; it is never bundled into this app, so what
 * an applicant read is a fact the server can prove.
 */
const props = defineProps<{ releases: ApplyRelease[] }>();
const anyDraft = computed(() => props.releases.some((r) => r.draft));
</script>

<template>
  <section class="space-y-4">
    <div>
      <h2 class="text-base font-semibold text-ink">What you will be asked to authorise</h2>
      <p v-if="anyDraft" class="mt-1 text-sm text-ink-muted">
        These are the checks a carrier runs before hiring a driver. The final wording is still being
        prepared, so nothing here is being signed today — you will be asked to sign each one
        separately, and each is its own document. Read them now so nothing later is a surprise.
      </p>
      <p v-else class="mt-1 text-sm text-ink-muted">
        Each of these is signed separately, on its own, after you submit this application.
      </p>
    </div>

    <article
      v-for="release in releases"
      :key="release.purpose"
      class="space-y-2 rounded-surface bg-surface-muted p-4"
    >
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="text-sm font-semibold text-ink">{{ release.title }}</h3>
        <span v-if="release.draft" :class="[BADGE_BASE, toneClass('warning')]">Not final</span>
      </div>
      <p class="text-xs text-ink-muted">{{ release.citation }}</p>
      <p class="whitespace-pre-line text-sm text-ink-secondary">{{ release.body }}</p>
      <p class="text-sm font-medium text-ink">{{ release.intent }}</p>
    </article>
  </section>
</template>
