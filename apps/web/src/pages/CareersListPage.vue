<!-- ui-adoption: not-a-record — a public careers page, not an office record: its "not available" answer is drawn
     here because the shared NotFoundState's only way out is the office dashboard, which the careers host does not
     serve (APPLY-PAGE-PLAN D-AP9). Loading and failure are QueryState's. -->
<script setup lang="ts">
import { computed, watch } from "vue";
import { useRoute } from "vue-router";
import { QueryState } from "@silvicom/ui";
import { EQUIPMENT_LABEL, SCHEDULE_LABEL, openingPayText } from "@silvicom/shared";
import { CAREERS_COPY, CareersFooter, usePageHead, useCareersList, type CareersError } from "@/features/careers";

/**
 * `/careers/:handle` (APPLY-PAGE-PLAN D-AP1): the carrier's published openings, the one link the company website
 * points at (D-AP9). Each opening's title is its link, so a screen reader's list of links reads as the jobs and not
 * as "See the job" five times.
 */
const route = useRoute();
const emit = defineEmits<{ carrier: [string | null] }>();
const handle = computed(() => String(route.params.handle ?? ""));
const query = useCareersList(handle);
const view = computed(() => query.data.value ?? null);
const notFound = computed(() => (query.error.value as CareersError | null)?.status === 404);
const copy = CAREERS_COPY.list;

watch(view, (v) => emit("carrier", v?.carrier ?? null), { immediate: true });
usePageHead(computed(() => (view.value
  ? { title: copy.heading(view.value.carrier), description: `${copy.heading(view.value.carrier)}. ${copy.lead}`, canonical: view.value.pageUrl }
  : null)));
</script>

<template>
  <div>
    <section v-if="notFound" data-careers-not-found>
      <h1 class="text-2xl font-semibold text-ink">{{ CAREERS_COPY.notFound.heading }}</h1>
      <p class="mt-2 text-base text-ink-secondary">{{ CAREERS_COPY.notFound.body }}</p>
    </section>
    <QueryState v-else :loading="query.isPending.value" :error="query.error.value" :error-text="CAREERS_COPY.loadFailed" :retrying="query.isFetching.value" @retry="query.refetch()">
      <template v-if="view">
        <h1 class="text-2xl font-semibold text-ink">{{ copy.heading(view.carrier) }}</h1>
        <p class="mt-2 text-base text-ink-secondary">{{ copy.lead }}</p>
        <ul v-if="view.openings.length > 0" class="mt-6 space-y-3" data-openings>
          <li v-for="o in view.openings" :key="o.id" class="rounded-surface bg-surface p-4 ring-1 ring-inset ring-edge">
            <h2 class="text-lg font-semibold">
              <RouterLink :to="{ name: 'careers-job', params: { handle: view.handle, openingId: o.id } }" class="inline-flex min-h-11 items-center text-link underline hover:text-link-hover">
                {{ o.title }}
              </RouterLink>
            </h2>
            <p class="text-base font-medium text-ink" data-pay>{{ openingPayText(o.pay) }}</p>
            <p class="mt-1 text-sm text-ink-secondary">
              {{ [o.areaLabel, o.schedule ? SCHEDULE_LABEL[o.schedule] : null, o.equipment.map((e) => EQUIPMENT_LABEL[e]).join(", ")].filter(Boolean).join(" · ") }}
            </p>
          </li>
        </ul>
        <div v-else class="mt-6" data-no-openings>
          <p class="text-base text-ink">{{ copy.none }}</p>
          <p class="mt-1 text-sm text-ink-muted">{{ copy.noneHint }}</p>
        </div>
        <CareersFooter :carrier="view.carrier" :accommodation="view.accommodation" :legal-origin="view.legalOrigin" />
      </template>
    </QueryState>
  </div>
</template>
