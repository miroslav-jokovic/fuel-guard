import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { decodeClaims } from "@/lib/jwt";

/**
 * Platform session. Tracks the Supabase session and the assurance level (aal). aal2 = MFA satisfied;
 * the router blocks the app until aal2 is reached. Authority (who is a platform admin) is decided by
 * admin-api, never here — this store only drives what the UI shows.
 */
export const useSessionStore = defineStore("platform-session", () => {
  const session = ref<Session | null>(null);
  const initialized = ref(false);

  const claims = computed(() => decodeClaims(session.value?.access_token));
  const email = computed(() => session.value?.user.email ?? claims.value?.email ?? null);
  const isAuthenticated = computed(() => !!session.value);
  /** aal2 = the user completed MFA this session. */
  const isMfaSatisfied = computed(() => claims.value?.aal === "aal2");

  async function init() {
    const { data } = await supabase.auth.getSession();
    session.value = data.session;
    supabase.auth.onAuthStateChange((_event, s) => {
      session.value = s;
    });
    initialized.value = true;
  }

  async function signIn(emailAddr: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email: emailAddr, password });
    if (error) throw error;
  }

  async function signOut() {
    session.value = null;
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      /* already cleared locally */
    }
  }

  /** Re-read the session so a freshly-elevated aal2 token is reflected after MFA. */
  async function refresh() {
    const { data } = await supabase.auth.getSession();
    session.value = data.session;
  }

  return { session, initialized, email, isAuthenticated, isMfaSatisfied, init, signIn, signOut, refresh };
});
