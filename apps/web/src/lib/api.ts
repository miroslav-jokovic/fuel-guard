import { supabase } from "./supabase";

// Same-origin by default (single-service deploy): paths already include `/api`, so "" → "/api/…".
// Set VITE_API_URL only when the API lives on a different origin (split-service deploy).
const API_URL = import.meta.env.VITE_API_URL ?? "";

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: { code: string; message: string };
  /**
   * The FULL parsed error body, when the call failed.
   *
   * Several API refusals carry fields alongside `error` that the caller has to act on rather than
   * merely display: a 409 `card_state_changed` carries `currentVersion` and the fresh card, a 403
   * `step_up_required` carries `maxAgeSec`. Returning only `error` threw those away and left the
   * caller re-deriving them from a sentence. Present only on failure; `data` already carries the
   * success body.
   */
  detail?: Record<string, unknown>;
}

/** Call the FuelGuard API with the current Supabase access token as a Bearer credential. */
export async function apiFetch<T = unknown>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    /**
     * Extra request headers. Used for `Idempotency-Key` on card-control writes, where a replayed
     * request must be recognised as the same one rather than performed twice.
     */
    headers?: Record<string, string>;
  } = {},
): Promise<ApiResult<T>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
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
    return {
      ok: false,
      status: res.status,
      error: err ?? { code: "error", message: res.statusText },
      detail: (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>,
    };
  }
  return { ok: true, status: res.status, data: payload as T };
}
