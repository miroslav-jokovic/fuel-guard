import type { ApplicantIntake, ApplicantIntakeLicence } from "@silvicom/shared";
import { publicFetch } from "@/features/apply/useApplication";

/**
 * Part 1's three calls (AW2's routes, `publicApplicationIntake.ts`). Kept beside Part 1 rather than in
 * `useApplication.ts`, which is near its line budget; they go through the same `publicFetch`, so the
 * rule that file states — no session on this page, ever — holds for them too.
 *
 * `keptExisting` names fields the carrier already held and kept (fill-only, D-AF8) — never values.
 */
export const postIntake = (token: string, body: ApplicantIntake): Promise<{ ok: true; keptExisting: string[] }> =>
  publicFetch(`/${token}/intake`, { method: "POST", body: JSON.stringify(body) });

export const postIntakeLicences = (
  token: string,
  licences: ApplicantIntakeLicence[],
): Promise<{ ok: true; keptExisting: string[]; licenceCount: number }> =>
  publicFetch(`/${token}/intake/licences`, { method: "POST", body: JSON.stringify({ licences }) });

/** Finish Part 1. No body: what is recorded is an act, and what it is about is already on the server. */
export const completePartOne = (token: string): Promise<{ ok: true; intakeCompletedAt: string }> =>
  publicFetch(`/${token}/intake/complete`, { method: "POST" });
