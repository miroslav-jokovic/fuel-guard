import { type Ref, toValue } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { AuditLog } from "@silvicom/shared";
import { supabase } from "@/lib/supabase";

export interface AuditFilters {
  action?: string;
}

export interface AuditPage {
  rows: AuditLog[];
  total: number;
  hasNext: boolean;
  nextCursor: string | null;
}

const PAGE_SIZE = 50;

/** Audit log (RLS limits reads to admin + auditor), paged by stable created_at/id cursor. */
export function useAuditQuery(filters: Ref<AuditFilters>, cursor: Ref<string | null>) {
  return useQuery({
    queryKey: ["audit_logs", filters, cursor],
    queryFn: async (): Promise<AuditPage> => {
      const f = toValue(filters);
      const after = toValue(cursor);
      let q = supabase
        .from("audit_logs")
        .select("id, org_id, actor_id, action, entity, entity_id, meta, created_at", { count: "exact" })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(PAGE_SIZE + 1);
      if (f.action) q = q.ilike("action", `${f.action}%`);
      if (after) {
        const [createdAt, id] = after.split("|");
        if (createdAt && id) q = q.or(`created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`);
      }
      const { data, error, count } = await q;
      if (error) throw new Error(error.message);
      const batch = (data ?? []) as AuditLog[];
      const hasNext = batch.length > PAGE_SIZE;
      const rows = hasNext ? batch.slice(0, PAGE_SIZE) : batch;
      const last = rows.at(-1);
      return {
        rows,
        total: count ?? rows.length,
        hasNext,
        nextCursor: hasNext && last ? `${last.created_at}|${last.id}` : null,
      };
    },
  });
}
