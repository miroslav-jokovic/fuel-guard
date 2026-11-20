<script setup lang="ts">
import { computed, toRef } from "vue";
import { AppCallout, FactList, QueryState } from "@silvicom/ui";
import { formatDateTime } from "@/lib/format";
import { useLeadTenstreetQuery } from "./useLeads";

/**
 * "From Tenstreet" in the lead drawer (TENSTREET-INTAKE-PLAN TS5): what Tenstreet sent with this applicant, from the
 * newest post — Tenstreet re-sends the whole application as it changes, so "as of" is that post's arrival. Read-only:
 * Tenstreet's status is shown and never moves this lead (D-TS8), and documents are names only (F7: files stay there).
 *
 * Criminal-history answers are not shown (Q-TS11, counsel). The api never sends them; when Tenstreet did, this says so,
 * so a recruiter who sees "No" everywhere is not misled into thinking none were asked.
 */
const props = defineProps<{ leadId: string }>();
const q = useLeadTenstreetQuery(toRef(props, "leadId"));
const post = computed(() => q.data.value ?? null);
const v = computed(() => post.value?.view ?? null);

const yesNo = (b: boolean | null): string => (b === true ? "Yes" : b === false ? "No" : "Not answered");
const says = computed(() => {
  const s = v.value?.says;
  if (!s) return [];
  return [
    { key: "status", label: "Status", value: s.status },
    { key: "worklist", label: "Worklist", value: s.worklist },
    { key: "recruiter", label: "Recruiter", value: s.recruiter },
  ].filter((r) => r.value !== null);
});
const tagFacts = computed(() => (v.value?.tags ?? []).map((t, i) => ({ key: `tag-${i}`, label: t.prompt, value: t.value ?? "—" })));
const licenceLine = (l: NonNullable<typeof v.value>["licences"][number]): string =>
  [
    l.class ? `Class ${l.class}` : "Class not given",
    l.cdl === true ? "CDL" : l.cdl === false ? "not a CDL" : null,
    l.state,
    l.current === true ? "current" : l.current === false ? "not current" : null,
    l.endorsements.length > 0 ? l.endorsements.join(", ") : null,
  ].filter(Boolean).join(" · ");
const countLine = (n: number | null, what: string): string => (n === null ? `${what}: not asked` : `${what}: ${n} listed`);
</script>

<template>
  <section aria-labelledby="lead-tenstreet-heading" data-test="from-tenstreet">
    <h3 id="lead-tenstreet-heading" class="text-sm font-semibold text-ink">From Tenstreet</h3>
    <QueryState
      v-if="q.isLoading.value || q.isError.value"
      compact
      :loading="q.isLoading.value"
      :error="q.error.value"
      error-text="Could not load what Tenstreet sent."
      :retrying="q.isFetching.value"
      @retry="q.refetch()"
    />
    <p v-else-if="!post" class="mt-1 text-sm text-ink-muted">Nothing from Tenstreet to show yet.</p>
    <div v-else-if="v" class="mt-1 space-y-4 text-sm">
      <p class="text-xs text-ink-muted">As Tenstreet sent it {{ formatDateTime(post.receivedAt) }}. It does not change this lead.</p>

      <FactList v-if="says.length > 0" :facts="says" layout="rows" />

      <div v-if="v.licences.length > 0">
        <p class="font-medium text-ink">Licences</p>
        <ul class="mt-1 space-y-1 text-ink-secondary">
          <li v-for="(l, i) in v.licences" :key="i" data-test="ts-licence">{{ licenceLine(l) }}</li>
        </ul>
      </div>

      <div v-if="v.employers.length > 0">
        <p class="font-medium text-ink">Employers</p>
        <ul class="mt-1 space-y-1 text-ink-secondary">
          <li v-for="(e, i) in v.employers" :key="i" data-test="ts-employer">
            {{ e.name ?? "Name not given" }}<span class="ml-2 text-xs text-ink-muted">{{ e.start ?? "?" }} – {{ e.end ?? "?" }}</span>
          </li>
        </ul>
      </div>

      <p class="text-ink-secondary" data-test="ts-counts">{{ countLine(v.accidents, "Accidents") }} · {{ countLine(v.violations, "Moving violations") }}</p>

      <div v-if="v.mvr.length > 0">
        <p class="font-medium text-ink">Driving record</p>
        <ul class="mt-1 space-y-2">
          <li v-for="m in v.mvr" :key="m.type" data-test="ts-mvr">
            <p class="text-ink-muted">{{ m.question }}</p>
            <p class="font-medium text-ink">{{ yesNo(m.answer) }}</p>
          </li>
        </ul>
      </div>

      <AppCallout v-if="v.criminalWithheld" tone="info" data-test="ts-withheld">
        Tenstreet also sent answers about criminal history. They are not shown here until counsel confirms who may see them.
      </AppCallout>

      <div v-if="v.custom.length > 0">
        <p class="font-medium text-ink">Your questions</p>
        <ul class="mt-1 space-y-2">
          <li v-for="(c, i) in v.custom" :key="i" data-test="ts-custom">
            <p class="text-ink-muted">{{ c.question }}</p>
            <p class="whitespace-pre-line font-medium text-ink">{{ c.answer ?? "Not answered" }}</p>
          </li>
        </ul>
      </div>

      <div v-if="v.tags.length > 0">
        <p class="font-medium text-ink">Tags</p>
        <div class="mt-1" data-test="ts-tags"><FactList :facts="tagFacts" layout="rows" /></div>
      </div>

      <div v-if="v.documents.length > 0">
        <p class="font-medium text-ink">Documents in Tenstreet</p>
        <ul class="mt-1 space-y-1 text-ink-secondary">
          <li v-for="(d, i) in v.documents" :key="i" data-test="ts-document">
            {{ d.name }}<span v-if="d.category" class="ml-2 text-xs text-ink-muted">{{ d.category }}</span>
          </li>
        </ul>
        <p class="mt-1 text-xs text-ink-muted">The files stay in Tenstreet.</p>
      </div>
    </div>
  </section>
</template>
