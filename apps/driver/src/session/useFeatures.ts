import { useMemo } from 'react';
import {
  FEATURE_CATALOG,
  featureEnabled,
  minAppVersion,
  odometerMode,
  scoreDetailTabEnabled,
  scoreLeaderboardEnabled,
  takeoverAllowed,
  toFeatureMap,
  type FeatureKey,
  type FeatureMap,
  type OdometerMode,
} from '@silvicom/shared';
import { useDriverContext } from './useDriverContext';
import { useSession } from './SessionProvider';

/**
 * What the dev bypass sees. It has no server session, so no bootstrap ever lands and every
 * visibility feature resolved OFF — which is how, on 2026-09-07, a developer's simulator showed
 * two tabs and one card and the owner concluded the app had lost its screens. The bypass now
 * stands in for a bootstrap with every RELEASED feature at its catalog default and no config,
 * which is exactly what `resolveFeatures` answers for an org with no rows and every module.
 * Development builds only; the real session never reads this.
 */
const DEV_BYPASS_FEATURES: FeatureMap = toFeatureMap(
  Object.values(FEATURE_CATALOG)
    .filter((def) => def.released && def.defaultEnabled)
    .map((def) => ({ key: def.key, enabled: true, config: {} })),
);

export interface FeaturesView {
  /** False until the first bootstrap (cached or live) has landed — gate redirects on this so a
   *  loading app never bounces a driver off a screen they are entitled to. */
  isLoaded: boolean;
  features: FeatureMap;
  enabled: (key: FeatureKey) => boolean;
  odometerMode: OdometerMode;
  takeoverAllowed: boolean;
  /** Score TAB visibility. Home's weekly tiles follow `enabled('tab.score')` on its own. */
  scoreDetailTab: boolean;
  /** Home's fleet leaderboard (D-DB18): the org's `tab.score.leaderboard` opt-out, default on. */
  scoreLeaderboard: boolean;
  minAppVersion: string | null;
}

/**
 * The driver-app feature set (hardening plan Phase 4) — the server-resolved output of
 * released × entitled × org config × per-driver override, shipped on the bootstrap and persisted
 * with it. One hook, one question per surface: `enabled('tab.loads')`. Offline = last-known set
 * (stale-while-revalidate); no data at all = visibility features off, behavior configs at their
 * fail-safe catalog defaults (a first boot in a dead zone still has a working duty flow).
 */
export function useFeatures(): FeaturesView {
  const { data } = useDriverContext();
  const { devBypass } = useSession();
  const standIn = __DEV__ && devBypass && data === undefined;
  const features = useMemo(
    () => (standIn ? DEV_BYPASS_FEATURES : toFeatureMap(data?.features)),
    [data?.features, standIn],
  );
  return useMemo(
    () => ({
      isLoaded: data !== undefined || standIn,
      features,
      enabled: (key: FeatureKey) => featureEnabled(features, key),
      odometerMode: odometerMode(features),
      takeoverAllowed: takeoverAllowed(features),
      scoreDetailTab: scoreDetailTabEnabled(features),
      scoreLeaderboard: scoreLeaderboardEnabled(features),
      minAppVersion: minAppVersion(features),
    }),
    [features, data, standIn],
  );
}
