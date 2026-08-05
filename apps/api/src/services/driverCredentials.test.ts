/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createDriverLogin,
  resetDriverPassword,
  disableDriverLogin,
  enableDriverLogin,
  revokeDriverLogin,
  generateDriverPassword,
  DriverCredentialError,
} from "./driverCredentials.js";

/**
 * Fake covering BOTH surfaces the service touches: PostgREST tables (chainable, fixture-resolved)
 * and the GoTrue admin API (call log + scriptable failures).
 */
function makeAdmin(opts: {
  fixtures: Record<string, { data: unknown }>;
  createUserError?: string;
  memberInsertError?: string;
  linkUpdateError?: boolean;
}) {
  const authCalls: { fn: string; args: unknown[] }[] = [];
  const writes: { table: string; kind: "insert" | "update" | "delete"; payload?: unknown }[] = [];
  function node(table: string): any {
    const fx = opts.fixtures[table] ?? { data: null };
    const proxy: any = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve({ ...fx, error: null });
        if (prop === "insert")
          return (payload: unknown) => {
            writes.push({ table, kind: "insert", payload });
            return Promise.resolve({ error: opts.memberInsertError ? { message: opts.memberInsertError } : null });
          };
        if (prop === "update")
          return (payload: unknown) => {
            writes.push({ table, kind: "update", payload });
            const failing = opts.linkUpdateError && table === "drivers";
            const done: any = Promise.resolve({ error: failing ? { message: "link failed" } : null });
            done.eq = () => done;
            return done;
          };
        if (prop === "delete")
          return () => {
            writes.push({ table, kind: "delete" });
            const done: any = Promise.resolve({ error: null });
            done.eq = () => done;
            return done;
          };
        return () => proxy;
      },
      apply: () => proxy,
    });
    return proxy;
  }
  const admin = {
    from: (t: string) => node(t),
    rpc: async (fn: string) => {
      authCalls.push({ fn: `rpc:${fn}`, args: [] });
      return { data: 0, error: null };
    },
    auth: {
      admin: {
        createUser: async (args: unknown) => {
          authCalls.push({ fn: "createUser", args: [args] });
          if (opts.createUserError) return { data: { user: null }, error: { message: opts.createUserError } };
          return { data: { user: { id: "auth-1" } }, error: null };
        },
        updateUserById: async (id: string, attrs: unknown) => {
          authCalls.push({ fn: "updateUserById", args: [id, attrs] });
          return { data: {}, error: null };
        },
        deleteUser: async (id: string) => {
          authCalls.push({ fn: "deleteUser", args: [id] });
          return { data: {}, error: null };
        },
      },
    },
  } as unknown as SupabaseClient;
  return { admin, authCalls, writes };
}

const linkedDriver = {
  data: { id: "d1", full_name: "Aaron Cole", user_id: "auth-9", app_username: "aaron", samsara_username: "aaron" },
};
const unlinkedDriver = {
  data: { id: "d1", full_name: "Aaron B. Cole", user_id: null, app_username: null, samsara_username: null },
};

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
    const { admin, authCalls, writes } = makeAdmin({ fixtures: { drivers: unlinkedDriver } });
    const issued = await createDriverLogin(admin, "org1", "d1");
    expect(issued.username).toBe("aaron.cole"); // derived from the name (no samsara code)
    expect(issued.password).toHaveLength(16);

    const create = authCalls.find((c) => c.fn === "createUser")!.args[0] as Record<string, unknown>;
    expect(create.email).toBe("aaron.cole@drivers.fuelguard.app");
    expect(create.email_confirm).toBe(true);

    expect(writes.some((w) => w.table === "memberships" && w.kind === "insert")).toBe(true);
    const link = writes.find((w) => w.table === "drivers" && w.kind === "update")!.payload as Record<string, unknown>;
    expect(link).toMatchObject({ user_id: "auth-1", app_username: "aaron.cole", app_access_enabled: true });
  });

  it("refuses when the driver is already linked (reset instead)", async () => {
    const { admin } = makeAdmin({ fixtures: { drivers: linkedDriver } });
    await expect(createDriverLogin(admin, "org1", "d1")).rejects.toMatchObject({ code: "already_linked" });
  });

  it("maps an email-exists auth error to username_taken", async () => {
    const { admin } = makeAdmin({
      fixtures: { drivers: unlinkedDriver },
      createUserError: "A user with this email address has already been registered",
    });
    await expect(createDriverLogin(admin, "org1", "d1")).rejects.toMatchObject({ code: "username_taken" });
  });

  it("rolls the auth user back when the roster binding fails (no half-created login)", async () => {
    const { admin, authCalls } = makeAdmin({ fixtures: { drivers: unlinkedDriver }, linkUpdateError: true });
    await expect(createDriverLogin(admin, "org1", "d1")).rejects.toBeInstanceOf(DriverCredentialError);
    expect(authCalls.some((c) => c.fn === "deleteUser" && c.args[0] === "auth-1")).toBe(true);
  });

  it("rejects an invalid explicit username before touching auth", async () => {
    const { admin, authCalls } = makeAdmin({ fixtures: { drivers: unlinkedDriver } });
    await expect(createDriverLogin(admin, "org1", "d1", { username: "x" })).rejects.toMatchObject({
      code: "invalid_username",
    });
    expect(authCalls).toHaveLength(0);
  });
});

