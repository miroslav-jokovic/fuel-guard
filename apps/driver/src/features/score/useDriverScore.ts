import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
  meScoreLeaderboardResponseSchema,
  meScoreResponseSchema,
  type MeScoreLeaderboardResponse,
  type MeScoreResponse,
} from '@silvicom/shared';
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

export function useDriverScore(enabled = true): UseQueryResult<MeScoreResponse, Error> {
  return useQuery({
    queryKey: ME_SCORE_KEY,
    enabled,
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

export const ME_LEADERBOARD_KEY = ['me', 'score', 'leaderboard'] as const;

/**
 * The fleet leaderboard for Home (D-DB18): the latest ranked week's top five by first name plus
 * the viewer. Off when the org's `tab.score.leaderboard` says so — the API answers 404 then, and the
 * caller never asks, because `useFeatures().scoreLeaderboard` reads the same config.
 */
export function useLeaderboard(enabled = true): UseQueryResult<MeScoreLeaderboardResponse, Error> {
  return useQuery({
    queryKey: ME_LEADERBOARD_KEY,
    enabled,
    queryFn: async ({ signal }) => {
      const res = await apiFetch('/api/me/score/leaderboard', { schema: meScoreLeaderboardResponseSchema, signal });
      if (!res.ok || !res.data) {
        throw new ApiQueryError(
          res.error?.message ?? 'Could not load the leaderboard.',
          res.status,
          res.error?.code,
        );
      }
      return res.data;
    },
  });
}
