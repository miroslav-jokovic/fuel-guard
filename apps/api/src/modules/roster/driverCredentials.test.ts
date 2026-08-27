import { describe, it, expect } from "vitest";
import {
  createDriverLogin,
  resetDriverPassword,
  disableDriverLogin,
  enableDriverLogin,
  revokeDriverLogin,
  generateDriverPassword,
  DriverCredentialError,
} from "./driverCredentials.js";
import {
  createSupabaseRecorder,
  expectOrgScoped,
  RECORDER_AUTH_USER_ID,
  type SupabaseRecorder,
} from "../../testing/supabaseRecorder.js";

/**
 * Migrated off the local `makeAdmin` Proxy (audit 2026-08-09, Stage 2.5). This service hands out a
 * login for a driver identified by id, so `.eq("org_id", …)` on the roster read is the ONLY thing
 * stopping an admin of one fleet from minting credentials against another fleet's driver row — and
 * the old fake accepted that filter and dropped it. The recorder covers both surfaces the service
 * writes to (PostgREST tables and the GoTrue admin API) and remembers the filters.
 */
const ORG = "org1";

const linkedDriver = { id: "d1", full_name: "Aaron Cole", user_id: "auth-9", app_username: "aaron", samsara_username: "aaron" };
const unlinkedDriver = { id: "d1", full_name: "Aaron B. Cole", user_id: null, app_username: null, samsara_username: null };

/** The payload of the (single) roster update this call made. */
const rosterPatch = (rec: SupabaseRecorder) => rec.writtenRows("drivers")[0] as Record<string, unknown>;
const authArgs = (rec: SupabaseRecorder, fn: string) => rec.authCalls.find((c) => c.fn === fn)!.args;

describe("generateDriverPassword", () => {
  it("is long, unambiguous, and unique per call", () => {
    const a = generateDriverPassword();
    const b = generateDriverPassword();
    expect(a).toHaveLength(16);
    expect(a).not.toBe(b);
    expect(a).not.toMatch(/[0O1lI]/); // handwriting-safe alphabet
  });
});

describe("createDriverLogin", () => {
  it("creates the auth user (synthetic email), membership, and roster binding", async () => {
    const rec = createSupabaseRecorder({ tables: { drivers: { data: unlinkedDriver } } });
    const issued = await createDriverLogin(rec.client, ORG, "d1");
    expect(issued.username).toBe("aaron.cole"); // derived from the name (no samsara code)
    expect(issued.password).toHaveLength(16);

    const create = authArgs(rec, "createUser")[0] as Record<string, unknown>;
    expect(create.email).toBe("aaron.cole@drivers.fuelguard.app");
    expect(create.email_confirm).toBe(true);

    expect(rec.forTable("memberships").some((q) => q.write?.method === "insert")).toBe(true);
    expect(rosterPatch(rec)).toMatchObject({
      user_id: RECORDER_AUTH_USER_ID,
      app_username: "aaron.cole",
      app_access_enabled: true,
    });

    // Roster read, username-clash probe, membership row and roster binding all name this org.
    expectOrgScoped(rec, ORG);
  });

  it("refuses when the driver is already linked (reset instead)", async () => {
    const rec = createSupabaseRecorder({ tables: { drivers: { data: linkedDriver } } });
    await expect(createDriverLogin(rec.client, ORG, "d1")).rejects.toMatchObject({ code: "already_linked" });
    expectOrgScoped(rec, ORG);
  });

  it("maps an email-exists auth error to username_taken", async () => {
    const rec = createSupabaseRecorder({
      tables: { drivers: { data: unlinkedDriver } },
      auth: {
        createUser: () => ({
          data: { user: null },
          error: { message: "A user with this email address has already been registered" },
        }),
      },
    });
    await expect(createDriverLogin(rec.client, ORG, "d1")).rejects.toMatchObject({ code: "username_taken" });
  });

  it("rolls the auth user back when the roster binding fails (no half-created login)", async () => {
    const rec = createSupabaseRecorder({
      // The roster row READS fine and the binding UPDATE fails — the partial-failure path.
      tables: { drivers: { data: unlinkedDriver, writeError: { message: "link failed" } } },
    });
    await expect(createDriverLogin(rec.client, ORG, "d1")).rejects.toBeInstanceOf(DriverCredentialError);
    expect(rec.authCalls.some((c) => c.fn === "deleteUser" && c.args[0] === RECORDER_AUTH_USER_ID)).toBe(true);
  });

  it("rejects an invalid explicit username before touching auth", async () => {
    const rec = createSupabaseRecorder({ tables: { drivers: { data: unlinkedDriver } } });
    await expect(createDriverLogin(rec.client, ORG, "d1", { username: "x" })).rejects.toMatchObject({
      code: "invalid_username",
    });
    expect(rec.authCalls).toHaveLength(0);
  });

  it("surfaces a failed membership insert as auth_error and rolls the auth user back", async () => {
    const rec = createSupabaseRecorder({
      tables: { drivers: { data: unlinkedDriver }, memberships: { writeError: { message: "duplicate key" } } },
    });
    await expect(createDriverLogin(rec.client, ORG, "d1")).rejects.toMatchObject({ code: "auth_error" });
    expect(rec.authCalls.some((c) => c.fn === "deleteUser" && c.args[0] === RECORDER_AUTH_USER_ID)).toBe(true);
  });
});

