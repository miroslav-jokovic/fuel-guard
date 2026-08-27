import { useMemo } from 'react';
import { moduleEnabled, toModuleSet, type ModuleKey, type ModuleSet } from '@silvicom/shared';
import { useDriverContext } from './useDriverContext';

/**
 * The tenant's module entitlements, resolved from the bootstrap payload (D55). One hook, one
 * question — screens ask `has('hazmatguard')`, never string-match the raw array. Rides the
 * persisted ['me','driver'] cache, so entitlement gates render correctly on a cold start offline
 * (stale-while-revalidate: last-known set until the next successful bootstrap).
 *
 * Absent data = nothing enabled: while the very first bootstrap is in flight a surface stays
 * hidden rather than flashing an entry that 403s. RLS + `requireModule` remain the real boundary —
 * this is the navigation mirror of it.
 */
export function useModules(): { modules: ModuleSet; has: (key: ModuleKey) => boolean } {
  const { data } = useDriverContext();
  const modules = useMemo(() => toModuleSet(data?.modules), [data?.modules]);
  return useMemo(() => ({ modules, has: (key: ModuleKey) => moduleEnabled(modules, key) }), [modules]);
}
