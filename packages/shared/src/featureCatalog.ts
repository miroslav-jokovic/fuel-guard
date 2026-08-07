import { z } from "zod";
import type { ModuleKey, ModuleSet } from "./entitlements.js";

/**
 * Driver-app feature catalog (hardening plan Phase 4, decisions D-PM1..D-PM8) — the single
 * vocabulary for the Samsara-style control plane. Three layers, strictly ordered:
 *
 *   1. ENTITLEMENT  (org_modules, 0088)      — what the tenant bought. Platform-owned.
 *   2. ORG FEATURE  (driver_app_features)    — what this org's drivers see + how it behaves.
 *   3. OVERRIDE     (…_feature_overrides)    — per-driver exception (pilots), narrows only.
 *
 * `resolveFeatures` below is the ONE resolution rule, pure and unit-tested; the API calls it and
 * ships the app a resolved set on the bootstrap — the app never re-derives policy.
 *
 * Governance (D-PM8): catalog features are LONG-LIVED switches with an owner and a `released`
 * axis — never auto-expired, never ad-hoc. Dev experiments stay behind __DEV__, not in here.
 * The key lists in migration 0134's check constraints mirror FEATURE_KEYS — extend both together.
 *
 * FAIL-SAFE RULE: core surfaces (Home, Duty flow, Settings, the sync spine) are NOT features and
 * can never be remote-disabled — a config mistake must not brick a driver's day. `duty.odometer`
 * and `duty.takeover` configure behavior WITHIN the duty flow; they cannot remove it.
 */

export const FEATURE_KEYS = [
  "tab.loads",
  "tab.score",
  "hazmat.capture",
  "messages",
  "notifications",
  "duty.odometer",
  "duty.takeover",
  "nav.preview",
  "training",
  "core.app",
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export function isFeatureKey(value: string): value is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(value);
}

export const odometerModeSchema = z.enum(["off", "optional", "required"]);
export type OdometerMode = z.infer<typeof odometerModeSchema>;

/** Per-feature config schemas — validated at the API door before a dashboard write is stored. */
export const featureConfigSchemas = {
  "duty.odometer": z.object({ mode: odometerModeSchema.default("optional") }),
  /** Kill-switch/ops config (4.6): app versions below minVersion get the blocking update screen. */
  "core.app": z.object({ minVersion: z.string().nullable().default(null) }),
  /**
   * D-PM7 org governance: null = every category the catalog knows; a non-empty list pins the
   * fleet-active categories (drivers then narrow within via their own mutes). Enforced
   * server-side in `notify()` before emission — a device setting cannot be trusted.
   */
  notifications: z.object({ categories: z.array(z.string()).nullable().default(null) }),
} as const;

export interface FeatureDef {
  key: FeatureKey;
  /** Owning module, or 'core' for features every tenant has without buying anything. */
  module: ModuleKey | "core";
  /** Applies when the org has no row — for every released feature this preserves today's behavior. */
  defaultEnabled: boolean;
  /**
   * D-PM5: an unreleased feature exists in the vocabulary but resolves OFF for everyone and the
   * dashboard renders no toggle — no inert switches teaching admins the settings page lies.
   */
  released: boolean;
  label: string;
  description: string;
}

