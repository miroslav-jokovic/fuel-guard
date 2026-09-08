import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClosureRequest, ClosureRequestStatus } from "@silvicom/shared";
import { disableDriverLogin } from "../roster/index.js";

/**
 * Account closure (DIRECTION-B-PLAN §6 P4.2, D-PR8). Table and its guarantees in migration 0330.
 *
 * ── THE ORDER OF OPERATIONS IS THE DESIGN ──────────────────────────────────────────────────────
 * The request is INSERTED FIRST, then the login is closed. That ordering is the whole safety
 * property and it is worth stating why, because the intuitive order is the other one:
 *
 *   · Insert-then-close: if the close fails, a request row exists for a login that still works. The
 *     fleet sees it in their queue, and the driver — who was told their login would stop — finds it
 *     still works and asks again, which the partial unique index makes a no-op. Recoverable, and
 *     visible to somebody.
 *   · Close-then-insert: if the insert fails, the driver's login is dead and NOBODY HAS A RECORD OF
 *     WHY. They cannot sign in to ask again, the fleet has no queue item, and the only trace is an
 *     audit line nobody is looking at. That is the failure that cannot be recovered from the app.
 *
 * So the row goes down first. This is not a transaction — the ban lives in GoTrue and the row lives
 * in Postgres, and no transaction spans them — which is exactly why the order has to carry the
 * safety rather than a rollback.
 */

/** What `requestClosure` did, so the route can answer a retry differently from a first ask. */
export interface ClosureOutcome {
  /** False when an open request was already standing — the outbox retried, not a second ask. */
  created: boolean;
}

/** Postgres unique-violation. 0330's partial index is what makes the retry safe. */
const UNIQUE_VIOLATION = "23505";

/**
 * The driver asks. Records the request, then closes the login.
 *
 * ⚠ `disableDriverLogin` is the roster module's own offboarding action — a permanent ban plus push
 * token revocation plus `app_access_enabled = false` — and it is CALLED rather than reimplemented
 * here. Writing a second ban path would be the second source of truth this repo's rules name
 * explicitly: the fleet-side hold and the driver-side closure must mean the same thing to GoTrue, or
 * "closed" and "disabled" drift into two different states nobody can tell apart later. The
 * `driver-app -> roster` edge is pinned in `check-feature-boundaries.mjs` with this reason.
 *
 * ⚠ What this does NOT do is kill an access token already in the driver's hands. A GoTrue ban
 * refuses the REFRESH; the JWT they hold stays valid until it expires (an hour at most), exactly as
 * it does for the fleet-side disable today. The app signs out locally the moment the confirm
 * returns, so the practical window is the length of one API call — but a token replayed from
 * outside the app would work until expiry, and pretending otherwise in a comment would be worse
 * than saying it.
 */
export async function requestClosure(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  userId: string,
): Promise<ClosureOutcome> {
  const { error } = await admin
    .from("driver_account_closure_requests")
    .insert({ org_id: orgId, driver_id: driverId, user_id: userId });

  if (error && error.code !== UNIQUE_VIOLATION) throw error;
  const created = !error;

  // Idempotent on purpose: a retry re-closes an already-closed login, which is a no-op ban and a
  // no-op token revoke. The alternative — skipping the close on a retry — would leave a login open
  // in the one case where the first attempt inserted the row and then failed to ban.
  await disableDriverLogin(admin, orgId, driverId);

  return { created };
}

/** One row of the fleet's queue, joined to the names a person needs to action it. */
interface ClosureRow {
  id: string;
  driver_id: string;
  requested_at: string;
  status: ClosureRequestStatus;
  resolved_at: string | null;
  resolved_by: string | null;
  note: string | null;
  drivers: { full_name: string | null } | null;
}

/**
 * One queue row before names are attached — `resolved_by` is still the auth user id.
 *
 * The split exists so this module never has to know how an actor becomes a display name. That is
 * `lib/memberLabels` (0301, S9), it costs one read for the whole page rather than one per row, and
 * a service that took a `resolveName` callback would either force a per-row lookup or invite the
 * caller to smuggle ids through the name field — which the first draft of this file did.
 */
export type ClosureRequestRow = Omit<ClosureRequest, "resolved_by_name"> & { resolved_by: string | null };

/**
 * The fleet's queue. Open first, then the resolved ones newest-first — a queue that sorted purely by
 * date would bury today's open request under last month's completed ones.
 */
export async function listClosureRequests(
  admin: SupabaseClient,
  orgId: string,
): Promise<ClosureRequestRow[]> {
  const { data, error } = await admin
    .from("driver_account_closure_requests")
    .select("id, driver_id, requested_at, status, resolved_at, resolved_by, note, drivers(full_name)")
    .eq("org_id", orgId)
    .order("requested_at", { ascending: false });
  if (error) throw error;

  const rows = (data ?? []) as unknown as ClosureRow[];
  return rows
    .map((r) => ({
      id: r.id,
      driver_id: r.driver_id,
      driver_name: r.drivers?.full_name ?? null,
      requested_at: r.requested_at,
      status: r.status,
      resolved_at: r.resolved_at,
      resolved_by: r.resolved_by,
      note: r.note,
    }))
    .sort((a, b) => {
      if (a.status === "open" && b.status !== "open") return -1;
      if (b.status === "open" && a.status !== "open") return 1;
      return b.requested_at.localeCompare(a.requested_at);
    });
}

/** Raised when a resolve names a request that is not this org's, or is already resolved. */
export class ClosureRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ClosureRequestError";
  }
}

/**
 * The fleet answers. `completed` is their attestation that the non-retained data was deleted per the
 * published policy; `declined` records a refusal and the note says why.
 *
 * The `status = 'open'` filter is load-bearing rather than defensive. 0330's trigger refuses to move
 * a resolved request, so a second resolve would fail at the database with `AC010` — a 500 and a log
 * line. Filtering here turns the same race (two managers on the queue at once) into a 409 that says
 * what happened, which is the difference between an error and an answer.
 */
export async function resolveClosureRequest(
  admin: SupabaseClient,
  orgId: string,
  requestId: string,
  outcome: "completed" | "declined",
  resolvedBy: string,
  note: string | undefined,
): Promise<void> {
  const { data, error } = await admin
    .from("driver_account_closure_requests")
    .update({
      status: outcome,
      resolved_by: resolvedBy,
      resolved_at: new Date().toISOString(),
      ...(note ? { note } : {}),
    })
    .eq("id", requestId)
    .eq("org_id", orgId)
    .eq("status", "open")
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new ClosureRequestError(
      "That request is not open any more — someone may have just resolved it.",
      "closure_request_not_open",
      409,
    );
  }
}
