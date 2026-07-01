import { supabase } from "./supabase";

// Same-origin by default (single-service deploy): paths already include `/api`, so "" → "/api/…".
// Set VITE_API_URL only when the API lives on a different origin (split-service deploy).
const API_URL = import.meta.env.VITE_API_URL ?? "";

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: { code: string; message: string };
}

/** Call the FleetGuard API with the current Supabase access token as a Bearer credential. */
export async function apiFetch<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<ApiResult<T>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let payload: unknown = undefined;
  try {
    payload = await res.json();
  } catch {
    // empty body
  }

  if (!res.ok) {
    const err = (payload as { error?: { code: string; message: string } })?.error;
    return { ok: false, status: res.status, error: err ?? { code: "error", message: res.statusText } };
  }
  return { ok: true, status: res.status, data: payload as T };
}
