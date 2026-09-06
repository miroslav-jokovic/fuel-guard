import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import { computed, type Ref } from "vue";
import type {
  AppSection,
  OrgMember,
  SectionAccess,
  SectionClaim,
  SectionOverrides,
  SurfaceClaim,
  SurfaceOverrides,
  UserRole,
} from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * The permissions page's data layer (S6).
 *
 * ── EVERY READ BRINGS ITS OWN YARDSTICK ─────────────────────────────────────────────────────────
 * Each endpoint answers with the overrides AND the matrix or catalogue they are read against
 * (D-PERM4, D-SURF3), so nothing here reconstructs a default. That is not politeness: a browser
 * holding its own copy of `SECTION_ACCESS` is the copy that goes stale, because it ships in a
 * cached bundle and can be months behind the API that enforces the real answer.
 *
 * ── WRITES GO THROUGH THE API, NEVER POSTGREST ─────────────────────────────────────────────────
 * All four permission tables have a SELECT policy and no write policy at all, so a direct write
 * would fail — deliberately. Changing what someone may reach is the act most worth being able to
 * reconstruct, and the API is where the audit row is written.
 */

/** One screen an org may answer for, as `GET /api/surface-access` describes it. */
export interface SurfaceCatalogueEntry {
  key: string;
  label: string;
  group: string;
  /** Always present in practice — only a section-gated screen is offered (Q-SURF3). */
  section: AppSection | null;
  level: SectionAccess | null;
}

export interface RoleSectionAccess {
  overrides: SectionOverrides;
  defaults: Record<string, Record<string, SectionAccess>>;
  editableRoles: UserRole[];
  editableSections: AppSection[];
}

export interface RoleSurfaceAccess {
  overrides: SurfaceOverrides;
  surfaces: SurfaceCatalogueEntry[];
  editableRoles: UserRole[];
}

export interface MemberSectionAccess {
  userId: string;
  role: UserRole;
  /** This member's ROLE's row of the shipped matrix — the only row their fallback comes from. */
  shipped: Record<string, SectionAccess>;
  roleOverrides: SectionClaim;
  userOverrides: SectionClaim;
  editableSections: AppSection[];
}

export interface MemberSurfaceAccess {
  userId: string;
  role: UserRole;
  roleOverrides: SurfaceClaim;
  userOverrides: SurfaceClaim;
  surfaces: SurfaceCatalogueEntry[];
}

const KEYS = {
  sections: ["permissions", "sections"] as const,
  surfaces: ["permissions", "surfaces"] as const,
  members: ["permissions", "members"] as const,
  memberSections: (id: string | null) => ["permissions", "member-sections", id] as const,
  memberSurfaces: (id: string | null) => ["permissions", "member-surfaces", id] as const,
};

async function get<T>(path: string): Promise<T> {
  const res = await apiFetch<T>(path);
  if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load permissions");
  return res.data;
}

/** ⚠ `apiFetch` serialises the body itself — never `JSON.stringify` into it. */
async function put(path: string, body: object): Promise<void> {
  const res = await apiFetch(path, { method: "PUT", body });
  if (!res.ok) throw new Error(res.error?.message ?? "Could not save that change");
}

export const useSectionAccessQuery = () =>
  useQuery({ queryKey: KEYS.sections, queryFn: () => get<RoleSectionAccess>("/api/section-access") });

export const useSurfaceAccessQuery = () =>
  useQuery({ queryKey: KEYS.surfaces, queryFn: () => get<RoleSurfaceAccess>("/api/surface-access") });

export const useMembersQuery = () =>
  useQuery({
    queryKey: KEYS.members,
    queryFn: async () => (await get<{ members: OrgMember[] }>("/api/members")).members,
  });

/**
 * One member's layers, both halves.
 *
 * Disabled until somebody is selected rather than fetched speculatively: the People tab opens with
 * no member chosen, and an org can have hundreds.
 */
export function useMemberSectionAccessQuery(userId: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => KEYS.memberSections(userId.value)),
    queryFn: () => get<MemberSectionAccess>(`/api/section-access/user/${userId.value}`),
    enabled: computed(() => userId.value !== null),
  });
}

export function useMemberSurfaceAccessQuery(userId: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => KEYS.memberSurfaces(userId.value)),
    queryFn: () => get<MemberSurfaceAccess>(`/api/surface-access/user/${userId.value}`),
    enabled: computed(() => userId.value !== null),
  });
}

/**
 * ── THE FOUR WRITES, AND WHY TWO OF THEM TAKE A THIRD VALUE ─────────────────────────────────────
 * At the ROLE layer a reset is expressible as a value: writing a section cell back to its shipped
 * access, or a screen back to `allowed: true`, is what asks the API to delete the row (D-PERM4,
 * D-SURF6). At the USER layer there is no default to compare against — a person's fallback is
 * whatever their role resolves to, which an admin can change afterwards — so "inherit" is a THIRD
 * value, `null`, and it is stored as the absence of a row. The controls above must offer it as its
 * own option; a two-state control at this layer cannot express what the API takes.
 */
export function useSetRoleSection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { role: UserRole; section: AppSection; access: SectionAccess }) =>
      put("/api/section-access", v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["permissions"] }),
  });
}

export function useSetRoleSurface() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { role: UserRole; surfaceKey: string; allowed: boolean }) =>
      put("/api/surface-access", v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["permissions"] }),
  });
}

export function useSetMemberSection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { userId: string; section: AppSection; access: SectionAccess | null }) =>
      put("/api/section-access/user", v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["permissions"] }),
  });
}

export function useSetMemberSurface() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { userId: string; surfaceKey: string; allowed: boolean | null }) =>
      put("/api/surface-access/user", v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["permissions"] }),
  });
}
