import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { meHazmatLoadsResponseSchema, type MeHazmatLoadsResponse } from '@silvicom/shared';
import { apiFetch } from '@/lib/api';
import { ApiQueryError } from '@/lib/queryClient';

/**
 * The driver's own hazmat capture history — `GET /api/me/hazmat/loads` (hardening plan Phase 3).
 * This list is what makes a verdict re-findable after the driver leaves the screen or relaunches;
 * without it a submitted BOL check simply vanished from the UI. Parsed with the shared contract
 * (D24), cached under ['me','hazmat','loads'] and persisted, so the hub renders offline.
 */
export const ME_HAZMAT_LOADS_KEY = ['me', 'hazmat', 'loads'] as const;

export function useHazmatChecks(enabled = true): UseQueryResult<MeHazmatLoadsResponse, Error> {
  return useQuery({
    queryKey: ME_HAZMAT_LOADS_KEY,
    enabled,
    queryFn: async ({ signal }) => {
      const res = await apiFetch('/api/me/hazmat/loads', {
        schema: meHazmatLoadsResponseSchema,
        signal,
      });
      if (!res.ok || !res.data) {
        throw new ApiQueryError(
          res.error?.message ?? 'Could not load your hazmat checks.',
          res.status,
          res.error?.code,
        );
      }
      return res.data;
    },
  });
}
