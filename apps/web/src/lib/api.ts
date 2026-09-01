import { supabase } from "./supabase";
import { stepUpHeader } from "./stepUp";

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

/**
 * Fetch a binary response — a PDF — and hand back an object URL the browser can open.
 *
 * `window.open()` on an API path cannot work: these routes sit behind `requireAuth` and a plain
 * navigation carries no Authorization header, so it would 401. The alternative shape in this repo is
 * an endpoint that returns a SIGNED STORAGE URL (`statementSourceUrl`, the DQ export download), which
 * is right when the bytes are already an object in a bucket — and is not available for a document
 * rendered on demand and deliberately never stored, like the inspection DRAFT preview.
 *
 * The caller owns the returned URL and must `URL.revokeObjectURL` it when done.
 */
export async function fetchObjectUrl(path: string): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    // The body is JSON on failure and a PDF on success, so the message only exists on this branch.
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `Could not open the document (${res.status})`);
  }
  return URL.createObjectURL(await res.blob());
}

/** Call the Silvicom 360 API with the current Supabase access token as a Bearer credential. */
export async function apiFetch<T = unknown>(
  path: string,
  options: {
    method?: string;
    /**
     * The body as an OBJECT — this function serialises it. Typed `object` rather than `unknown`
     * because `unknown` accepted an already-stringified body, and a double-encoded body is not a
     * type error, it is a 500: `express.json()` runs in strict mode, rejects a top-level JSON
     * string, and the resulting body-parser error surfaces as "Unexpected server error" with the
     * request never reaching its handler. That shipped twice — the annual-inspection delete
     * (2026-09-01) and `useDispositions` before it — and neither was visible to typecheck while
     * this said `unknown`.
     */
    body?: object | null;
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
      // A held, unexpired step-up token rides on EVERY request (audit P0-4). Harmless where it is
      // not required; the one proof of a recently-typed password where it is. Explicit per-call
      // headers still win, so a caller can override.
      ...stepUpHeader(),
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

/**
 * Download a file the API generates, as the signed-in user.
 *
 * `apiFetch` cannot do this: it parses every response as JSON, which turns a PDF into a thrown parse
 * error. And a plain `<a href>` cannot either, because these routes are behind `requireAuth` and a
 * browser navigation carries no Authorization header — the download would 401, or worse, hand back a
 * login page saved under a .pdf name.
 *
 * So the bytes are fetched with the same headers every other call uses, and handed to the browser as a
 * blob. Errors come back as JSON from the API, so a failure is reported with the server's own message
 * rather than as a corrupt file the reader discovers on opening.
 */
export async function apiDownload(path: string, filename: string): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`${API_URL}${path}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...stepUpHeader(),
    },
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      message = body?.error?.message ?? message;
    } catch {
      // a non-JSON error body; the status text is what we have
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
