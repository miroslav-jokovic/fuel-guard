import { computed, type Ref } from "vue";
import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import type { SevenDayStatement, SevenDayStatementCreate } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * The §395.8(j)(2) seven-day work statement (P7, migration 0236).
 *
 * ⚠ There is no update mutation, and there never will be. 0236 refuses UPDATE of the content for
 * everybody including the service role (SD010): the driver signed this, and a signed statement
 * somebody can edit afterwards is not a statement. A correction is a new statement, and the list
 * comes back newest-first so the current one is the first one.
 */
const key = (driverId: string) => ["roster", "seven-day", driverId] as const;

export function useSevenDayStatementsQuery(driverId: Ref<string>) {
  return useQuery({
    queryKey: computed(() => key(driverId.value)),
    enabled: computed(() => Boolean(driverId.value)),
    queryFn: async (): Promise<SevenDayStatement[]> => {
      const res = await apiFetch<{ statements: SevenDayStatement[] }>(
        `/api/roster/drivers/${driverId.value}/seven-day-statements`,
      );
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the statements.");
      return res.data.statements;
    },
  });
}

export function useRecordSevenDayStatement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SevenDayStatementCreate): Promise<SevenDayStatement> => {
      const res = await apiFetch<{ statement: SevenDayStatement }>(
        `/api/roster/drivers/${input.driver_id}/seven-day-statements`,
        { method: "POST", body: input },
      );
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not record the statement.");
      return res.data.statement;
    },
    onSuccess: (_s, input) => void qc.invalidateQueries({ queryKey: key(input.driver_id) }),
  });
}
