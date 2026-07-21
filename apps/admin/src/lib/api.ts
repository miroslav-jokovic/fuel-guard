import { supabase, ADMIN_API_URL } from "@/lib/supabase";

/** GET a JSON resource from admin-api with the current aal2 bearer token. Throws on non-2xx. */
export async function apiGet<T>(path: string): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`${ADMIN_API_URL}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
}

export interface OrgOverview {
  orgId: string;
  name: string;
  createdAt: string;
  memberCount: number;
  vehicleCount: number;
  activeVehicleCount: number;
  driverCount: number;
  openAnomalyCount: number;
  lastTxnAt: string | null;
}

export interface OrgModule {
  provider: string;
  enabled: boolean;
  lastSyncedAt: string | null;
}

export interface OrgDetail extends OrgOverview {
  allowedDomains: string[];
  operatingHours: unknown;
  modules: OrgModule[];
}
