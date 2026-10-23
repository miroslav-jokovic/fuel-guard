import { createTtlCache } from "../../lib/ttlCache.js";
import type { SurfaceClaim } from "@silvicom/shared";

/**
 * The cached answer of `surfaceClaimFor` per (org, role, person) — Q-CHAT14 (lib/ttlCache.ts says why).
 *
 * 15 s, the membership check's life (SP7). The Permissions page writes through `writeAccessCell`, which
 * forgets the org's answers in THIS process at once; the other service's copies expire within the 15 s.
 * The session endpoint and `requireSurface` read the same cache, so the sidebar and the route gate
 * never disagree about a screen.
 */
export const SURFACE_CLAIM_CACHE_MS = 15_000;
export const surfaceClaims = createTtlCache<SurfaceClaim>(SURFACE_CLAIM_CACHE_MS);

export const surfaceClaimKey = (orgId: string, role: string, userId: string | null | undefined) =>
  `${orgId}:${role}:${userId ?? ""}`;

/** Forget every cached claim of one org — after any write to its surface access. */
export function forgetSurfaceClaims(orgId: string): void {
  surfaceClaims.forget((k) => k.startsWith(`${orgId}:`));
}
