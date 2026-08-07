import { useMemo } from 'react';
import {
  featureEnabled,
  minAppVersion,
  odometerMode,
  takeoverAllowed,
  toFeatureMap,
  type FeatureKey,
  type FeatureMap,
  type OdometerMode,
} from '@fuelguard/shared';
import { useDriverContext } from './useDriverContext';

export interface FeaturesView {
  /** False until the first bootstrap (cached or live) has landed — gate redirects on this so a
   *  loading app never bounces a driver off a screen they are entitled to. */
  isLoaded: boolean;
  features: FeatureMap;
  enabled: (key: FeatureKey) => boolean;
  odometerMode: OdometerMode;
  takeoverAllowed: boolean;
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
  const features = useMemo(() => toFeatureMap(data?.features), [data?.features]);
  return useMemo(
    () => ({
      isLoaded: data !== undefined,
      features,
      enabled: (key: FeatureKey) => featureEnabled(features, key),
      odometerMode: odometerMode(features),
      takeoverAllowed: takeoverAllowed(features),
      minAppVersion: minAppVersion(features),
    }),
    [features, data],
  );
}
