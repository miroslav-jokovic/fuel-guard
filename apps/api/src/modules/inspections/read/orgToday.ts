import type { SupabaseClient } from "@supabase/supabase-js";
import { organizationTimezone, todayInZone, type CalendarDay } from "@silvicom/shared";

/** Today on the carrier's calendar: the card's window ends on it and an inspection's CSA points are measured on it. */
export async function orgToday(admin: SupabaseClient, orgId: string): Promise<CalendarDay> {
  const { data: org } = await admin.from("organizations").select("operating_hours").eq("id", orgId).maybeSingle();
  return todayInZone(new Date(), organizationTimezone(org?.operating_hours));
}
