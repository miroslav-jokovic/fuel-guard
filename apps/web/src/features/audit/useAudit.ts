import { type Ref, toValue } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { AuditLogPage } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

export interface AuditFilters {
  action?: string;
}

/**
 * The Audit log, a page at a time by a stable created_at/id cursor (`GET /api/audit/log`).
 *
 * Through the API since SP4, not PostgREST: the Audit log screen's grant decides who reads, where
 * RLS used to let only the admin and auditor ROLES see a row — and showed anyone else the admin
 * granted the screen an empty table. No total (Q-SET5); the page learns only whether there is more.
 */
export function useAuditQuery(filters: Ref<AuditFilters>, cursor: Ref<string | null>) {
  return useQuery({
    queryKey: ["audit_logs", filters, cursor],
    queryFn: async (): Promise<AuditLogPage> => {
      const f = toValue(filters);
      const after = toValue(cursor);
      const q = new URLSearchParams();
      if (f.action) q.set("action", f.action);
      if (after) q.set("cursor", after);
      const r = await apiFetch<AuditLogPage>(`/api/audit/log?${q}`);
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load the audit log");
      return r.data;
    },
  });
}
