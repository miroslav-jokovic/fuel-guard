import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { UserRole } from '@fuelguard/shared';
import { decodeClaims } from '@/lib/jwt';
import { supabase } from '@/lib/supabase';

/**
 * The resolved auth state that drives every routing decision (root guard) and gated UI.
 *  - loading:   still restoring the persisted session — show a splash, never the sign-in flash.
 *  - signedOut: no session — go to sign-in.
 *  - pending:   signed in but no org membership/claims yet (audit B3) — "account pending".
 *  - wrongApp:  signed in with a non-driver role — this app is drivers-only (defense in depth).
 *  - ready:     a driver with an org — the app proper.
 */
export type SessionStatus = 'loading' | 'signedOut' | 'pending' | 'wrongApp' | 'ready';

interface SessionValue {
  status: SessionStatus;
  session: Session | null;
  userId: string | null;
  email: string | null;
  orgId: string | null;
  role: UserRole | null;
  isDriver: boolean;
  hasOrg: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Re-fetch the token so freshly-minted org_id/user_role claims appear after accepting an invite. */
  refresh: () => Promise<void>;
  /** DEV ONLY — skip Supabase auth and jump straight to the app as a fake driver. */
  activateDevBypass: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within <SessionProvider>');
  return ctx;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [devBypass, setDevBypass] = useState(false);

  useEffect(() => {
    let mounted = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setInitialized(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<SessionValue>(() => {
    if (__DEV__ && devBypass) {
      return {
        status: 'ready',
        session: null,
        userId: 'dev-user',
        email: 'dev@fuelguard.local',
        orgId: 'dev-org',
        role: 'driver',
        isDriver: true,
        hasOrg: true,
        signIn: () => Promise.resolve(),
        signOut: () => { setDevBypass(false); return Promise.resolve(); },
        refresh: () => Promise.resolve(),
        activateDevBypass() { setDevBypass(true); },
      };
    }

    const claims = decodeClaims(session?.access_token);
    const orgId = claims?.org_id ?? null;
    const role = claims?.user_role ?? null;
    const isDriver = role === 'driver';
    const hasOrg = !!orgId;

    const status: SessionStatus = !initialized
      ? 'loading'
      : !session
        ? 'signedOut'
        : !hasOrg
          ? 'pending'
          : !isDriver
            ? 'wrongApp'
            : 'ready';

    return {
      status,
      session,
      userId: session?.user.id ?? null,
      email: session?.user.email ?? null,
      orgId,
      role,
      isDriver,
      hasOrg,
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      },
      async signOut() {
        // Clear local state first so the guard reacts immediately (no waiting on the network).
        setSession(null);
        try {
          await supabase.auth.signOut({ scope: 'local' });
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
