import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { CertificationCreateRequest } from "@silvicom/shared";
import { insertCertification } from "./compliance.js";

/**
 * A licence or medical card learned from the carrier's TMS, filed into the evidence record.
 *
 * ── WHY THIS EXISTS AT ALL (D-ARC3, and DRIVER-ROSTER-PLAN §6 Q2, answered 2026-08-30) ──────────
 * `docs/ARCHITECTURE.md` §3 calls this "the audit's sharpest finding": CDL and medical expiry live
 * in BOTH `drivers.*` columns (0098) and `certifications` rows (0127), "with nothing syncing them —
 * a §391.51 compliance surface with two disagreeing sources".
 *
 * That was survivable while both sides were hand-entered by the same office. The McLeod roster sync
 * ends that: `mcleod/rosterFields.ts` writes `cdl_expires_at` and `medical_card_expires_at` onto
 * `drivers` on EVERY sweep, and nothing carried them into `certifications` — which is the only table
 * the qualification gate reads (`qualification.ts`) and the only one `buildDqFile` builds from. Left
 * alone, the day an org turned roster sync on, its roster would show a current medical card from
 * McLeod while the same driver's DQ file said `missing`. Two numbers, both honestly sourced,
 * disagreeing in public — which is the exact failure D-ARC3 named.
 *
 * The owner ruling (Q2, option (a)) is that the carrier's system of record feeds the gate. This is
 * the seam where that happens.
 *
 * ── WHY IT LIVES IN `evidence` AND NOT IN `mcleod` ──────────────────────────────────────────────
 * D-ARC3's rule: every table has exactly one owner, only the owner writes it, and outside callers go
 * through the owner's exported interface. `certifications` is `evidence`'s. The model is
 * `roster.recordInferredTrailerPairing`, which exists for the same reason — the collector holds the
 * vendor fetch, the owner holds the invariant. Here the invariant is the paragraph below, and it is
 * not something a collector should be trusted to remember.
 *
 * ── THE INVARIANT: WRITE ONLY ON CHANGE ─────────────────────────────────────────────────────────
 * `insert_certification` (0127) unconditionally inserts a new row and supersedes the prior one. That
 * is correct for a human filing a renewal and catastrophic for a sweep: `certifications` is
 * append-only, pinned in `RETENTION_FORBIDDEN`, and has no UPDATE or DELETE policy for anybody. A
 * naive per-sweep call would add one row per driver per credential per sweep — on a 164-driver
 * roster swept nightly that is ~120,000 rows a year of pure noise, in the one table nothing is
 * allowed to prune, burying the real supersede chain an auditor is trying to read.
 *
 * So this function reads the current row first and writes only when the value actually differs.
 * "Risk: a chatty sync writing evidence rows" was named when option (a) was chosen; it is answered
 * here rather than accepted.
 *
 * ── THE THREE SMALLER RULES ─────────────────────────────────────────────────────────────────────
 * 1. **Never write a null over a good value.** A field McLeod did not supply is skipped, never filed
 *    as an absent expiry — the same rule `rosterFields.ts:18-22` holds for the column write, and for
 *    the same measured reason: McLeod's coverage is uneven per field and per row.
 * 2. **A change in either direction is written.** McLeod is declared the carrier's system of record
 *    for these two fields — `rosterFields.ts:49-55` says so and refreshes them on every sweep even
 *    on a row the office has claimed. So an EARLIER date is filed too, and it will correctly
 *    un-qualify a driver: if the carrier's safety department believes the card lapsed, the gate
 *    should fail closed rather than keep dispatching on our more optimistic copy.
 * 3. **Superseding a documented row with an undocumented one is correct, not lossy.** A new expiry
 *    means a new physical card, whose scan nobody has filed yet; the old scan stays attached to the
 *    row it actually evidenced, which is what an append-only chain is for.
 *
 * ⚠ **What this does NOT settle — DRIVER-ROSTER-PLAN §6 Q6.** `buildDqFile` computes
 * `present = Boolean(cert)`, so a row filed from here flips the requirement to `current` with **no
 * scan on file**, while §391.51(b)(6)(i) wants the certificate itself, legible. Option (a) decides
 * where the DATE comes from; it does not decide what the file may claim. Until Q6 is answered, every
 * row written here is stamped with `SYNC_NOTE` so the rows are identifiable — a `documented` flag
 * distinct from `present` can then be built over them rather than guessed at.
 */

