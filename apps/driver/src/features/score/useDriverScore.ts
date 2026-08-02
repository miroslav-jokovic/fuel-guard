import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { meScoreResponseSchema, type MeScoreResponse } from '@fuelguard/shared';
import { apiFetch } from '@/lib/api';
import { ApiQueryError } from '@/lib/queryClient';

/**
 * The driver's own weekly performance (plan Phase 5 / D24). `GET /api/me/score` returns only this
 * driver's frozen weeks — RLS (0084 `dpw_driver_scope`) is the real boundary and the server projects a
 * per-driver view on top — parsed with the SHARED contract, never cast. Cached under ['me','score'] and
 * persisted, so the Score tab renders last week's grade on a cold start with no signal; the same key
 * feeds the Home "This week" tiles, so both read one fetch.
 */
export const ME_SCORE_KEY = ['me', 'score'] as const;

export function useDriverScore(): UseQueryResult<MeScoreResponse, Error> {
  return useQuery({
    queryKey: ME_SCORE_KEY,
    queryFn: async ({ signal }) => {
      const res = await apiFetch('/api/me/score', { schema: meScoreResponseSchema, signal });
      if (!res.ok || !res.data) {
        throw new ApiQueryError(
          res.error?.message ?? 'Could not load your score.',
          res.status,
          res.error?.code,
        );
      }
      return res.data;
    },
  });
}