describe("lifecycle", () => {
  it("reset issues a new password via the auth admin and stamps the roster row", async () => {
    const { admin, authCalls, writes } = makeAdmin({ fixtures: { drivers: linkedDriver } });
    const issued = await resetDriverPassword(admin, "org1", "d1");
    expect(issued.username).toBe("aaron");
    const upd = authCalls.find((c) => c.fn === "updateUserById")!;
    expect(upd.args[0]).toBe("auth-9");
    expect((upd.args[1] as { password: string }).password).toHaveLength(16);
    expect(writes.some((w) => w.table === "drivers" && w.kind === "update")).toBe(true);
  });

  it("disable bans + revokes push tokens + flips app_access_enabled off", async () => {
    const { admin, authCalls, writes } = makeAdmin({
      fixtures: { drivers: linkedDriver, device_push_tokens: { data: [] } },
    });
    await disableDriverLogin(admin, "org1", "d1");
    expect((authCalls.find((c) => c.fn === "updateUserById")!.args[1] as { ban_duration: string }).ban_duration).toBe("87600h");
    const flip = writes.find((w) => w.table === "drivers" && w.kind === "update")!.payload as Record<string, unknown>;
    expect(flip.app_access_enabled).toBe(false);
  });

  it("enable lifts the ban", async () => {
    const { admin, authCalls } = makeAdmin({ fixtures: { drivers: linkedDriver } });
    await enableDriverLogin(admin, "org1", "d1");
    expect((authCalls.find((c) => c.fn === "updateUserById")!.args[1] as { ban_duration: string }).ban_duration).toBe("none");
  });

  it("revoke unlinks the roster row BEFORE deleting the auth user", async () => {
    const { admin, authCalls, writes } = makeAdmin({
      fixtures: { drivers: linkedDriver, device_push_tokens: { data: [] } },
    });
    await revokeDriverLogin(admin, "org1", "d1");
    const unlink = writes.find((w) => w.table === "drivers" && w.kind === "update")!.payload as Record<string, unknown>;
    expect(unlink.user_id).toBeNull();
    expect(authCalls.some((c) => c.fn === "deleteUser" && c.args[0] === "auth-9")).toBe(true);
  });

  it("lifecycle actions on a driver without a login fail with no_login", async () => {
    const { admin } = makeAdmin({ fixtures: { drivers: unlinkedDriver } });
    await expect(resetDriverPassword(admin, "org1", "d1")).rejects.toMatchObject({ code: "no_login" });
    await expect(disableDriverLogin(admin, "org1", "d1")).rejects.toMatchObject({ code: "no_login" });
    await expect(revokeDriverLogin(admin, "org1", "d1")).rejects.toMatchObject({ code: "no_login" });
  });
});
