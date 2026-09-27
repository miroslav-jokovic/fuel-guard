<script setup lang="ts">
import type { FcraSummary } from "@silvicom/shared";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * Screen 12 (§6.2): the FCRA summary, as the server served it — the Bureau's form, whole (see
 * `fcraSummary.ts` for why nothing in it is shortened). Laid out as the form is: the rights as a list
 * with their lead sentences in bold, the regulators as a table after.
 *
 * Nothing on this screen is a question, on purpose: the summary is owed, not agreed to, and the one act
 * — "I have read this" — is the flow's Continue, which records WHICH text was shown (0376).
 */
defineProps<{ summary: FcraSummary }>();
const copy = APPLY_COPY.partOne.rights;
</script>

<template>
  <article class="space-y-4 text-sm text-ink-secondary">
    <p class="italic" lang="es">{{ summary.spanishNote }}</p>
    <h2 class="text-base font-semibold text-ink">{{ summary.title }}</h2>
    <p v-for="(p, i) in summary.intro" :key="`intro-${i}`" :class="i === 1 && 'font-semibold'">{{ p }}</p>
    <ul class="list-disc space-y-3 pl-5">
      <li v-for="right in summary.rights" :key="right.heading">
        <strong class="text-ink">{{ right.heading }}</strong>
        <template v-for="(block, j) in right.blocks" :key="j">
          <ul v-if="typeof block !== 'string'" class="mt-2 list-[circle] space-y-1 pl-5">
            <li v-for="item in block" :key="item">{{ item }}</li>
          </ul>
          <p v-else class="mt-2">{{ block }}</p>
        </template>
      </li>
    </ul>
    <p>{{ summary.closing }}</p>
    <div>
      <h3 class="font-semibold text-ink">{{ copy.contacts }}</h3>
      <div class="mt-2 hidden gap-4 text-xs font-semibold text-ink-tertiary sm:grid sm:grid-cols-2" aria-hidden="true">
        <span>{{ summary.contactsHeading.business }}</span><span>{{ summary.contactsHeading.contact }}</span>
      </div>
      <dl class="mt-1 divide-y divide-edge">
        <div v-for="row in summary.contacts" :key="row.business" class="grid gap-1 py-2 sm:grid-cols-2 sm:gap-4">
          <dt>{{ row.business }}</dt>
          <dd><span v-for="line in row.contact" :key="line" class="block">{{ line }}</span></dd>
        </div>
      </dl>
    </div>
  </article>
</template>
