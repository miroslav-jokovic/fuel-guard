import type { ZodType } from "zod";
import { env } from "./env";
import { supabase } from "./supabase";

export interface ApiError {
  code: string;
  message: string;
}
export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: ApiError;
  /** `Retry-After` in ms, when the server sent one. A 429 from a daily cap (D57) says "in nine
   *  hours", which no client-side backoff curve would ever guess. */
  retryAfterMs?: number;
}

/** RFC 9110 allows delta-seconds or an HTTP date. Both appear in the wild; parse both, trust neither. */
function parseRetryAfter(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const seconds = Number(raw.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const at = Date.parse(raw);
  if (!Number.isNaN(at)) return Math.max(0, at - Date.now());
  return undefined;
}

const DEFAULT_TIMEOUT_MS = 15_000;
/** Ceiling on resolving the bearer token — deliberately well under DEFAULT_TIMEOUT_MS. */
const AUTH_TIMEOUT_MS = 5_000;

interface ApiOptions<T> {
  method?: string;
  body?: unknown;
  /** When provided, the response is parsed (never cast) with this schema — parse-not-trust (D24). */
  schema?: ZodType<T>;
  timeoutMs?: number;
  /** Caller-owned cancellation (e.g. component unmount) — combined with the internal timeout. */
  signal?: AbortSignal;
}

/**
 * Call the FuelGuard API with the current Supabase access token as a Bearer credential — the RN port
 * of the web's `apiFetch`, hardened for mobile networks: a hard timeout via AbortController and an
 * optional Zod parse of the response so callers get typed, validated data or a structured error
 * (never a thrown exception). Plan §3.2.
 */
export async function apiFetch<T = unknown>(
  path: string,
  options: ApiOptions<T> = {},
): Promise<ApiResult<T>> {
  const url = `${env.apiUrl}${path}`;

  // Resolving the auth token must not be able to hang a request forever. `getSession()` can stall
  // when supabase-js is refreshing a stale token against an unreachable Supabase — and because it
  // sits BEFORE the AbortController below, its own timeout would never fire. Racing it means a
  // stalled token resolves into a clean 401 instead of an eternal spinner.
  let token: string | undefined;
  try {
    const sessionResult = await Promise.race([
      supabase.auth.getSession(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("getSession timed out after 5s")), AUTH_TIMEOUT_MS),
      ),
    ]);
    token = sessionResult.data.session?.access_token;
  } catch (e) {
    // Not swallowed silently: proceeding unauthenticated is a real anomaly, and one line here is
    // what tells you a 401 was a token fault rather than a permissions one.
    console.warn(`[api] auth token unavailable (${e instanceof Error ? e.message : String(e)})`);
  }

  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener("abort", onExternalAbort);
  }
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    const timedOut = e instanceof Error && e.name === "AbortError";
    return {
      ok: false,
      status: 0,
      error: timedOut
        ? {
            code: "timeout",
            message: "The request timed out. Check your connection and try again.",
          }
        : { code: "network", message: "Network error. Your entry is saved and will sync." },
    };
  } finally {
    clearTimeout(timer);
    if (options.signal) options.signal.removeEventListener("abort", onExternalAbort);
  }

  let payload: unknown;
  try {
    payload = (await res.json()) as unknown;
  } catch {
    payload = undefined;
  }

  if (!res.ok) {
    const err = (payload as { error?: ApiError } | undefined)?.error;
    const retryAfterMs = parseRetryAfter(res.headers.get("Retry-After"));
    return {
      ok: false,
      status: res.status,
      error: err ?? { code: "error", message: `HTTP ${res.status}` },
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    };
  }

  if (options.schema) {
    const parsed = options.schema.safeParse(payload);
    if (!parsed.success) {
      return {
        ok: false,
        status: res.status,
        error: { code: "bad_response", message: "Unexpected response from server." },
      };
    }
    return { ok: true, status: res.status, data: parsed.data };
  }

  return { ok: true, status: res.status, data: payload as T };
}
