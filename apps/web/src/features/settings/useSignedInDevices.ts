import { computed, ref, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { memberSessionsResponseSchema, type MemberSession } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase";

/**
 * "Signed-in devices" (INSTALLED-APP-PLAN IA-S3): the signed-in person's own sign-ins, and the two things
 * they can do about them.
 *
 * One ref for whether the panel is open, for the reason `useMyAlertsPanel` gives: the account menu that opens
 * it is mounted twice (the desktop sidebar and the phone's drawer) and the panel once, in the shell.
 *
 * ENDING ONE goes through the API (`DELETE /api/me/sessions/:id`), which audits it and refuses the device in
 * use. ENDING ALL THE OTHERS is the auth server's own `signOut({ scope: "others" })`: it needs nothing from us,
 * leaves this browser signed in (auth-js removes the local session for every scope except this one), and is
 * one call however many there are — one person had 47 on 2026-11-15.
 */
const open = ref(false);

export function useSignedInDevicesPanel() {
  return {
    open,
    show: (): void => { open.value = true; },
    close: (): void => { open.value = false; },
  };
}

export const MY_SESSIONS_KEY = ["me", "sessions"] as const;

export function useSignedInDevices(enabled: Ref<boolean>) {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: MY_SESSIONS_KEY,
    enabled: computed(() => enabled.value),
    queryFn: async (): Promise<MemberSession[]> => {
      const res = await apiFetch<unknown>("/api/me/sessions");
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load your devices.");
      return memberSessionsResponseSchema.parse(res.data).sessions;
    },
    // Opened to look at where one is signed in: always the present answer, never a remembered one.
    staleTime: 0,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: MY_SESSIONS_KEY });

  const endOne = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch<{ ended: boolean }>(`/api/me/sessions/${id}`, { method: "DELETE" });
      // Already gone (ended from another device a moment ago) is what was wanted: not an error to show.
      if (!res.ok && res.status !== 404) throw new Error(res.error?.message ?? "Could not sign that device out.");
    },
    onSettled: refresh,
  });

  const endOthers = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signOut({ scope: "others" });
      if (error) throw new Error("Could not sign the other devices out.");
    },
    onSettled: refresh,
  });

  return { list, endOne, endOthers };
}
