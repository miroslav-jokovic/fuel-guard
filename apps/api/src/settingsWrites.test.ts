import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { ROUTE_FUEL_SETTINGS_DEFAULTS, type UserRole } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "./testing/supabaseRecorder.js";
import { closeTestServer } from "./testing/httpServer.js";

/**
 * The five Settings saves, as permissions (SETTINGS-PERMISSIONS-PLAN.md SP2).
 *
 * Until SP2 every one of them was an ADMIN test — two in RLS, three in `requireSection("admin")` —
 * so a screen the admin granted on the Permissions page opened for its holder and then refused
 * their save. Each now asks what its screen asks: the section, then the screen. The cases below
 * are the four that tell those gates apart, per endpoint:
 *
 *  · the admin saves (nobody can take a screen from the admin);
 *  · a role holding the section, with nothing granted, is refused — the screen starts off (Q-SET2);
 *  · the same role, granted the screen by the org, saves — the grant is the one the save obeys;
 *  · a role NOT holding the section is refused even when granted (D-SURF2: a screen only narrows).
 *
 * Only `requireAuth` is replaced (the caller comes from two headers); `requireOrg`, `requireSection`
 * and `requireSurface` are the shipped middleware, reached through the routers `app.ts` mounts — so
 * a router-level gate in front of an endpoint would show up here as well.
 */
const ORG = "org-1";
const USER = "00000000-0000-4000-8000-000000000031";

let rec: SupabaseRecorder;
/** `role → surface key → allowed`, as `org_role_surface_access` would hold it. */
let grants: Record<string, Record<string, boolean>> = {};

vi.mock("./lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("./lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
vi.mock("./lib/audit.js", () => ({ writeAudit: vi.fn(async () => true) }));
vi.mock("./middleware/auth.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./middleware/auth.js")>();
  return {
    ...real,
    requireAuth: (req: Request, _res: Response, next: NextFunction) => {
      req.auth = {
        userId: USER,
        orgId: ORG,
        role: req.header("x-role") as UserRole,
        email: "tester@example.test",
        sections: null,
      } as never;
      next();
    },
  };
});

const { orgSettingsRouter } = await import("./modules/org/index.js");
const { anomaliesRouter } = await import("./modules/anomalies/index.js");
const { integrationsRouter } = await import("./routes/integrations.js");
const { fuelingRouter } = await import("./routes/fueling.js");

beforeEach(() => {
  grants = {};
  rec = createSupabaseRecorder({
    tables: {
      // Function fixtures: the recorder does not filter, and the claim is read per role.
      org_role_surface_access: (q) => {
        const role = q.filters().find((f) => f.col === "role")?.val as string;
        return Object.entries(grants[role] ?? {}).map(([surface_key, allowed]) => ({ role, surface_key, allowed }));
      },
      user_surface_access: [],
      organizations: [],
      anomaly_thresholds: [],
      driver_performance_settings: [],
      fuel_discount_rules: [],
      route_fuel_settings: [],
    },
  });
});

/** The refusal's `error.code`, so a test can say WHICH gate refused — `forbidden` is the section's. */
let lastCode: string | undefined;

async function call(role: UserRole, method: string, path: string, body: unknown): Promise<number> {
  const app = express();
  app.use(express.json());
  app.use("/api/org-settings", orgSettingsRouter());
  app.use("/api/anomalies", anomaliesRouter());
  app.use("/api/integrations", integrationsRouter());
  app.use("/api/fueling", fuelingRouter());
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, {
      method,
      headers: { "content-type": "application/json", "x-role": role },
      body: JSON.stringify(body),
    });
    lastCode = res.ok ? undefined : ((await res.json()) as { error?: { code?: string } }).error?.code;
    return res.status;
  } finally {
    await closeTestServer(server);
  }
}

const PROFILE = { name: "Silvicom Inc", dot_number: "1234567", address_line1: "1 Main St", city: "Joliet", state: "IL", postal_code: "60431", operating_hours: { start: "05:00", end: "20:00", tz: "America/Chicago" } };
const THRESHOLDS = {
  mpg_drop_pct: 15, capacity_tolerance_pct: 5, rapid_refuel_hours: 4, max_plausible_mph: 75,
  cost_min_per_gal: null, cost_max_per_gal: null, disabled_rules: [], ai_verification_enabled: false, ai_monthly_token_budget: null,
};
const PERFORMANCE = {
  weight_safety: 50, weight_efficiency: 25, weight_idling: 25, normalization_method: "percentile",
  min_cohort_for_percentile: 5, min_distance_mi: 500, min_drive_hours: 10, reward_top_n: 3, trailing_weeks: 3,
  idle_score_basis: "intensity", settle_hours: 48, efficiency_enabled: true, week_starts_on: 1,
};
const NOTIFICATIONS = { notifications_enabled: true, notification_emails: ["ops@silvicom.test"] };

