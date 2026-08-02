import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { meDriverResponseSchema, type MeDriverResponse } from '@fuelguard/shared';
import { apiFetch } from '@/lib/api';
import { ApiQueryError } from '@/lib/queryClient';

/**
 * The app's bootstrap read (plan §13.2): the signed-in driver's own record + assigned vehicle(s)
 * from `GET /api/me/driver`, parsed with the SHARED contract schema — never cast (D24). One call
 * instead of a launch waterfall (D29), cached under ['me','driver'] and persisted to disk so a
 * cold start in airplane mode still renders.
 */
export const ME_DRIVER_KEY = ['me', 'driver'] as const;

export function useDriverContext(): UseQueryResult<MeDriverResponse, Error> {
  return useQuery({
    queryKey: ME_DRIVER_KEY,
    queryFn: async ({ signal }) => {
      const res = await apiFetch('/api/me/driver', {
        schema: meDriverResponseSchema,
        signal,
      });
      if (!res.ok || !res.data) {
        throw new ApiQueryError(
          res.error?.message ?? 'Could not load your driver profile.',
          res.status,
          res.error?.code,
        );
      }
      return res.data;
    },
  });
}

/** The driver's primary vehicle — the one Home shows and capture will pre-select. */
export function primaryVehicle(data: MeDriverResponse | undefined) {
  return data?.vehicles[0] ?? null;
}

/** "Miki Jokovic" → "Miki" for the greeting. */
export function firstName(fullName: string | undefined | null): string {
  if (!fullName) return 'Driver';
  const first = fullName.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : 'Driver';
}
