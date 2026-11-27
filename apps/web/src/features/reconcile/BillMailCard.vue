<script setup lang="ts">
/**
 * "Did this week's Pilot bill arrive?" — answered in the app (PILOT-INVOICE-FORMAT-ANALYSIS-2026-11-24 §4).
 *
 * The API reads miki@'s `Pilot-Bills` folder every hour and records each weekly bill PDF itself, then checks it
 * against our fills, exactly as the "Check an invoice" upload does. This card says what happened to each recent
 * email: recorded (and which week), a duplicate of a bill already recorded, refused and why, or no PDF. It is the
 * price feed's lesson (PriceMailCard): a pull nobody can see working is one nobody can tell has stopped.
 *
 * Read-only, under the fuel section's view gate (`GET /api/fueling/statements/mail`).
 */
import { useQuery } from "@tanstack/vue-query";
import { AppBadge, AppCard as BaseCard, QueryState } from "@silvicom/ui";
import { apiFetch } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";

type BillMailState = "recorded" | "duplicate" | "refused" | "failed" | "no_pdf";
interface BillMail {
  subject: string;
  received_at: string;
  state: BillMailState;
  attempts: number;
  file_name: string | null;
  invoice_no: string | null;
  period_start: string | null;
  period_end: string | null;
  statement_id: string | null;
  error: string | null;
  last_tried_at: string;
}

const q = useQuery({
  queryKey: ["fuel_statements", "mail"],
  queryFn: async (): Promise<BillMail[]> => {
    const res = await apiFetch<{ mails: BillMail[] }>("/api/fueling/statements/mail");
    if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the emailed bills.");
    return res.data.mails;
  },
  refetchInterval: 300_000,
});

const LABEL: Record<BillMailState, { text: string; tone: "success" | "neutral" | "danger" | "caution" }> = {
  recorded: { text: "Recorded", tone: "success" },
  duplicate: { text: "Already in", tone: "neutral" },
  refused: { text: "Refused", tone: "danger" },
  failed: { text: "Retrying", tone: "caution" },
  no_pdf: { text: "No PDF", tone: "caution" },
};

function what(m: BillMail): string {
  if (m.state === "recorded" || m.state === "duplicate") {
    const week = m.period_start && m.period_end ? ` · ${formatDate(m.period_start)} – ${formatDate(m.period_end)}` : "";
    return `Invoice ${m.invoice_no ?? "—"}${week}`;
  }
  return m.file_name ?? m.subject;
}
</script>

<template>
  <BaseCard>
    <h3 class="text-sm font-semibold text-ink">From Pilot's email</h3>
    <p class="mt-1 text-sm text-ink-muted">
      Weekly bills moved to the Pilot-Bills folder are recorded and checked automatically within about an hour of
      arriving. This is what happened to each recent email.
    </p>
    <div class="mt-3">
      <QueryState
        compact
        :loading="q.isPending.value"
        :error="q.isError.value"
        :retrying="q.isFetching.value"
        loading-text="Loading the emailed bills…"
        error-text="Could not load the emailed bills."
        @retry="q.refetch()"
      >
        <p v-if="!q.data.value?.length" class="text-sm text-ink-secondary" data-test="bill-mail-empty">
          No Pilot bill email has been read yet.
        </p>
        <ul v-else class="divide-y divide-edge-subtle text-sm" data-test="bill-mail-list">
          <li v-for="m in q.data.value" :key="m.received_at + m.subject" class="flex items-start gap-3 py-2">
            <AppBadge :tone="LABEL[m.state].tone" class="w-24 shrink-0 justify-center">{{ LABEL[m.state].text }}</AppBadge>
            <span class="min-w-0 text-ink-secondary">
              <span class="block font-medium text-ink">{{ what(m) }}</span>
              <span v-if="m.error" class="block">{{ m.error }}</span>
              <span class="block text-xs text-ink-tertiary">Received {{ formatDateTime(m.received_at) }}</span>
            </span>
          </li>
        </ul>
      </QueryState>
    </div>
  </BaseCard>
</template>
