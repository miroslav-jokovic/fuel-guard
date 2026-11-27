<script setup lang="ts">
import { computed } from "vue";
import {
  BONUS_KIND_LABEL,
  EQUIPMENT_LABEL,
  SCHEDULE_LABEL,
  benefitLabel,
  dollarsText,
  openingPayText,
  type ApplyJobView,
} from "@silvicom/shared";
import { FactList } from "@silvicom/ui";
import { formatDate } from "@/lib/format";
import { CAREERS_COPY } from "./careersCopy";

/**
 * What the job is (APPLY-PAGE-PLAN AP3, D-AP2): the opening's own saved facts, in the editor's own words
 * (`openingText.ts`), and nothing the office did not type. The pay range comes first because the Illinois Equal Pay
 * Act is why the page exists in this shape; benefits follow it for the same Act's "general description of the
 * benefits". A fact the office left empty is left out rather than shown as "none".
 */
const props = defineProps<{ job: ApplyJobView }>();
const copy = CAREERS_COPY.job;
const f = computed(() => props.job.opening.facts);

const rows = computed(() => {
  const out: Array<{ label: string; value: string }> = [
    { label: copy.pay, value: openingPayText(f.value.pay) },
    { label: copy.homeTime, value: f.value.home_time },
    { label: copy.equipment, value: f.value.equipment.map((e) => EQUIPMENT_LABEL[e]).join(", ") },
  ];
  if (f.value.schedule) out.push({ label: copy.schedule, value: SCHEDULE_LABEL[f.value.schedule] });
  if (f.value.lanes) out.push({ label: copy.lanes, value: f.value.lanes });
  out.push({ label: copy.area, value: props.job.opening.areaLabel });
  if (f.value.start_date) out.push({ label: copy.start, value: formatDate(f.value.start_date) });
  if (f.value.bonus) out.push({ label: copy.bonus, value: `${BONUS_KIND_LABEL[f.value.bonus.kind]}: ${dollarsText(f.value.bonus.cents)}` });
  return out;
});

const asks = computed(() => {
  const r = props.job.requirements;
  const out: string[] = [copy.classA];
  if (r.minClassAYears > 0) out.push(copy.minYears(r.minClassAYears));
  if (r.minAge > 0) out.push(copy.minAge(r.minAge));
  if (r.hazmat === "required") out.push(copy.hazmatRequired);
  if (r.hazmat === "preferred") out.push(copy.hazmatPreferred);
  return out;
});
</script>

<template>
  <section :aria-label="job.opening.title" class="space-y-6">
    <p v-if="f.in_our_words" class="text-base text-ink-secondary">{{ f.in_our_words }}</p>
    <FactList :facts="rows" :columns="2" data-job-facts />
    <div v-if="f.benefits.length > 0">
      <h2 class="text-lg font-semibold text-ink">{{ copy.benefits }}</h2>
      <ul class="mt-2 list-disc space-y-1 pl-5 text-base text-ink" data-benefits>
        <li v-for="b in f.benefits" :key="b">{{ benefitLabel(b) }}</li>
      </ul>
    </div>
    <div>
      <h2 class="text-lg font-semibold text-ink">{{ copy.requirements }}</h2>
      <ul class="mt-2 list-disc space-y-1 pl-5 text-base text-ink" data-requirements>
        <li v-for="a in asks" :key="a">{{ a }}</li>
      </ul>
    </div>
  </section>
</template>