describe("lifecycle", () => {
  it("reset issues a new password via the auth admin and stamps the roster row", async () => {
    const rec = createSupabaseRecorder({ tables: { drivers: { data: linkedDriver } } });
    const issued = await resetDriverPassword(rec.client, ORG, "d1");
    expect(issued.username).toBe("aaron");
    const upd = authArgs(rec, "updateUserById");
    expect(upd[0]).toBe("auth-9");
    expect((upd[1] as { password: string }).password).toHaveLength(16);
    expect(rec.forTable("drivers").some((q) => q.write?.method === "update")).toBe(true);
    expectOrgScoped(rec, ORG);
  });

  it("disable bans + revokes push tokens + flips app_access_enabled off", async () => {
    const rec = createSupabaseRecorder({ tables: { drivers: { data: linkedDriver }, device_push_tokens: [] } });
    await disableDriverLogin(rec.client, ORG, "d1");
    expect((authArgs(rec, "updateUserById")[1] as { ban_duration: string }).ban_duration).toBe("87600h");
    expect(rosterPatch(rec).app_access_enabled).toBe(false);
    // The push-token revoke is an rpc keyed by auth user id (the SQL function owns that scope), so it is
    // not a table query; every table query here is still this org's.
    expectOrgScoped(rec, ORG);
  });

  it("enable lifts the ban", async () => {
    const rec = createSupabaseRecorder({ tables: { drivers: { data: linkedDriver } } });
    await enableDriverLogin(rec.client, ORG, "d1");
    expect((authArgs(rec, "updateUserById")[1] as { ban_duration: string }).ban_duration).toBe("none");
    expectOrgScoped(rec, ORG);
  });

  it("revoke unlinks the roster row BEFORE deleting the auth user", async () => {
    const rec = createSupabaseRecorder({ tables: { drivers: { data: linkedDriver }, device_push_tokens: [] } });
    await revokeDriverLogin(rec.client, ORG, "d1");
    expect(rosterPatch(rec).user_id).toBeNull();
    expect(rec.authCalls.some((c) => c.fn === "deleteUser" && c.args[0] === "auth-9")).toBe(true);
    // The membership delete must be org-filtered too, or a revoke could strip a same-user membership
    // held in another org.
    expectOrgScoped(rec, ORG);
  });

  it("lifecycle actions on a driver without a login fail with no_login", async () => {
    const rec = createSupabaseRecorder({ tables: { drivers: { data: unlinkedDriver } } });
    await expect(resetDriverPassword(rec.client, ORG, "d1")).rejects.toMatchObject({ code: "no_login" });
    await expect(disableDriverLogin(rec.client, ORG, "d1")).rejects.toMatchObject({ code: "no_login" });
    await expect(revokeDriverLogin(rec.client, ORG, "d1")).rejects.toMatchObject({ code: "no_login" });
    expectOrgScoped(rec, ORG);
  });
});

describe("custom passwords", () => {
  it("create uses the admin-chosen password verbatim (returned once, sent to auth)", async () => {
    const rec = createSupabaseRecorder({ tables: { drivers: { data: unlinkedDriver } } });
    const issued = await createDriverLogin(rec.client, ORG, "d1", { password: "chosen-pass-12345" });
    expect(issued.password).toBe("chosen-pass-12345");
    expect((authArgs(rec, "createUser")[0] as { password: string }).password).toBe("chosen-pass-12345");
  });

  it("reset uses the admin-chosen password when provided", async () => {
    const rec = createSupabaseRecorder({ tables: { drivers: { data: linkedDriver } } });
    const issued = await resetDriverPassword(rec.client, ORG, "d1", { password: "chosen-reset-12345" });
    expect(issued.password).toBe("chosen-reset-12345");
    expect((authArgs(rec, "updateUserById")[1] as { password: string }).password).toBe("chosen-reset-12345");
  });
});
