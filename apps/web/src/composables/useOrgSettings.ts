import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import type { OrgNotificationsForm, OrgProfileForm, OrgSettings } from "@silvicom/shared";
import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";

const COLS =
  "id, name, dot_number, address_line1, city, state, postal_code, allowed_domains, operating_hours, notification_emails, notifications_enabled";

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

/**
 * The Organization and Notifications saves, one per screen (SP2, SETTINGS-PERMISSIONS-PLAN.md). Each
 * sends only its own columns to an endpoint gated on its own screen, where both used to write the
 * whole row straight to the table — and the Notifications page, which did not carry the DOT number or
 * the address, erased them (`orgProfileFormSchema`). ⚠ `apiFetch` serialises the body itself.
 */
function useSaveOrgPart<T extends object>(path: string, fallback: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: T): Promise<void> => {
      const r = await apiFetch(path, { method: "PUT", body: form });
      if (!r.ok) throw new Error(r.error?.message ?? fallback);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["org_settings"] }),
  });
}
export const useSaveOrgProfile = () =>
  useSaveOrgPart<OrgProfileForm>("/api/org-settings/profile", "Could not save the organization");
export const useSaveOrgNotifications = () =>
  useSaveOrgPart<OrgNotificationsForm>("/api/org-settings/notifications", "Could not save notification settings");
