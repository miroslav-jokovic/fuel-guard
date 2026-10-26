import type { BrowserContext } from "@playwright/test";
import { DISPATCHER, NOW, ORG } from "./fixtures/world";

/**
 * Signs the browser in as the synthetic dispatcher — through the PRODUCTION bundle's own door.
 *
 * ── NOT `VITE_DEV_BYPASS` ───────────────────────────────────────────────────────────────────────
 * The bypass build mints an `admin` with a real person's address (`stores/session.ts`
 * `makeDevSession`), and an admin's sidebar is not a dispatcher's: a tutorial recorded through it would
 * teach screens a dispatcher never sees. Instead this puts a session where supabase-js keeps one
 * (`sb-<project ref>-auth-token` in localStorage), so the ordinary build reads it on start. Its token
 * carries `user_role: dispatcher`, which is the claim every gate in the app reads (`session.role`), so
 * the sidebar, the routes and the section checks are the real ones, computed by the real code.
 *
 * The signature is not real and does not need to be: the browser never verifies a JWT, and nothing
 * the page sends reaches a server that would — `stub.ts` answers every request.
 *
 * The project ref comes from the build's `VITE_SUPABASE_URL` (`TUTORIAL_SUPABASE_URL` below), which is
 * the same placeholder host the applicant specs use; no request to it leaves the machine.
 */
export const TUTORIAL_SUPABASE_URL = "https://e2e-stub.supabase.co";
const STORAGE_KEY = `sb-${new URL(TUTORIAL_SUPABASE_URL).hostname.split(".")[0]}-auth-token`;

const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");

export async function signInAsDispatcher(context: BrowserContext): Promise<void> {
  const iat = Math.floor(NOW / 1000);
  // A day is longer than any recording, and far enough out that supabase-js never tries to refresh.
  const exp = iat + 86_400;
  const claims = {
    sub: DISPATCHER.userId, email: DISPATCHER.email, role: "authenticated", aal: "aal1",
    org_id: ORG.id, user_role: "dispatcher", iat, exp,
  };
  const session = {
    access_token: `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(claims)}.tutorial`,
    refresh_token: "tutorial-refresh", token_type: "bearer", expires_in: 86_400, expires_at: exp,
    user: {
      id: DISPATCHER.userId, email: DISPATCHER.email, aud: "authenticated", role: "authenticated",
      app_metadata: { provider: "email" }, user_metadata: {}, created_at: new Date(NOW - 90 * 86_400_000).toISOString(),
    },
  };
  await context.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [STORAGE_KEY, JSON.stringify(session)] as const);
  // Every "in 3 h" and "36 s ago" is measured against the world's clock, so a regenerated video reads
  // the same. `setFixedTime` pins Date without freezing timers, so polling and animation still run.
  await context.clock.setFixedTime(NOW);
}
