import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { Session } from "@supabase/supabase-js";

/**
 * The session store's REFRESH CONTRACT — what has to be re-fetched when the signed-in identity
 * changes without the page reloading.
 *
 * ⚠ This file exists because the store had no tests at all, and the gap had a symptom the owner
 * reported on 2026-09-20: after accepting an invitation, setting a password and signing in, the
 * dashboard greeted them "Good evening" with no name and the sidebar was built from the wrong
 * answer — and a manual browser refresh fixed both.
 *
 * The cause is a comment that describes an intention the code never carried out.
 * `onAuthStateChange` cleared `surfaces` and `fullName` "while the next `loadSurfaces()` is in
 * flight" — but nothing scheduled that next call. `loadSurfaces` ran in exactly one place, `init()`,
 * and `init()` runs once per PAGE LOAD because the router guard is `if (!session.initialized)`.
 *
 * So: boot signed-out → init() finds no session → returns early → initialized = true. Sign in →
 * listener fires → both values cleared → nothing refills them → the screen renders from null until
 * the human presses reload. Both halves are asserted below, and both fail without the fix.
 */

const authListeners: ((event: string, s: Session | null) => void)[] = [];
let currentSession: Session | null = null;

/**
 * `nonce` keeps two sessions for the same person distinguishable by TOKEN, which is what the store
 * compares. A rotation issues a new token for the same claims, so a helper that returned an
 * identical string would make the rotation test silently exercise the no-op path instead.
 */
let nonce = 0;
const sessionFor = (sub: string, org: string): Session =>
  ({
    access_token: `header.${btoa(JSON.stringify({ sub, org_id: org, user_role: "admin" }))}.sig-${++nonce}`,
    user: { id: sub },
  }) as Session;

vi.mock("@/lib/supabase", () => ({
  DEV_BYPASS: false,
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: currentSession } }),
      onAuthStateChange: (cb: (e: string, s: Session | null) => void) => {
        authListeners.push(cb);
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  },
}));

/**
 * Every `/api/me` answer this test hands back, a count so "was it asked again" is assertable, and —
 * when `hold` is on — a queue of resolvers so a test can decide the ORDER two overlapping calls
 * finish in. The staleness guard is only testable if the older request can be made to win the race.
 */
const me = {
  calls: 0,
  fullName: "Miroslav Jokovic" as string | null,
  surfaces: {} as Record<string, boolean>,
  hold: false,
  pending: [] as ((v: { fullName: string | null; surfaces: Record<string, boolean> }) => void)[],
};
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string) => {
    if (path !== "/api/me") return { ok: true, data: {} };
    me.calls += 1;
    if (!me.hold) return { ok: true, data: { fullName: me.fullName, surfaces: me.surfaces } };
    const data = await new Promise<{ fullName: string | null; surfaces: Record<string, boolean> }>((r) => me.pending.push(r));
    return { ok: true, data };
  }),
}));

vi.mock("@/lib/jwt", () => ({
  decodeClaims: (token?: string) => (token ? JSON.parse(atob(token.split(".")[1]!)) : {}),
}));
vi.mock("@/lib/stepUp", () => ({ clearStepUp: () => {} }));

import { useSessionStore } from "./session";

/** Drive the auth change exactly as supabase-js does: set the client's session, then notify. */
function signInAs(s: Session | null) {
  currentSession = s;
  for (const cb of authListeners) cb(s ? "SIGNED_IN" : "SIGNED_OUT", s);
}

beforeEach(() => {
  setActivePinia(createPinia());
  authListeners.length = 0;
  currentSession = null;
  me.calls = 0;
  me.fullName = "Miroslav Jokovic";
  me.surfaces = {};
  me.hold = false;
  me.pending = [];
});

