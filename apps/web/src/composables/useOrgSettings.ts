import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import type { OrgSettings, OrgSettingsForm } from "@silvicom/shared";
import { supabase } from "@/lib/supabase";
import { useSessionStore } from "@/stores/session";

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
          // Empty means "not recorded", and null is how the column says that — an empty string would
          // print as a blank USDOT line on every binder cover rather than as an honest absence.
          dot_number: form.dot_number ? form.dot_number : null,
          // Same rule, same reason: empty means "not recorded", and the annual inspection says so by
          // refusing to certify rather than printing a blank carrier block (0282, §396.21(a)(2)).
          address_line1: form.address_line1 ? form.address_line1 : null,
          city: form.city ? form.city : null,
          state: form.state ? form.state : null,
          postal_code: form.postal_code ? form.postal_code : null,
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
