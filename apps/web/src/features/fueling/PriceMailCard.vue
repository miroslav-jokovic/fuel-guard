<script setup lang="ts">
/**
 * "Did today's Pilot email load?" — answered in the app (PILOT-PRICE-MAIL-PLAN §6).
 *
 * Since 2026-11-11 Pilot emails the daily quote as a 48-hour link; the API reads the mailbox folder every
 * 20 minutes and loads each quote itself. On 2026-11-18 the owner believed that pull already existed when only
 * the file reader had been fixed, and production's prices were eight days old with nobody able to see it from
 * here. So the drawer that holds the manual upload shows, beside it, what the automatic pull did with each
 * recent email — loaded (and for which day), expired before it could be fetched, or failed and why.
 *
 * Read-only, and under the same `dispatch` gate as the upload (`GET /api/fueling/prices/mail`).
 */
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { AppBadge, AppCard as BaseCard, QueryState } from "@silvicom/ui";
import type { PilotPriceMail, PilotPriceMailsResponse, PilotPriceMailState } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";

const q = useQuery({
  queryKey: ["fueling", "prices", "mail"],
  queryFn: async (): Promise<PilotPriceMail[]> => {
    const res = await apiFetch<PilotPriceMailsResponse>("/api/fueling/prices/mail");
    if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the emailed quotes.");
    return res.data.mails;
  },
  refetchInterval: 300_000,
});

const LABEL: Record<PilotPriceMailState, { text: string; tone: "success" | "neutral" | "danger" | "caution" }> = {
  loaded: { text: "Loaded", tone: "success" },
  expired: { text: "Expired", tone: "caution" },
  failed: { text: "Failed", tone: "danger" },
  no_link: { text: "No link", tone: "danger" },
};

/** The quote's day: its own Effective Date once read, else the date Pilot puts first in the subject. */
function quoteDay(m: PilotPriceMail): string {
  if (m.effective_date) return formatDate(m.effective_date);
  const s = /^(\d{2})-(\d{2})-(\d{4})/.exec(m.subject);
  return s ? formatDate(`${s[3]}-${s[1]}-${s[2]}`) : m.subject;
}

function detail(m: PilotPriceMail): string {
  if (m.state === "loaded") {
    const base = `${(m.prices_loaded ?? 0).toLocaleString()} prices`;
    const waiting = m.geocode_pending ? ` · ${m.geocode_pending} site(s) waiting for a map position` : "";
    return base + waiting + (m.error ? ` · ${m.error}` : "");
  }
  if (m.state === "expired") return "Pilot's link had expired before it could be fetched — download it from Pilot's portal and upload it below.";
  return m.error ?? "";
}

const newestLoaded = computed(() => (q.data.value ?? []).find((m) => m.state === "loaded") ?? null);
</script>

<template>
  <BaseCard>
    <h3 class="text-sm font-semibold text-ink">From Pilot's email</h3>
    <p class="mt-1 text-sm text-ink-muted">
      Pilot emails each day's quote as a link that works for 48 hours. It is loaded automatically within about
      20 minutes of arriving; this is what happened to each recent email.
    </p>
    <div class="mt-3">
      <QueryState
        compact
        :loading="q.isPending.value"
        :error="q.isError.value"
        :retrying="q.isFetching.value"
        loading-text="Loading the emailed quotes…"
        error-text="Could not load the emailed quotes."
        @retry="q.refetch()"
      >
        <p v-if="!q.data.value?.length" class="text-sm text-ink-secondary" data-test="price-mail-empty">
          No Pilot price email has been read yet.
        </p>
        <template v-else>
          <p v-if="newestLoaded" class="text-sm text-ink" data-test="price-mail-newest">
            Newest loaded quote: <strong>{{ quoteDay(newestLoaded) }}</strong>
            <span class="text-ink-tertiary"> · loaded {{ formatDateTime(newestLoaded.last_tried_at) }}</span>
          </p>
          <ul class="mt-2 divide-y divide-edge-subtle text-sm" data-test="price-mail-list">
            <li v-for="m in q.data.value" :key="m.received_at + m.subject" class="flex items-start gap-3 py-2">
              <span class="w-24 shrink-0 font-medium tabular-nums text-ink">{{ quoteDay(m) }}</span>
              <AppBadge :tone="LABEL[m.state].tone" class="shrink-0">{{ LABEL[m.state].text }}</AppBadge>
              <span class="min-w-0 text-ink-secondary">
                {{ detail(m) }}
                <span class="block text-xs text-ink-tertiary">Received {{ formatDateTime(m.received_at) }}</span>
              </span>
            </li>
          </ul>
        </template>
      </QueryState>
    </div>
  </BaseCard>
</template>
