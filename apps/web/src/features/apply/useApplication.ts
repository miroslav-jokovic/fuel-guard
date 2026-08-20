import { computed, type Ref } from "vue";
import { useMutation, useQuery } from "@tanstack/vue-query";
import type { AuthorizationPurpose, DriverApplication } from "@fuelguard/shared";

/**
 * The applicant's own API calls (H5b) — the only place in this app that talks to the server without
 * a session.
 *
 * `apiFetch` is deliberately NOT used: it attaches the Supabase bearer token and the step-up header,
 * and an applicant has neither. Worse, a recruiter signed in on the same browser would have their
 * Authorization header ride along, making the applicant's submission look like a staff action.
 */

export interface ApplyRelease {
  purpose: AuthorizationPurpose;
  version: string;
  title: string;
  citation: string;
  body: string;
  intent: string;
  /** True while the wording is still `v0-draft` — the server refuses to record a signature (Q-H3). */
  draft: boolean;
}

export interface ApplyInvitation {
  carrier: string;
  expiresAt: string;
  releases: ApplyRelease[];
}

async function publicFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/public/application${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const body = (await res.json().catch(() => null)) as
    | (T & { error?: { code?: string; message?: string } })
    | null;
  if (!res.ok) {
    // Every dead link answers the same way by design, so the client repeats what it was told rather
    // than trying to be more specific than the server was willing to be.
    throw Object.assign(new Error(body?.error?.message ?? "This application link is not valid."), {
      code: body?.error?.code ?? "invalid_link",
    });
  }
  return body as T;
}

export function useApplyInvitationQuery(token: Ref<string>) {
  return useQuery({
    queryKey: computed(() => ["apply", token.value] as const),
    enabled: computed(() => Boolean(token.value)),
    // One shot. A link that failed does not become valid by being retried, and a retry storm is what
    // the endpoint's rate limit exists to stop.
    retry: false,
    queryFn: () => publicFetch<ApplyInvitation>(`/${token.value}`),
  });
}

export function useSubmitApplication(token: Ref<string>) {
  return useMutation({
    mutationFn: (application: DriverApplication) =>
      publicFetch<{ applicationId: string }>(`/${token.value}`, {
        method: "POST",
        // No SSN. §391.21(b)(2) asks for it and the API accepts it, but nothing collects it here
        // until a vendor actually needs it (D-HIRE6) — the field that is never rendered is the one
        // that cannot leak.
        body: JSON.stringify({ application, ssn: null }),
      }),
  });
}
