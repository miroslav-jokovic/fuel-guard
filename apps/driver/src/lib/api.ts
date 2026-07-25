import type { ZodType } from 'zod';
import { env } from './env';
import { supabase } from './supabase';

export interface ApiError {
  code: string;
  message: string;
}
export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: ApiError;
}

const DEFAULT_TIMEOUT_MS = 15_000;

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
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener('abort', onExternalAbort);
  }
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${env.apiUrl}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    const timedOut = e instanceof Error && e.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      error: timedOut
        ? { code: 'timeout', message: 'The request timed out. Check your connection and try again.' }
        : { code: 'network', message: 'Network error. Your entry is saved and will sync.' },
    };
  } finally {
    clearTimeout(timer);
    if (options.signal) options.signal.removeEventListener('abort', onExternalAbort);
  }

  let payload: unknown;
  try {
    payload = (await res.json()) as unknown;
  } catch {
    payload = undefined;
  }

  if (!res.ok) {
    const err = (payload as { error?: ApiError } | undefined)?.error;
    return { ok: false, status: res.status, error: err ?? { code: 'error', message: `HTTP ${res.status}` } };
  }

  if (options.schema) {
    const parsed = options.schema.safeParse(payload);
    if (!parsed.success) {
      return { ok: false, status: res.status, error: { code: 'bad_response', message: 'Unexpected response from server.' } };
    }
    return { ok: true, status: res.status, data: parsed.data };
  }

  return { ok: true, status: res.status, data: payload as T };
}