/** [what, method, path, body, the table it writes, the screen, a role holding its section, one that does not]. */
const SAVES: Array<[string, string, string, unknown, string, string, UserRole, UserRole]> = [
  ["Organization", "PUT", "/api/org-settings/profile", PROFILE, "organizations", "admin.settings.org", "fleet_manager", "dispatcher"],
  ["Notifications", "PUT", "/api/org-settings/notifications", NOTIFICATIONS, "organizations", "admin.settings.notifications", "fleet_manager", "dispatcher"],
  ["Anomaly thresholds", "POST", "/api/anomalies/thresholds", THRESHOLDS, "anomaly_thresholds", "admin.settings.thresholds", "fleet_manager", "dispatcher"],
  ["Driver performance", "POST", "/api/integrations/driver-performance/settings", PERFORMANCE, "driver_performance_settings", "admin.settings.driver-performance", "fleet_manager", "technician"],
  ["Planned fueling", "PUT", "/api/fueling/settings", ROUTE_FUEL_SETTINGS_DEFAULTS, "route_fuel_settings", "admin.settings.fuel-planning", "dispatcher", "technician"],
  ["Discount rules", "POST", "/api/fueling/discount-rules", { rules: [{ brand: "pilot", type: "flat", cents_off: 5 }] }, "fuel_discount_rules", "admin.settings.fuel-planning", "dispatcher", "technician"],
];

describe("each Settings save obeys its screen's permission (SP2)", () => {
  for (const [what, method, path, body, table, key, holder, outsider] of SAVES) {
    describe(what, () => {
      it("saves for the admin, scoped to the caller's own org", async () => {
        expect(await call("admin", method, path, body)).toBe(200);
        expect(rec.forTable(table).some((q) => q.write)).toBe(true);
        expectOrgScoped(rec, ORG);
      });

      it(`refuses a ${holder} nobody has turned it on for — it starts off (Q-SET2)`, async () => {
        expect(await call(holder, method, path, body)).toBe(403);
        expect(rec.forTable(table).some((q) => q.write)).toBe(false);
      });

      it(`saves for a ${holder} once the org turns the screen on for the role`, async () => {
        grants = { [holder]: { [key]: true } };
        expect(await call(holder, method, path, body)).toBe(200);
        expect(rec.forTable(table).some((q) => q.write)).toBe(true);
      });

      it(`refuses a ${outsider} even when granted, because they do not hold the section (D-SURF2)`, async () => {
        grants = { [outsider]: { [key]: true } };
        expect(await call(outsider, method, path, body)).toBe(403);
        // Refused by the SECTION gate, not only by the screen's: `requireSurface` re-checks the
        // section too (D-SURF2), so without this line the endpoint could lose its `requireSection`
        // and still pass — the belt with the braces quietly gone.
        expect(lastCode).toBe("forbidden");
        expect(rec.forTable(table).some((q) => q.write)).toBe(false);
      });
    });
  }
});

/**
 * The erasure SP2 fixed on the way. Both pages used to write the whole `organizations` row; the
 * Notifications page did not carry the DOT number or the address, and the save wrote them as null.
 */
describe("each organizations save writes only its own screen's columns", () => {
  it("Notifications writes the two notification columns and nothing else", async () => {
    expect(await call("admin", "PUT", "/api/org-settings/notifications", NOTIFICATIONS)).toBe(200);
    expect(rec.writtenRows("organizations")).toEqual([NOTIFICATIONS]);
  });

  it("Organization writes the profile and hours — never the notifications, never allowed_domains", async () => {
    const body = { ...PROFILE, notifications_enabled: false, notification_emails: [], allowed_domains: ["evil.test"] };
    expect(await call("admin", "PUT", "/api/org-settings/profile", body)).toBe(200);
    const [row] = rec.writtenRows("organizations");
    expect(Object.keys(row!).sort()).toEqual(Object.keys(PROFILE).sort());
  });

  it("writes an empty DOT number or address as null — an honest 'not recorded'", async () => {
    expect(await call("admin", "PUT", "/api/org-settings/profile", { ...PROFILE, dot_number: "", city: "" })).toBe(200);
    expect(rec.writtenRows("organizations")[0]).toMatchObject({ dot_number: null, city: null });
  });
});
