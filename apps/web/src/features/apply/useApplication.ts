import { computed, type Ref } from "vue";
import { useMutation, useQuery } from "@tanstack/vue-query";
import type {
  ApplicationCaptureContentType,
  ApplicationCaptureSlot,
  ApplicationCaptureView,
  AuthorizationPurpose,
  DriverApplication,
} from "@fuelguard/shared";

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

/**
 * Where the driver stopped last time (D-APP1, migration 0225).
 *
 * The link is a session, not a fuse: it survives a submission so the signing ceremony the page
 * promises stays reachable through it. These three dates are what let the page open on the step the
 * driver had reached rather than on a form they have already filled in once. `consentedAt` and
 * `releasesCompletedAt` are stamped by A4 and A5 and are null until then — the page reads them
 * defensively rather than pretending the field will not exist.
 */
export interface ApplyPhases {
  consentedAt: string | null;
  releasesCompletedAt: string | null;
  submittedAt: string | null;
}

/**
 * What the driver typed last time (A2).
 *
 * `payload` is null while `locked` is true: once a draft contains a date of birth, the bare link no
 * longer reads it back (D-APP16 — an email is forwarded and a phone is shared). The body arrives
 * from `unlockApplicationDraft` instead. Before a date of birth is typed there is nothing sensitive
 * to protect and no gate is shown.
 */
export interface ApplyDraft {
  locked: boolean;
  payload: Record<string, unknown> | null;
  furthestSection: string | null;
  updatedAt: string | null;
}

/**
 * The 15 U.S.C. 7001(c) consent, served like every other instrument (A4).
 *
 * `required` is false while the wording is draft: the page must not ask for a consent the server
 * would refuse to record. It becomes true by itself the day counsel's text is published (A0).
 */
export interface ApplyEsignConsent {
  version: string;
  title: string;
  citation: string;
  body: string;
  intent: string;
  draft: boolean;
  required: boolean;
}

export interface ApplyInvitation {
  carrier: string;
  expiresAt: string;
  releases: ApplyRelease[];
  /** Which instruments this link has already collected, so a resumed ceremony skips them (A5). */
  releasesSigned: AuthorizationPurpose[];
  phases: ApplyPhases;
  draft: ApplyDraft;
  esignConsent: ApplyEsignConsent;
  /**
   * Which slots this session has already photographed (A8).
   *
   * Slots and dates, not pictures: the driver took them and saw them at the time, and re-serving
   * them would mean a signed read URL per slot on an unauthenticated surface on every page load.
   */
  captures: ApplicationCaptureView[];
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
    /**
     * The certified document and, if the driver gave one, the Social Security number.
     *
     * The SSN travels HERE and only here (D-APP3): it never enters a draft, so this request is the
     * first and last time it crosses the wire, and the server seals it into a secretBox envelope
     * bound to the org or keeps only the last four. §391.21(b)(2) lists it; D-HIRE6 makes it
     * optional, because PSP matches on name, licence, state and date of birth and never needs it.
     */
    mutationFn: (body: { application: DriverApplication; ssn: string | null }) =>
      publicFetch<{ applicationId: string }>(`/${token.value}`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
  });
}

/**
 * Autosave. Not a `useMutation`, deliberately: the caller is a timer, not a click, and vue-query's
 * pending/error state is the wrong vocabulary for something that runs every few seconds in the
 * background. `useApplicationDraft` owns the state the driver actually sees.
 */
export const saveApplicationDraft = (
  token: string,
  payload: Record<string, unknown>,
  section: string | null,
): Promise<{ updatedAt: string }> =>
  publicFetch<{ updatedAt: string }>(`/${token}/draft`, {
    method: "PUT",
    body: JSON.stringify({ payload, section }),
  });

/** Release a gated draft with the date of birth that is in it (D-APP16). */
export const unlockApplicationDraft = (token: string, dateOfBirth: string): Promise<{ draft: ApplyDraft }> =>
  publicFetch<{ draft: ApplyDraft }>(`/${token}/unlock`, {
    method: "POST",
    body: JSON.stringify({ date_of_birth: dateOfBirth }),
  });

/**
 * Ask for somewhere to put one photograph (A8).
 *
 * Two calls per photograph rather than one, and the order is the point: nothing is recorded until the
 * bytes are provably in the bucket, so a failed upload leaves no slot claiming to be filled. Re-shoots
 * cost NEITHER call — the gate runs in the browser, before any of this (A7).
 */
export const startApplicationCapture = (
  token: string,
  slot: ApplicationCaptureSlot,
  contentType: ApplicationCaptureContentType,
): Promise<{ captureId: string; storagePath: string; uploadUrl: string; uploadToken: string }> =>
  publicFetch(`/${token}/capture`, {
    method: "POST",
    body: JSON.stringify({ slot, content_type: contentType }),
  });

/**
 * PUT the bytes straight to Storage.
 *
 * Hand-rolled rather than routed through `@supabase/supabase-js`: the signed URL already carries its
 * own token in the query string, and reaching for the app's Supabase client here would attach a
 * session to a page whose entire design is that it has none (see this file's header). One PUT, no
 * bearer, and the bytes never pass through our API.
 */
export async function uploadCaptureBytes(uploadUrl: string, blob: Blob): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": blob.type },
    body: blob,
  });
  if (!res.ok) throw new Error("That photo did not finish uploading.");
}

/** The bytes landed — record the slot, replacing whatever it held (A8, D-APP10). */
export const confirmApplicationCapture = (
  token: string,
  captureId: string,
  body: { slot: ApplicationCaptureSlot; content_type: ApplicationCaptureContentType; sha256: string },
): Promise<{ slot: ApplicationCaptureSlot; capturedAt: string }> =>
  publicFetch(`/${token}/capture/${captureId}`, { method: "PUT", body: JSON.stringify(body) });

/** Agree to transact electronically. The body is empty: the server composes what was agreed to. */
export const giveEsignConsent = (token: string): Promise<{ ok: true }> =>
  publicFetch<{ ok: true }>(`/${token}/consent`, { method: "POST", body: "{}" });

/**
 * Sign one instrument (A5).
 *
 * The body carries who signed and how — never what they signed. The server composes the disclosure
 * text and the intent sentence from `DISCLOSURES` and stores them on the row, which is what makes the
 * signature worth anything when the file is read years later.
 */
export const signRelease = (
  token: string,
  purpose: AuthorizationPurpose,
  signedName: string,
): Promise<{ signedCount: number; completed: boolean }> =>
  publicFetch<{ signedCount: number; completed: boolean }>(`/${token}/release`, {
    method: "POST",
    body: JSON.stringify({ purpose, signed_name: signedName, esign_consent: true }),
  });
