<!-- ui-adoption: not-a-record — a public careers page, not an office record: its "not available" answer is drawn
     here because the shared NotFoundState's only way out is the office dashboard, which the careers host does not
     serve (APPLY-PAGE-PLAN D-AP9). Loading and failure are QueryState's. -->
<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { QueryState } from "@silvicom/ui";
import { openingPayText } from "@silvicom/shared";
import { CAREERS_COPY, CareersApplyForm, CareersFooter, CareersJobFacts, usePageHead, useCareersJob, type CareersError } from "@/features/careers";

/**
 * `/careers/:handle/jobs/:openingId` (APPLY-PAGE-PLAN D-AP1, AP3): one opening, what it pays and asks, and its form.
 * One page per job, which is what Indeed's Job Sync needs (Q-APX32). After a send the form gives way to a short
 * confirmation that names the job and promises nothing about texts: a ticked box on a flagged submission is not
 * recorded (D-AP5), and the page never says which submissions were.
 */
const route = useRoute();
const emit = defineEmits<{ carrier: [string | null] }>();
const handle = computed(() => String(route.params.handle ?? ""));
const openingId = computed(() => String(route.params.openingId ?? ""));
const query = useCareersJob(handle, openingId);
const job = computed(() => query.data.value ?? null);
const notFound = computed(() => (query.error.value as CareersError | null)?.status === 404);
const state = ref<"form" | "sent" | "gone">("form");
const heading = ref<HTMLElement | null>(null);

watch(job, (j) => emit("carrier", j?.carrier ?? null), { immediate: true });
usePageHead(computed(() => (job.value
  ? {
    title: `${job.value.opening.title} · ${job.value.carrier}`,
    description: `${job.value.opening.title} at ${job.value.carrier}: ${openingPayText(job.value.opening.facts.pay)}, ${job.value.opening.areaLabel}.`,
    canonical: job.value.pageUrl,
  }
  : null)));

/** The confirmation replaces the form; focus goes to its heading, so a screen reader hears that the send landed. */
async function show(next: "sent" | "gone"): Promise<void> {
  state.value = next;
  await nextTick();
  heading.value?.focus();
}
</script>

<template>
  <div>
    <section v-if="notFound" data-careers-not-found>
      <h1 class="text-2xl font-semibold text-ink">{{ CAREERS_COPY.notFound.heading }}</h1>
      <p class="mt-2 text-base text-ink-secondary">{{ CAREERS_COPY.notFound.body }}</p>
      <RouterLink :to="{ name: 'careers', params: { handle } }" class="mt-2 inline-flex min-h-11 items-center text-link underline hover:text-link-hover">{{ CAREERS_COPY.job.back }}</RouterLink>
    </section>
    <QueryState v-else :loading="query.isPending.value" :error="query.error.value" :error-text="CAREERS_COPY.loadFailed" :retrying="query.isFetching.value" @retry="query.refetch()">
      <template v-if="job">
        <RouterLink :to="{ name: 'careers', params: { handle: job.handle } }" class="inline-flex min-h-11 items-center text-sm text-link underline hover:text-link-hover">
          ← {{ CAREERS_COPY.job.back }}
        </RouterLink>
        <h1 class="mt-2 text-2xl font-semibold text-ink">{{ job.opening.title }}</h1>
        <p class="mt-1 text-base text-ink-secondary">{{ job.carrier }} · {{ job.opening.areaLabel }}</p>
        <div class="mt-6">
          <CareersJobFacts :job="job" />
        </div>
        <div class="mt-10 rounded-surface bg-surface p-5 ring-1 ring-inset ring-edge">
          <CareersApplyForm v-if="state === 'form'" :job="job" @sent="show('sent')" @gone="show('gone')" />
          <section v-else-if="state === 'sent'" data-careers-sent>
            <h2 ref="heading" tabindex="-1" class="text-lg font-semibold text-ink">{{ CAREERS_COPY.sent.heading }}</h2>
            <p class="mt-2 text-base text-ink">{{ CAREERS_COPY.sent.body(job.carrier, job.opening.title) }}</p>
            <p class="mt-1 text-base text-ink-secondary">{{ CAREERS_COPY.sent.next }}</p>
            <RouterLink :to="{ name: 'careers', params: { handle: job.handle } }" class="mt-2 inline-flex min-h-11 items-center text-link underline hover:text-link-hover">{{ CAREERS_COPY.sent.more }}</RouterLink>
          </section>
          <section v-else data-careers-gone>
            <h2 ref="heading" tabindex="-1" class="text-lg font-semibold text-ink">{{ CAREERS_COPY.form.gone }}</h2>
            <RouterLink :to="{ name: 'careers', params: { handle: job.handle } }" class="mt-2 inline-flex min-h-11 items-center text-link underline hover:text-link-hover">{{ CAREERS_COPY.sent.more }}</RouterLink>
          </section>
        </div>
        <CareersFooter :carrier="job.carrier" :accommodation="job.accommodation" :legal-origin="job.legalOrigin" />
      </template>
    </QueryState>
  </div>
</template>