describe("signing in without reloading the page", () => {
  /**
   * The owner's report, as a test. The greeting is the visible half: `greeting()` renders
   * "Good evening" with no comma when `fullName` is null, which is correct behaviour fed a wrong
   * value — the name was never fetched, not absent.
   */
  it("loads the caller's name when a session arrives after boot", async () => {
    const store = useSessionStore();
    await store.init(); // boots signed out, exactly as a visitor on /login does
    expect(store.fullName, "nobody is signed in yet").toBeNull();

    signInAs(sessionFor("user-1", "org-1"));
    await vi.waitFor(() => expect(store.fullName).toBe("Miroslav Jokovic"));
  });

  /**
   * ⚠ The half that is not cosmetic. `AppShell` builds the sidebar from `session.surfaces` and the
   * section guard reads it, so a caller whose role carries denials was navigating against `null` —
   * "no denials" — until they happened to reload.
   */
  it("loads the caller's surface denials when a session arrives after boot", async () => {
    me.surfaces = { "maintenance.repair-spend": false };
    const store = useSessionStore();
    await store.init();

    signInAs(sessionFor("user-1", "org-1"));
    await vi.waitFor(() => expect(store.surfaces).toEqual({ "maintenance.repair-spend": false }));
  });

  /**
   * A token ROTATION is an auth change too, and `LoginPage` performs one immediately after signing
   * in (`await session.refresh()`, audit B3) — so the listener fires twice in a row on every single
   * login. The second pass must not leave the screen holding null.
   */
  it("survives the token rotation LoginPage performs right after sign-in", async () => {
    const store = useSessionStore();
    await store.init();

    signInAs(sessionFor("user-1", "org-1"));
    signInAs(sessionFor("user-1", "org-1")); // the rotated token
    await vi.waitFor(() => expect(store.fullName).toBe("Miroslav Jokovic"));
  });

  /** Signing out must not leave the previous person's name on the screen, and must not call /api/me. */
  it("drops the name on sign-out rather than fetching with no session", async () => {
    const store = useSessionStore();
    await store.init();
    signInAs(sessionFor("user-1", "org-1"));
    await vi.waitFor(() => expect(store.fullName).toBe("Miroslav Jokovic"));

    const before = me.calls;
    signInAs(null);
    expect(store.fullName).toBeNull();
    expect(store.surfaces).toBeNull();
    await new Promise((r) => setTimeout(r, 10));
    expect(me.calls, "no /api/me call once signed out").toBe(before);
  });
});

/**
 * ── THE RACE THE FIX INTRODUCES, AND THE GUARD THAT ANSWERS IT ────────────────────────────────
 * Re-fetching on every auth change means overlapping requests, because there is always more than
 * one auth event per login. These two pin `identitySeq` — without it the store is last-write-wins,
 * and the writer that wins is whichever server response happens to be slowest.
 */
/**
 * supabase-js emits `INITIAL_SESSION` when you subscribe, replaying the session `init()` has already
 * read. Re-fetching on that replay is not merely wasteful: it clears the refs first, so a reader
 * watches the greeting lose the name it had just gained.
 */
describe("booting with a session already stored", () => {
  it("does not clear and re-fetch when the listener replays the session init() already had", async () => {
    const stored = sessionFor("user-1", "org-1");
    currentSession = stored;

    const store = useSessionStore();
    await store.init();
    expect(store.fullName, "init() fetches it once").toBe("Miroslav Jokovic");
    const afterInit = me.calls;

    // The replay: same token, delivered through the listener the way supabase-js does.
    signInAs(stored);

    expect(store.fullName, "the name must not blink out").toBe("Miroslav Jokovic");
    await new Promise((r) => setTimeout(r, 10));
    expect(me.calls, "and /api/me is not asked a second time for the same token").toBe(afterInit);
  });
});

describe("overlapping /api/me answers", () => {
  it("discards an answer that arrives after a different identity has taken over", async () => {
    const store = useSessionStore();
    await store.init();

    me.hold = true;
    signInAs(sessionFor("user-1", "org-1"));
    await vi.waitFor(() => expect(me.pending).toHaveLength(1));

    // A second person signs in — a different member of a different org — before the first answers.
    signInAs(sessionFor("user-2", "org-2"));
    await vi.waitFor(() => expect(me.pending).toHaveLength(2));

    /**
     * ⚠ The NEWER request is resolved FIRST, so the older one's continuation runs after it and would
     * win a last-write-wins. Resolving them in call order instead proves nothing — the newer answer
     * lands last by construction and the test stays green with the guard deleted, which is exactly
     * what it did when first written.
     */
    me.pending[1]!({ fullName: "Second Person", surfaces: {} });
    await vi.waitFor(() => expect(store.fullName).toBe("Second Person"));

    me.pending[0]!({ fullName: "First Person", surfaces: { "maintenance.repair-spend": false } });
    await new Promise((r) => setTimeout(r, 10));

    expect(store.fullName, "the older answer must not overwrite the newer identity").toBe("Second Person");
    expect(store.surfaces, "user-1's denials must not reach user-2's screen").toEqual({});
  });

  it("does not let an in-flight answer repopulate the name after sign-out", async () => {
    const store = useSessionStore();
    await store.init();

    me.hold = true;
    signInAs(sessionFor("user-1", "org-1"));
    await vi.waitFor(() => expect(me.pending).toHaveLength(1));

    signInAs(null); // they log out while /api/me is still in the air
    me.pending[0]!({ fullName: "Miroslav Jokovic", surfaces: {} });

    await new Promise((r) => setTimeout(r, 10));
    expect(store.fullName, "a logged-out screen must not show the last person's name").toBeNull();
    expect(store.surfaces).toBeNull();
  });
});