export const FEATURE_CATALOG: Record<FeatureKey, FeatureDef> = {
  "tab.loads": {
    key: "tab.loads",
    module: "dispatch",
    defaultEnabled: true,
    released: true,
    label: "Loads",
    description:
      "The Loads tab, load routes and Home's assignment sections. Hide org-wide while your loads process isn't ready (D-PM1) — they disappear together, never half-off.",
  },
  "tab.score": {
    key: "tab.score",
    module: "core",
    defaultEnabled: true,
    released: true,
    label: "Driver score",
    description:
      "The Score tab and Home's weekly tiles. Score visibility is fleet culture (D-PM3); hiding it hides both surfaces together.",
  },
  "hazmat.capture": {
    key: "hazmat.capture",
    module: "hazmatguard",
    defaultEnabled: true,
    released: true,
    label: "Hazmat checks",
    description: "BOL capture and compliance verdicts in the driver app (standalone hub, and the load-flow step once Loads ships).",
  },
  messages: {
    key: "messages",
    module: "messages",
    defaultEnabled: true,
    released: true, // Phase 7 shipped: driver inbox/thread + web dispatch inbox
    label: "Messages",
    description: "Dispatch ↔ driver messaging — driver inbox in the app, dispatch inbox on the dashboard.",
  },
  notifications: {
    key: "notifications",
    module: "notifications",
    defaultEnabled: true,
    released: true, // Phase 6 shipped: centre + bell + push delivery + producers
    label: "Notifications",
    description: "Push notifications, the in-app centre and the bell on Home. Config pins the org-enabled categories (D-PM7).",
  },
  "duty.odometer": {
    key: "duty.odometer",
    module: "core",
    defaultEnabled: true,
    released: true,
    label: "Odometer at check-in",
    description:
      "off / optional / required (D-PM2). Recommended: required for fleets without telematics; optional or off where the Samsara feed already supplies authoritative readings.",
  },
  "duty.takeover": {
    key: "duty.takeover",
    module: "core",
    defaultEnabled: true,
    released: true,
    label: "Equipment take-over",
    description: "Allow a driver to take over an in-use unit (with the who-holds-it confirmation). Off = dispatch reassigns instead.",
  },
  "nav.preview": {
    key: "nav.preview",
    module: "navigation",
    defaultEnabled: false,
    released: false, // the navigation programme flips this (D52 / D-PM5)
    label: "Navigation",
    description: "Truck-safe route with planned fuel stops.",
  },
  training: {
    key: "training",
    module: "training",
    defaultEnabled: true,
    released: false, // plan Phase 7 (micro-LMS)
    label: "Safety training",
    description: "Courses and quizzes under More.",
  },
  "core.app": {
    key: "core.app",
    module: "core",
    defaultEnabled: true,
    released: true,
    label: "App policy",
    description: "Operational app policy — minimum supported version (update-required gate). Not a visibility toggle.",
  },
};

// ── wire shapes ───────────────────────────────────────────────────────────────
/** One resolved feature as the bootstrap ships it. Unknown keys are dropped by the resolver, so an
 *  older app never sees a key it can't handle (forward-compatible by construction). */
export const featureStateSchema = z.object({
  key: z.string(),
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()).default({}),
});
export type FeatureState = z.infer<typeof featureStateSchema>;

/** An org's stored row (dashboard-owned) as the resolver consumes it. */
export interface OrgFeatureRow {
  feature_key: string;
  enabled: boolean;
  config: Record<string, unknown>;
}
/** A per-driver override row (narrows only — see resolveFeatures). */
export interface FeatureOverrideRow {
  feature_key: string;
  enabled: boolean;
}

/**
 * THE resolution rule (one place, pure):
 *   effective = released AND entitled(module) AND orgEnabled(default if no row) AND override(default true)
 * Config merges org config over catalog defaults; overrides carry no config (an exception changes
 * access, not behavior). `core.app` is special-cased ON — the ops policy channel cannot be
 * switched off by a row, only its config changes.
 */
export function resolveFeatures(
  modules: ModuleSet,
  orgRows: readonly OrgFeatureRow[],
  overrideRows: readonly FeatureOverrideRow[],
): FeatureState[] {
  const org = new Map(orgRows.filter((r) => isFeatureKey(r.feature_key)).map((r) => [r.feature_key as FeatureKey, r]));
  const over = new Map(
    overrideRows.filter((r) => isFeatureKey(r.feature_key)).map((r) => [r.feature_key as FeatureKey, r]),
  );

  return FEATURE_KEYS.map((key) => {
    const def = FEATURE_CATALOG[key];
    const orgRow = org.get(key);
    const config = { ...defaultConfig(key), ...(orgRow?.config ?? {}) };

    if (key === "core.app") return { key, enabled: true, config };

    const entitled = def.module === "core" ? true : modules.has(def.module);
    const orgEnabled = orgRow ? orgRow.enabled : def.defaultEnabled;
    const overridden = over.get(key)?.enabled;
    const enabled = def.released && entitled && orgEnabled && (overridden ?? true);
    return { key, enabled, config };
  });
}

function defaultConfig(key: FeatureKey): Record<string, unknown> {
  const schema = (featureConfigSchemas as Partial<Record<FeatureKey, z.ZodTypeAny>>)[key];
  return schema ? (schema.parse({}) as Record<string, unknown>) : {};
}

