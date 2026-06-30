import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import type { OrgSettings, OrgSettingsForm } from "@fleetguard/shared";
import { supabase } from "@/lib/supabase";
import { useSessionStore } from "@/stores/session";

const COLS = "id, name, allowed_domains, operating_hours, notification_emails, notifications_enabled";

export function useOrgSettingsQuery() {
  return useQuery({
    queryKey: ["org_settings"],
    queryFn: async (): Promise<OrgSettings | null> => {
      const { data, error } = await supabase.from("organizations").select(COLS).maybeSingle();
      if (error) throw new Error(error.message);
      return (data as OrgSettings | null) ?? null;
    },
  });
}

export function useSaveOrgSettings() {
  const qc = useQueryClient();
  const session = useSessionStore();
  return useMutation({
    mutationFn: async (form: OrgSettingsForm): Promise<void> => {
      if (!session.orgId) throw new Error("No organization in session");
      const { error } = await supabase
        .from("organizations")
        .update({
          name: form.name,
          operating_hours: form.operating_hours,
          notification_emails: form.notification_emails,
          notifications_enabled: form.notifications_enabled,
        })
        .eq("id", session.orgId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["org_settings"] }),
  });
}
