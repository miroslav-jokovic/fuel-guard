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

/**
 * A refused admin-api request. `code` is the API's own error code (`step_up_required`, `duplicate`…),
 * so a page can say what to do about it; the message stays the generic one every caller already shows.
 */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    readonly detail: string | null,
  ) {
    super(`Request failed (${status})`);
  }
}

/** POST JSON to admin-api with the current bearer token. Throws ApiRequestError on non-2xx. */
export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`${ADMIN_API_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new ApiRequestError(res.status, err?.error?.code ?? null, err?.error?.message ?? null);
  }
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

/** A sellable-module entitlement (org_modules) — commercial grant, distinct from integrations. */
export interface OrgEntitlement {
  moduleKey: string;
  enabled: boolean;
  /** False = never granted (no row), vs. an explicit revoke (row with enabled=false). */
  granted: boolean;
}

export interface OrgDetail extends OrgOverview {
  allowedDomains: string[];
  operatingHours: unknown;
  modules: OrgModule[];
  entitlements: OrgEntitlement[];
}

export interface OrgMember {
  userId: string;
  email: string | null;
  role: string;
  createdAt: string;
}

export interface Me {
  id: string;
  email: string;
  role: string;
}

export interface Grant {
  id: string;
  orgId: string;
  adminId: string;
  scope: "read_only" | "read_write";
  reason: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface ViewAnomaly {
  id: string;
  ruleId: string;
  severity: string;
  status: string;
  message: string;
  createdAt: string;
}

/** A platform alert recipient (0427). Phones arrive masked to their last four digits. */
export interface AlertRecipient {
  id: string;
  channel: "email" | "sms";
  address: string;
  label: string | null;
  createdAt: string;
}
