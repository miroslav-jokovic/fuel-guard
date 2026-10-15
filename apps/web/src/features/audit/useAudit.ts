import { type Ref, toValue } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { AuditLogPage } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

export interface AuditFilters {
  action?: string;
}

/** Which page of the log: older than `before`, newer than `after`, or (neither) the newest. */
export interface AuditPosition {
  before?: string;
  after?: string;
}

/**
 * The Audit log, a page at a time by a stable created_at/id cursor (`GET /api/audit/log`).
 *
 * Through the API since SP4, not PostgREST: the Audit log screen's grant decides who reads, where
 * RLS used to let only the admin and auditor ROLES see a row — and showed anyone else the admin
 * granted the screen an empty table. No total (Q-SET5); the page learns whether there is more on
 * either side. The position comes from the page's URL (D-US12), so a pasted link reopens its rows.
 */
export function useAuditQuery(filters: Ref<AuditFilters>, position: Ref<AuditPosition>) {
  return useQuery({
    queryKey: ["audit_logs", filters, position],
    queryFn: async (): Promise<AuditLogPage> => {
      const f = toValue(filters);
      const at = toValue(position);
      const q = new URLSearchParams();
      if (f.action) q.set("action", f.action);
      if (at.before) q.set("before", at.before);
      else if (at.after) q.set("after", at.after);
      const r = await apiFetch<AuditLogPage>(`/api/audit/log?${q}`);
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load the audit log");
      return r.data;
    },
  });
}
