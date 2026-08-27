import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import type { UserRole } from "@silvicom/shared";
import { decodeClaims } from "@/lib/jwt";
import { supabase } from "@/lib/supabase";
import { env } from "@/lib/env";

/**
 * The resolved auth state that drives every routing decision (root guard) and gated UI.
 *  - loading:   still restoring the persisted session — show a splash, never the sign-in flash.
 *  - signedOut: no session — go to sign-in.
 *  - pending:   signed in but no org membership/claims yet (audit B3) — "account pending".
 *  - wrongApp:  signed in with a non-driver role — this app is drivers-only (defense in depth).
 *  - ready:     a driver with an org — the app proper.
 */
export type SessionStatus = "loading" | "signedOut" | "pending" | "wrongApp" | "ready";

interface SessionValue {
  status: SessionStatus;
  session: Session | null;
  userId: string | null;
  email: string | null;
  orgId: string | null;
  role: UserRole | null;
  isDriver: boolean;
  hasOrg: boolean;
  /** Company-issued Driver ID (username) sign-in; input containing "@" is a legacy email login. */
  signIn: (usernameOrEmail: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Re-fetch the token so freshly-minted org_id/user_role claims appear after accepting an invite. */
  refresh: () => Promise<void>;
  /** DEV ONLY — skip Supabase auth and jump straight to the app as a fake driver. */
  activateDevBypass: () => void;
}

/**
 * How long to wait for supabase-js to restore the persisted session before giving up and showing
 * sign-in. Generous on purpose: a cold start on a bad connection is slow, and a false "signed out"
 * is worse than a slightly longer splash. A session that lands after this is still promoted by the
 * onAuthStateChange subscription below.
 */
const RESTORE_FAILSAFE_MS = 8_000;

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within <SessionProvider>");
  return ctx;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [devBypass, setDevBypass] = useState(false);

  useEffect(() => {
    let mounted = true;
    let settled = false;

    // Mark auth restore complete exactly once, from whichever signal arrives first. Restoring the
    // persisted session must NEVER be able to strand the app on the splash: a getSession() that
    // rejects (storage fault) or hangs (a token refresh against an unreachable Supabase) still has
    // to fall through to a usable surface. So we settle on the first of: getSession resolves,
    // getSession rejects, the INITIAL_SESSION event, or a hard timeout.
    const settle = (next: Session | null) => {
      if (!mounted || settled) return;
      settled = true;
      setSession(next);
      setInitialized(true);
    };

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) console.warn("[session] getSession returned an error:", error.message);
        settle(data.session ?? null);
      })
      .catch((e) => {
        console.warn("[session] getSession threw:", e instanceof Error ? e.message : String(e));
        settle(null);
      });

    // Safety net — if restore hasn't settled in time, drop to sign-in rather than spin forever.
    // A real session that resolves later is still promoted below via onAuthStateChange.
    const failSafe = setTimeout(() => settle(null), RESTORE_FAILSAFE_MS);

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      // INITIAL_SESSION is emitted once supabase-js finishes restoring — the recommended readiness
      // signal. Any later event (SIGNED_IN/OUT, token refresh) just keeps our session state live,
      // including a real session that arrives after the fail-safe already flipped us to sign-in.
      if (event === "INITIAL_SESSION" && !settled) settle(next ?? null);
      else setSession(next);
    });

    return () => {
      mounted = false;
      clearTimeout(failSafe);
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<SessionValue>(() => {
    if (__DEV__ && devBypass) {
      return {
        status: "ready",
        session: null,
        userId: "dev-user",
        email: "dev@fuelguard.local",
        orgId: "dev-org",
        role: "driver",
        isDriver: true,
        hasOrg: true,
        signIn: () => Promise.resolve(),
        signOut: () => {
          setDevBypass(false);
          return Promise.resolve();
        },
        refresh: () => Promise.resolve(),
        activateDevBypass() {
          setDevBypass(true);
        },
      };
    }

    const claims = decodeClaims(session?.access_token);
    const orgId = claims?.org_id ?? null;
    const role = claims?.user_role ?? null;
    const isDriver = role === "driver";
    const hasOrg = !!orgId;

    const status: SessionStatus = !initialized
      ? "loading"
      : !session
        ? "signedOut"
        : !hasOrg
          ? "pending"
          : !isDriver
            ? "wrongApp"
            : "ready";

    return {
      status,
      session,
      userId: session?.user.id ?? null,
      email: session?.user.email ?? null,
      orgId,
      role,
      isDriver,
      hasOrg,
      async signIn(usernameOrEmail, password) {
        // Legacy email logins (pre-cutover accounts) go straight to Supabase; company-issued Driver
        // IDs go through the server exchange (DRIVER-CREDENTIALS-PLAN.md DC5), which resolves the
        // username and returns a session — the app never learns the synthetic-email scheme.
        if (usernameOrEmail.includes("@")) {
          const { error } = await supabase.auth.signInWithPassword({ email: usernameOrEmail, password });
          if (error) throw error;
          return;
        }
        const res = await fetch(`${env.apiUrl}/api/auth/driver-login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: usernameOrEmail.trim().toLowerCase(), password }),
        });
        const body = (await res.json().catch(() => null)) as
          | { access_token?: string; refresh_token?: string; error?: { message?: string } }
          | null;
        if (!res.ok || !body?.access_token || !body.refresh_token) {
          throw new Error(body?.error?.message ?? "That Driver ID or password is incorrect.");
        }
        const { error } = await supabase.auth.setSession({
          access_token: body.access_token,
          refresh_token: body.refresh_token,
        });
        if (error) throw error;
      },
      async signOut() {
        // Clear local state first so the guard reacts immediately (no waiting on the network).
        setSession(null);
        try {
          await supabase.auth.signOut({ scope: "local" });
        } catch {
          /* already cleared locally */
        }
      },
      async refresh() {
        const { data } = await supabase.auth.refreshSession();
        if (data.session) setSession(data.session);
      },
      activateDevBypass() {
        if (__DEV__) setDevBypass(true);
      },
    };
  }, [session, initialized, devBypass]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