// ── the client-side view (mirrors entitlements.ts's ModuleSet pattern) ────────
export type FeatureMap = ReadonlyMap<FeatureKey, FeatureState>;

export function toFeatureMap(features: readonly FeatureState[] | undefined | null): FeatureMap {
  const out = new Map<FeatureKey, FeatureState>();
  for (const f of features ?? []) {
    if (isFeatureKey(f.key)) out.set(f.key, f);
  }
  return out;
}

/** The one question every surface asks. Absent = disabled (never a silent grant)… */
export function featureEnabled(features: FeatureMap | undefined | null, key: FeatureKey): boolean {
  return features?.get(key)?.enabled ?? false;
}

/** …EXCEPT behavior-config features consumed inside core surfaces, which fall back to catalog
 *  defaults so a first-boot-offline app still has a sane duty flow. */
export function odometerMode(features: FeatureMap | undefined | null): OdometerMode {
  const raw = features?.get("duty.odometer");
  if (!raw) return "optional";
  if (!raw.enabled) return "off";
  const parsed = featureConfigSchemas["duty.odometer"].safeParse(raw.config);
  return parsed.success ? parsed.data.mode : "optional";
}

export function takeoverAllowed(features: FeatureMap | undefined | null): boolean {
  // No data yet (first boot) → allow, matching today's behavior; an explicit org row turns it off.
  const raw = features?.get("duty.takeover");
  return raw ? raw.enabled : true;
}

/** `core.app` minVersion, or null when unset. */
export function minAppVersion(features: FeatureMap | undefined | null): string | null {
  const raw = features?.get("core.app");
  if (!raw) return null;
  const parsed = featureConfigSchemas["core.app"].safeParse(raw.config);
  return parsed.success ? parsed.data.minVersion : null;
}

/**
 * Dotted-numeric version compare for the update gate (4.6): true when `current` sorts below
 * `min`. Non-numeric segments compare as 0; a malformed CURRENT fails open (never lock a driver
 * out on a parse bug), a malformed/absent MIN also fails open.
 */
export function isVersionBelow(current: string | null | undefined, min: string | null | undefined): boolean {
  if (!current || !min) return false;
  const WELL_FORMED = /^\d+(\.\d+)*$/;
  if (!WELL_FORMED.test(current.trim()) || !WELL_FORMED.test(min.trim())) return false;
  const parse = (v: string): number[] => v.trim().split(".").map((s) => Number.parseInt(s, 10) || 0);
  const a = parse(current);
  const b = parse(min);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

// ── dashboard control-plane wire shapes (hardening plan Phase 5) ──────────────
/** PUT /api/driver-app/settings/:featureKey — the org admin's write (D-PM6: fleet manage). */
export const setDriverAppFeatureRequestSchema = z.object({
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()).optional(),
});
export type SetDriverAppFeatureRequest = z.infer<typeof setDriverAppFeatureRequestSchema>;

/** PUT /api/driver-app/drivers/:driverId/overrides/:featureKey (D-PM6: dispatch manage). */
export const setDriverAppOverrideRequestSchema = z.object({
  enabled: z.boolean(),
  /** Why this driver differs — surfaced next to the toggle; "hazmat pilot" beats a mystery. */
  note: z.string().max(200).nullable().optional(),
});
export type SetDriverAppOverrideRequest = z.infer<typeof setDriverAppOverrideRequestSchema>;

export interface DriverAppOverrideRow {
  driver_id: string;
  feature_key: string;
  enabled: boolean;
  note: string | null;
  updated_at: string;
}

/**
 * Validate a feature's config against its catalog schema BEFORE it is stored (the API door).
 * Keys with a declared schema parse strictly (defaults applied); keys without one accept only an
 * empty object — config nobody reads must not accumulate in the table.
 */
export function validateFeatureConfig(
  key: FeatureKey,
  config: Record<string, unknown> | undefined,
): { ok: true; config: Record<string, unknown> } | { ok: false; error: string } {
  const schema = (featureConfigSchemas as Partial<Record<FeatureKey, z.ZodTypeAny>>)[key];
  if (!schema) {
    if (config && Object.keys(config).length > 0) {
      return { ok: false, error: `"${key}" takes no config.` };
    }
    return { ok: true, config: {} };
  }
  const parsed = schema.safeParse(config ?? {});
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid config." };
  return { ok: true, config: parsed.data as Record<string, unknown> };
}
