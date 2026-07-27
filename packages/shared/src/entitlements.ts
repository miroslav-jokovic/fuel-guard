import { z } from "zod";

/**
 * Module entitlements (Phase 5E, decision D55) — which products a tenant has bought.
 *
 * A module is not "done" until it can be switched off for one org without breaking any other surface
 * (D56). This file is the vocabulary that makes that testable: one key per sellable module, one
 * resolver, and a shape the UI, the API and the RLS helper all agree on.
 *
 * **Absent key = disabled.** A tenant is never silently granted something nobody sold them.
 */

export const MODULE_KEYS = [
  "hazmatguard",
  "training",
  "messages",
  "notifications",
  "dispatch",
  "navigation",
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export const MODULE_LABELS: Record<ModuleKey, string> = {
  hazmatguard: "HazmatGuard",
  training: "Safety Training",
  messages: "Messages",
  notifications: "Notifications",
  dispatch: "Dispatch",
  navigation: "Navigation",
};

/**
 * What a tenant gets on day one. Dispatch and Navigation are baseline capability rather than
 * upsells, and seeding them is what stops `0088` from taking Dispatch away from every existing
 * customer the moment it deploys — see the backfill note in that migration.
 */
export const DEFAULT_ENABLED_MODULES: readonly ModuleKey[] = ["dispatch", "navigation"];

export function isModuleKey(value: string): value is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(value);
}

// ── the wire shape ────────────────────────────────────────────────────────────
export const orgModuleSchema = z.object({
  module_key: z.string(),
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()).default({}),
});
export type OrgModule = z.infer<typeof orgModuleSchema>;

export const modulesResponseSchema = z.object({
  modules: z.array(orgModuleSchema),
});
export type ModulesResponse = z.infer<typeof modulesResponseSchema>;

/**
 * The resolved set a client holds. Built once from the response and then asked cheaply, so a render
 * path never does string matching over an array.
 */
export type ModuleSet = ReadonlySet<ModuleKey>;

export function toModuleSet(modules: readonly OrgModule[] | undefined | null): ModuleSet {
  const out = new Set<ModuleKey>();
  for (const m of modules ?? []) {
    if (m.enabled && isModuleKey(m.module_key)) out.add(m.module_key);
  }
  return out;
}

/** The one question every gate asks. Mirrors `auth_module_enabled()` in migration 0088. */
export function moduleEnabled(modules: ModuleSet | undefined | null, key: ModuleKey): boolean {
  return modules?.has(key) ?? false;
}

/**
 * Copy for the moment a driver or a dispatcher reaches a surface their company has not bought.
 * Naming the module and pointing at who can change it beats a blank screen or a raw 403.
 */
export function moduleUnavailableMessage(key: ModuleKey): string {
  return `${MODULE_LABELS[key]} isn't part of your plan. Ask your administrator to enable it.`;
}

// ── platform control-plane writes ─────────────────────────────────────────────
/**
 * Entitlements are a COMMERCIAL fact: set by the platform control plane (`apps/admin-api`), never by
 * an org admin however senior — which is why `0088` grants no in-tenant write policy at all. This is
 * the shape that service uses.
 */
export const setModuleRequestSchema = z.object({
  module_key: z.enum(MODULE_KEYS),
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()).optional(),
});
export type SetModuleRequest = z.infer<typeof setModuleRequestSchema>;
