<script setup lang="ts">
/**
 * "Did Pilot's SFTP files come in, and what became of them?" — answered in the app (PILOT-SFTP-FEED-PLAN §6).
 *
 * The API takes every new file from Pilot's SFTP drop every 30 minutes and keeps a copy. A Price Quote loads into
 * the price list; a Transaction file is HELD — kept, untouched — until a reader for Pilot's layout exists, because
 * none had arrived when the feed was built. The email feed's lesson (PriceMailCard) applies twice over here: a pull
 * nobody can see is one nobody can tell has stopped, and a held file must read as a known gap, not as nothing.
 *
 * Read-only, under the same `dispatch` gate as the emailed quotes beside it (`GET /api/fueling/prices/sftp`).
 */
import { useQuery } from "@tanstack/vue-query";
import { AppBadge, AppCard as BaseCard, QueryState } from "@silvicom/ui";
import type { PilotSftpFile, PilotSftpFileKind, PilotSftpFileState, PilotSftpFilesResponse } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";

const q = useQuery({
  queryKey: ["fueling", "prices", "sftp"],
  queryFn: async (): Promise<PilotSftpFile[]> => {
    const res = await apiFetch<PilotSftpFilesResponse>("/api/fueling/prices/sftp");
    if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load Pilot's SFTP files.");
    return res.data.files;
  },
  refetchInterval: 300_000,
});

const KIND: Record<PilotSftpFileKind, string> = { price_quote: "Price quote", transactions: "Transactions", unknown: "Other file" };
const LABEL: Record<PilotSftpFileState, { text: string; tone: "success" | "neutral" | "danger" | "caution" }> = {
  loaded: { text: "Loaded", tone: "success" },
  held: { text: "Kept", tone: "neutral" },
  refused: { text: "Not read", tone: "caution" },
  duplicate: { text: "Duplicate", tone: "neutral" },
  failed: { text: "Failed", tone: "danger" },
};

const fileName = (f: PilotSftpFile) => f.remote_path.slice(f.remote_path.lastIndexOf("/") + 1);

function detail(f: PilotSftpFile): string {
  if (f.state === "loaded") {
    const day = f.effective_date ? ` for ${formatDate(f.effective_date)}` : "";
    return `${(f.rows_loaded ?? 0).toLocaleString()} prices${day}`;
  }
  if (f.state === "held") return "Kept safely. It will be read once the system can read this kind of Pilot file.";
  return f.error ?? "";
}
</script>

<template>
  <BaseCard>
    <h3 class="text-sm font-semibold text-ink">From Pilot's SFTP</h3>
    <p class="mt-1 text-sm text-ink-muted">
      Pilot puts its daily price quote and transaction file on a secure file server. New files are picked up every
      30 minutes and a copy of each is kept; this is what happened to each recent file.
    </p>
    <div class="mt-3">
      <QueryState
        compact
        :loading="q.isPending.value"
        :error="q.isError.value"
        :retrying="q.isFetching.value"
        loading-text="Loading Pilot's SFTP files…"
        error-text="Could not load Pilot's SFTP files."
        @retry="q.refetch()"
      >
        <p v-if="!q.data.value?.length" class="text-sm text-ink-secondary" data-test="sftp-empty">
          No file has come from Pilot's SFTP yet.
        </p>
        <ul v-else class="divide-y divide-edge-subtle text-sm" data-test="sftp-list">
          <li v-for="f in q.data.value" :key="f.remote_path + f.remote_mtime" class="flex items-start gap-3 py-2">
            <span class="w-28 shrink-0 font-medium text-ink">{{ KIND[f.kind] }}</span>
            <AppBadge :tone="LABEL[f.state].tone" class="shrink-0">{{ LABEL[f.state].text }}</AppBadge>
            <span class="min-w-0 text-ink-secondary">
              {{ detail(f) }}
              <span class="block break-all text-xs text-ink-tertiary">{{ fileName(f) }} · Pilot wrote it {{ formatDateTime(f.remote_mtime) }}</span>
            </span>
          </li>
        </ul>
      </QueryState>
    </div>
  </BaseCard>
</template>