/** Stamped on every synced row. The marker Q6's fix will find these by — keep it stable. */
export const SYNC_NOTE = "Recorded from the carrier's TMS (McLeod) roster sync — no scan filed by the sync.";

/** What a sweep learned about one driver's credentials. Absent fields are skipped, never nulled. */
export interface SyncedCredentialInput {
  cdlNumber?: string | null;
  cdlState?: string | null;
  cdlExpiresAt?: string | null;
  medicalExpiresAt?: string | null;
}

export interface SyncedCredentialResult {
  /** Kinds a new certification row was written for this call. */
  written: string[];
  /** Kinds whose current row already said the same thing — the common case after the first sweep. */
  unchanged: string[];
  /** Kinds that failed to file, with the reason. A failure here must not fail the roster sweep. */
  failed: Array<{ kind: string; error: string }>;
}

type CurrentCert = { kind: string; identifier: string | null; issuing_authority: string | null; expires_at: string | null };

/** ISO date or null, compared as text — both sides are `date` columns rendered YYYY-MM-DD. */
const sameDate = (a: string | null | undefined, b: string | null | undefined): boolean =>
  (a ?? null) === (b ?? null);

export async function recordSyncedCredentials(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  input: SyncedCredentialInput,
): Promise<SyncedCredentialResult> {
  const out: SyncedCredentialResult = { written: [], unchanged: [], failed: [] };

  const wantsCdl = Boolean(input.cdlExpiresAt);
  const wantsMedical = Boolean(input.medicalExpiresAt);
  if (!wantsCdl && !wantsMedical) return out;

  // One read for both kinds. `superseded_by is null` is the current row by 0127's model.
  const { data, error } = await admin
    .from("certifications")
    .select("kind, identifier, issuing_authority, expires_at")
    .eq("org_id", orgId)
    .eq("subject_type", "driver")
    .eq("subject_id", driverId)
    .in("kind", ["cdl", "medical_card"])
    .is("superseded_by", null);
  if (error) {
    // Fail the FILING, never the sweep. A roster sync that aborts because the evidence read blipped
    // would leave the driver rows half-updated, which is worse than a credential filed next sweep.
    return { written: [], unchanged: [], failed: [{ kind: "cdl,medical_card", error: error.message }] };
  }
  const current = new Map<string, CurrentCert>();
  for (const row of (data ?? []) as CurrentCert[]) current.set(row.kind, row);

  /** `created_by` is null: a sweep has no user behind it, and 0127's column is nullable for that. */
  const file = async (
    kind: "cdl" | "medical_card",
    changed: boolean,
    fields: Pick<CertificationCreateRequest, "identifier" | "issuingAuthority" | "expiresAt">,
  ) => {
    if (!changed) {
      out.unchanged.push(kind);
      return;
    }
    const res = await insertCertification(admin, orgId, null, {
      id: randomUUID(),
      subjectType: "driver",
      subjectId: driverId,
      kind,
      notes: SYNC_NOTE,
      ...fields,
    });
    if ("error" in res) out.failed.push({ kind, error: res.error });
    else out.written.push(kind);
  };

  if (wantsCdl) {
    const prior = current.get("cdl");
    // The licence NUMBER and STATE ride the same row as its expiry, so a correction to either is a
    // change to this credential — not just the date. A stale licence number on a current row is the
    // kind of thing an auditor reads off the file and we would have no answer for.
    const changed =
      !prior
      || !sameDate(prior.expires_at, input.cdlExpiresAt)
      || (input.cdlNumber != null && prior.identifier !== input.cdlNumber)
      || (input.cdlState != null && prior.issuing_authority !== input.cdlState);
    await file("cdl", changed, {
      identifier: input.cdlNumber ?? prior?.identifier ?? null,
      issuingAuthority: input.cdlState ?? prior?.issuing_authority ?? null,
      expiresAt: input.cdlExpiresAt,
    });
  }

  if (wantsMedical) {
    const prior = current.get("medical_card");
    const changed = !prior || !sameDate(prior.expires_at, input.medicalExpiresAt);
    await file("medical_card", changed, { identifier: null, issuingAuthority: null, expiresAt: input.medicalExpiresAt });
  }

  return out;
}
