<script setup lang="ts">
import { computed } from "vue";
import { AppCallout } from "@silvicom/ui";
import type { NoHazmatEvidence } from "./bolNoHazmat";

/**
 * What a read with no hazmat line says (bolPrefill.ts `noHazmat`). "No hazardous materials on this BOL" only
 * when nothing in bolNoHazmat.ts doubts it; otherwise "check the page", with each reason in words, so the
 * dispatcher knows what to look for rather than only that something is missing.
 */
const props = defineProps<{ otherLines: string[]; bothReaders: boolean; evidence: NoHazmatEvidence }>();

const sure = computed(() => props.evidence.doubts.length === 0);
const doubtSentences = computed(() => props.evidence.doubts.flatMap((d) => {
  const pages = props.evidence.markPages;
  switch (d) {
    case "no_page_scan": return ["The page was not scanned for UN or NA numbers, so nothing backs the readers."];
    case "marks_on_page": return [`The page scan found ${props.evidence.marks.join(", ") || "a hazmat mark"}${pages.length ? ` on page ${pages.join(", ")}` : ""} — a hazmat line the readers may have missed.`];
    case "pages_unconfirmed": return ["It cannot be confirmed that every page of this BOL is here — check its page numbers."];
    default: return []; // one_reader is said by the sentence about the readers
  }
}));
</script>

<template>
  <AppCallout :tone="sure ? 'info' : 'warning'" data-testid="bol-prefill">
    <div class="space-y-1">
      <p class="font-semibold">{{ sure ? "No hazardous materials on this BOL." : "No hazardous materials read on this BOL — check the page." }}</p>
      <p>
        {{ bothReaders ? "Both readers" : "Only one reader" }} read it and found no hazmat line<template v-if="otherLines.length">, only: {{ otherLines.join("; ") }}</template>.
        <template v-if="sure">The page scan found no UN or NA number and no HM mark, and every page is here. Nothing on this BOL needs a placard.</template>
        <template v-else>{{ doubtSentences.join(" ") }} Look at the page for a UN or NA number before you rely on it.</template>
        If other freight on the truck is hazmat, read its BOL too, or add the product below.
      </p>
    </div>
  </AppCallout>
</template>
