<script setup lang="ts">
import { computed, ref } from "vue";
import {
  BROKER_MAIL_TAB_LABELS,
  BROKER_MAIL_WEEK_MATCH_PASS,
  BROKER_MAIL_WEEK_WRONG_PASS,
  formatDisplayDate,
  formatDisplayDateRange,
  formatDisplayDateTime,
  type BrokerMailWeek,
  type BrokerMailWeekStats,
} from "@silvicom/shared";
import { AppBadge, AppCard, AppDateField, AppFormField, DataTable, QueryState, StatCard, type DataTableColumn } from "@silvicom/ui";
import { useBrokerMailWeekQuery } from "./useBrokerMail";

/**
 * Settings › Broker mail › Measure week (BROKER-MAIL-READER-PLAN §8). The evidence the go / change /
 * stop ruling is made on — every number's rule is in `brokerMailWeekContract.ts`. Read-only: the
 * report changes nothing, and the hand check against Outlook stays a person's.
 */
const from = ref("");
const { data, isLoading, isError, error, isFetching, refetch } = useBrokerMailWeekQuery(from);

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)} %`);
const mins = (v: number | null) => (v === null ? "—" : `${v} min`);
const texts = (s: BrokerMailWeekStats) => s.wouldText.dispatcherDay + s.wouldText.dispatcherNight;
const backups = (s: BrokerMailWeekStats) => s.wouldText.backupDay + s.wouldText.backupHeldToMorning;

const week = computed<BrokerMailWeek | null>(() => data.value ?? null);
const matchTone = computed(() => (week.value?.passMarks.matchedOnePass === null ? undefined : week.value?.passMarks.matchedOnePass ? "text-success-700" : "text-danger-700"));

const statColumns: DataTableColumn[] = [
  { key: "label", label: "", card: "title" },
  { key: "external", label: "External", align: "right" },
  { key: "candidates", label: "Broker", align: "right" },
  { key: "one", label: "One load", align: "right" },
  { key: "bySubject", label: "By subject", align: "right" },
  { key: "several", label: "Several / none", align: "right" },
  { key: "viaList", label: "Via a list", align: "right" },
  { key: "reply", label: "Reply (median · 90 %)", align: "right" },
  { key: "colleague", label: "Colleague answered", align: "right" },
  { key: "texts", label: "Texts (night)", align: "right" },
  { key: "backups", label: "Backup notices", align: "right" },
];
const statRow = (key: string, label: string, s: BrokerMailWeekStats, extra: Record<string, unknown> = {}) => ({
  key, label, ...extra,
  external: s.external,
  candidates: s.candidates,
  one: s.match.one,
  bySubject: s.oneBySubject,
  several: `${s.match.several} / ${s.match.none}`,
  viaList: s.viaList,
  reply: `${mins(s.replyMinutesMedian)} · ${mins(s.replyMinutesP90)}`,
  colleague: s.answeredByColleague,
  texts: `${texts(s)} (${s.wouldText.dispatcherNight})`,
  backups: backups(s),
});
const dayRows = computed(() => (week.value?.days ?? []).map((d) => statRow(d.day, formatDisplayDate(d.day), d.stats, { runs: d.runs })));
const mailboxRows = computed(() => (week.value?.mailboxes ?? []).map((m) => statRow(m.userId, m.name, m.stats)));
type StatRow = ReturnType<typeof statRow> & { runs?: BrokerMailWeek["days"][number]["runs"] };
const statOf = (r: unknown) => r as StatRow;

const sampleColumns: DataTableColumn[] = [
  { key: "receivedAt", label: "Received", card: "meta" },
  { key: "ownerName", label: "Outlook of", card: "meta" },
  { key: "fromAddress", label: "From", card: "title" },
  { key: "subject", label: "Subject" },
  { key: "loadRef", label: "Load" },
  { key: "threadState", label: "360 says", card: "status" },
];
const THREAD_WORDS = { waiting: "Still waiting", answered_by_owner: "Answered", answered_by_colleague: "Answered by a colleague" } as const;
</script>

<template>
  <section aria-labelledby="bm-week" class="space-y-3">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 id="bm-week" class="text-lg font-semibold text-ink">Measure week</h2>
        <p class="text-sm text-ink-muted">
          Seven days of broker mail before anyone is texted: how much of it 360 can tie to a load, and how many texts the settings above would have sent.
        </p>
      </div>
      <AppFormField v-slot="{ id }" label="First day">
        <AppDateField :id="id" v-model="from" />
      </AppFormField>
    </div>

    <QueryState
      :loading="isLoading"
      :error="isError ? error : null"
      :retrying="isFetching"
      loading-text="Counting the week…"
      error-text="Could not count the week."
      @retry="refetch()"
    >
      <template v-if="week">
        <p class="text-sm text-ink-secondary" data-test="week-range">
          {{ formatDisplayDateRange(week.from, week.to) }} · texts replayed with today's settings: dispatcher after {{ week.settings.answerWithinMinutes }} min, backups
          {{ week.settings.backupAfterMinutes }} min later.
        </p>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <!-- ui-adoption: stat-guarded — the whole row waits on the one read above, inside its QueryState. -->
          <StatCard
            label="Tied to one load"
            :value="pct(week.passMarks.matchedOneShare)"
            :value-tone="matchTone"
            :sub="`of ${week.total.candidates} broker emails · pass at ${Math.round(BROKER_MAIL_WEEK_MATCH_PASS * 100)} %`"
          />
          <StatCard label="Dispatcher texts" :value="texts(week.total)" :sub="`${week.total.wouldText.dispatcherNight} of them at night`" />
          <StatCard label="Backup notices" :value="backups(week.total)" :sub="`${week.total.wouldText.backupHeldToMorning} held to the morning`" />
          <StatCard label="First reply" :value="mins(week.total.replyMinutesMedian)" :sub="`median · 90 % within ${mins(week.total.replyMinutesP90)}`" />
        </div>

        <AppCard v-if="!week.runCountsKept" padding="sm" class="text-sm text-ink-muted">
          The reader's own run counts are kept 14 days, so this week shows the emails but not how many runs read them.
        </AppCard>

        <!-- ui-adoption: unpaged — one row per day of a seven-day range. -->
        <DataTable :columns="[...statColumns, { key: 'runs', label: 'Reader runs', align: 'right' }]" :rows="dayRows" :row-key="(r) => statOf(r).key" empty-text="No days.">
          <template #cell-runs="{ row }">
            <span v-if="statOf(row).runs" :class="statOf(row).runs!.errors ? 'text-danger-700' : 'text-ink-secondary'">
              {{ statOf(row).runs!.runs }} / {{ statOf(row).runs!.runsExpected }}<template v-if="statOf(row).runs!.errors"> · {{ statOf(row).runs!.errors }} errors</template>
            </span>
            <span v-else class="text-ink-tertiary">—</span>
          </template>
        </DataTable>

        <h3 class="pt-2 text-sm font-semibold text-ink">By dispatcher</h3>
        <!-- ui-adoption: unpaged — one row per read mailbox, at most the McLeod dispatcher count. -->
        <DataTable :columns="statColumns" :rows="mailboxRows" :row-key="(r) => statOf(r).key" empty-text="No broker email was read in these days." />

        <AppCard padding="sm" class="space-y-1 text-sm">
          <p class="text-ink-secondary">
            Tied to the load of the Outlook's own dispatcher: {{ week.total.oneOwnersLoad }} of {{ week.total.match.one }}. A broker's follow-up that Outlook put in a new
            conversation: {{ week.total.followUpNewConversation }}. Emails with no reference in the subject:
            <template v-if="week.noReferenceDomains.length">{{ week.noReferenceDomains.map((d) => `${d.domain} (${d.emails})`).join(", ") }}.</template>
            <template v-else>none.</template>
          </p>
        </AppCard>

        <h3 class="pt-2 text-sm font-semibold text-ink">Check by hand</h3>
        <p class="text-sm text-ink-muted">
          Open each of these in that person's Outlook and count the ones where 360 is wrong — the load, or whether it was answered. Pass: at most
          {{ Math.round(BROKER_MAIL_WEEK_WRONG_PASS * week.sample.length) || 0 }} of {{ week.sample.length }} wrong. The same emails are listed every time for the same first day.
        </p>
        <!-- ui-adoption: unpaged — a fixed sample of at most 50 rows. -->
        <DataTable :columns="sampleColumns" :rows="week.sample" row-key="id" empty-text="No broker email to check yet.">
          <template #cell-receivedAt="{ value }">{{ formatDisplayDateTime(value as string) }}</template>
          <template #cell-fromAddress="{ value }"><span class="text-ink">{{ value ?? "—" }}</span></template>
          <template #cell-subject="{ value }"><span class="text-ink-secondary">{{ value ?? "—" }}</span></template>
          <template #cell-loadRef="{ value }">{{ value ?? BROKER_MAIL_TAB_LABELS.needs_load }}</template>
          <template #cell-threadState="{ value }">
            <AppBadge :tone="value === 'waiting' ? 'caution' : 'success'">{{ THREAD_WORDS[value as keyof typeof THREAD_WORDS] }}</AppBadge>
          </template>
        </DataTable>
      </template>
    </QueryState>
  </section>
</template>
