import { computed, type Ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { ApplyJobView, ApplySubmit, CareersListView } from "@silvicom/shared";

/**
 * The careers page's calls to `/api/public/careers` (APPLY-PAGE-PLAN AP2/AP3).
 *
 * ── SAME ORIGIN, ALWAYS (D-AP9) ─────────────────────────────────────────────────────────────────
 * The path is relative, never `VITE_API_URL`: on `careers.silvicominc.com` Caddy sends this one prefix to the api
 * and nothing else, so the page reaches its API without the api admitting a second origin to CORS. On the office host
 * the same relative path is the office's own `/api` (D-AWS17). `publicFetch` (`features/apply/useApplication.ts`)
 * is the same choice for the application link.
 *
 * ── NO SESSION ──────────────────────────────────────────────────────────────────────────────────
 * `apiFetch` is not used, for `publicFetch`'s reason: it attaches a signed-in person's token, and a recruiter testing
 * the page in the browser they work in would send their identity with a stranger's application.
 *
 * ── RAW JSON ────────────────────────────────────────────────────────────────────────────────────
 * The answers have no `{ ok, data }` envelope; an error is `{ error: { code, message, field? } }`.
 */

export interface CareersError extends Error {
  code: string;
  status: number;
  /** The form field a 400 is about (`fieldError` in the API's route), so the page can put the sentence under it. */
  field: string | null;
}

const BASE = "/api/public/careers";

async function careersFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
  } catch {
    throw Object.assign(new Error("offline"), { code: "offline", status: 0, field: null }) as CareersError;
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: { code?: string; message?: string; field?: string } }) | null;
  if (!res.ok) {
    throw Object.assign(new Error(body?.error?.message ?? "Something went wrong."), {
      code: body?.error?.code ?? "unknown",
      status: res.status,
      field: body?.error?.field || null,
    }) as CareersError;
  }
  return body as T;
}

/** One read; a 404 does not become a page by being retried. */
export function useCareersList(handle: Ref<string>) {
  return useQuery({
    queryKey: computed(() => ["careers", handle.value] as const),
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: () => careersFetch<CareersListView>(`/${encodeURIComponent(handle.value)}`),
  });
}

/**
 * One job and its form. Never refetched on focus or reconnect: each read issues a NEW form token (D-AP5), and a
 * token swapped under a person who is halfway through would restart their fill time.
 */
export function useCareersJob(handle: Ref<string>, openingId: Ref<string>) {
  return useQuery({
    queryKey: computed(() => ["careers", handle.value, "job", openingId.value] as const),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
    queryFn: () => careersFetch<ApplyJobView>(`/${encodeURIComponent(handle.value)}/jobs/${encodeURIComponent(openingId.value)}`),
  });
}

export function sendApplication(handle: string, openingId: string, body: ApplySubmit): Promise<{ ok: true }> {
  return careersFetch<{ ok: true }>(`/${encodeURIComponent(handle)}/jobs/${encodeURIComponent(openingId)}/apply`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
