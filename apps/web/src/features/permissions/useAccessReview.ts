import { useQuery } from "@tanstack/vue-query";
import type { AccessReviewState } from "@silvicom/shared";
import { apiDownload, apiFetch } from "@/lib/api";

/**
 * The "Who has access" tab's data (SETTINGS-PERMISSIONS-PLAN.md SP10, Q-SET10).
 *
 * One read of the whole org's layers, resolved in the browser by `whoHasAccess` from shared — the
 * same functions the router guard and the API ask — so picking another screen is a recomputation,
 * not a request. Keyed under `permissions` so every write on the other two tabs, which invalidates
 * that prefix, refreshes this view too: a grant made on People shows up here without a reload.
 */
export const ACCESS_REVIEW_KEY = ["permissions", "access-review"] as const;

export const useAccessReviewQuery = () =>
  useQuery({
    queryKey: ACCESS_REVIEW_KEY,
    queryFn: async () => {
      const res = await apiFetch<AccessReviewState>("/api/access-review");
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load who has access");
      return res.data;
    },
  });

/**
 * The export is rendered AND recorded by the API (`permissions.exported`), never assembled here from
 * the state above: a file built in the browser would leave the audit row describing a document the
 * server never saw. The server names the day on the file's first row, on the carrier's calendar.
 */
export const downloadAccessReview = (): Promise<void> =>
  apiDownload("/api/access-review/export.csv", "access-review.csv");
