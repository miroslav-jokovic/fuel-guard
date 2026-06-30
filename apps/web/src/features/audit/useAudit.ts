import { type Ref, toValue } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { AuditLog } from "@fleetguard/shared";
import { supabase } from "@/lib/supabase";

export interface AuditFilters {
  action?: string;
}

/** Audit log (RLS limits reads to admin + auditor). */
export function useAuditQuery(filters: Ref<AuditFilters>) {
  return useQuery({
    queryKey: ["audit_logs", filters],
    queryFn: async (): Promise<AuditLog[]> => {
      const f = toValue(filters);
      let q = supabase
        .from("audit_logs")
        .select("id, org_id, actor_id, action, entity, entity_id, meta, created_at")
        .order("created_at", { ascending: false })
        .limit(250);
      if (f.action) q = q.ilike("action", `${f.action}%`);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as AuditLog[];
    },
  });
}
