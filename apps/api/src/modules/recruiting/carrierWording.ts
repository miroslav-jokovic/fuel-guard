import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ESIGN_CONSENT,
  esignConsentBody,
  carrierWording,
  nextWordingVersion,
  unpublishedInstruments,
  type CarrierWording,
  type PublishWording,
  type PublishableInstrument,
  type PublishedWording,
} from "@silvicom/shared";
import { writeAudit } from "../../lib/audit.js";

/**
 * Reading and publishing a carrier's own instrument wording (0338).
 *
 * ── WHAT THIS UNBLOCKS ────────────────────────────────────────────────────────────────────────
 * All six instruments are `v0-draft` placeholders in `authorizationContract.ts`, and every refusal in
 * the applicant's path reads that version string. Until 2026-09-11 the only way to publish was an
 * engineer editing a TypeScript constant and deploying — so a carrier holding counsel-approved text
 * had nowhere to put it, and their applicants met a disabled button.
 *
 * ── THE PROPERTY EVERY CALLER DEPENDS ON ──────────────────────────────────────────────────────
 * `loadCarrierWording` ALWAYS returns six documents. Anything the carrier has not published keeps the
 * code's placeholder, which is `v0-draft`, which keeps that instrument's refusal exactly where it
 * was. So a caller that forgets to pass the carrier's wording, or a read that fails, degrades to
 * "nothing may be signed" rather than to "anything may be signed" — the only safe direction for a
 * function that decides whether a signature may be taken.
 */

export interface WordingError {
  code: string;
  message: string;
}

export const isWordingError = (v: unknown): v is WordingError =>
  typeof v === "object" && v !== null && "code" in v && "message" in v;

interface WordingRow {
  instrument: PublishableInstrument;
  version: string;
  title: string;
  body: string | null;
  clauses: Record<string, string> | null;
  intent: string;
  published_at: string;
  published_by: string | null;
}

const COLS = "instrument, version, title, body, clauses, intent, published_at, published_by";

const toPublished = (r: WordingRow): PublishedWording => ({
  instrument: r.instrument,
  version: r.version,
  title: r.title,
  body: r.body,
  clauses: r.clauses,
  intent: r.intent,
  publishedAt: r.published_at,
});

/** Every version this carrier has ever published, newest first — what the office's screen reads. */
export async function wordingHistory(
  admin: SupabaseClient,
  orgId: string,
): Promise<Array<PublishedWording & { publishedBy: string | null }>> {
  const { data } = await admin
    .from("org_disclosures")
    // The service role bypasses RLS, so the org filter is the only thing between two carriers.
    .select(COLS)
    .eq("org_id", orgId)
    .order("published_at", { ascending: false });
  return ((data ?? []) as WordingRow[]).map((r) => ({ ...toPublished(r), publishedBy: r.published_by }));
}

/**
 * The six documents this carrier's applicants are shown.
 *
 * ⚠ A failed read returns the placeholders rather than throwing, and that is deliberate. This is
 * called on the applicant's page load; a database blip must not take the form down, and the state it
 * degrades to is the one where nothing can be signed.
 */
export async function loadCarrierWording(
  admin: SupabaseClient,
  orgId: string,
): Promise<CarrierWording> {
  const { data } = await admin
    .from("org_disclosures")
    .select(COLS)
    .eq("org_id", orgId)
    .order("published_at", { ascending: false });
  return carrierWording(((data ?? []) as WordingRow[]).map(toPublished));
}

/** What the office still owes before any applicant of theirs can sign anything. */
export async function outstandingWording(
  admin: SupabaseClient,
  orgId: string,
): Promise<PublishableInstrument[]> {
  return unpublishedInstruments(await loadCarrierWording(admin, orgId));
}

export interface PublishContext {
  actorId: string;
}

/**
 * Publish one instrument.
 *
 * ⚠ The version is ASSIGNED here and never taken from the request. `driver_authorizations` stores
 * the text and the version together, and the whole value of the version is that it identifies the
 * text — so two versions must never be able to mean two different things. The count of prior rows
 * decides it, and the unique index on `(org_id, instrument, version)` is what makes two recruiters
 * pressing Publish at the same moment a lost race rather than two texts answering to one version.
 */
export async function publishWording(
  admin: SupabaseClient,
  orgId: string,
  payload: PublishWording,
  ctx: PublishContext,
): Promise<{ instrument: PublishableInstrument; version: string } | WordingError> {
  const { count, error: countError } = await admin
    .from("org_disclosures")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("instrument", payload.instrument);
  if (countError) return { code: "publish_failed", message: "That could not be published. Try again." };

  const version = nextWordingVersion(count ?? 0);
  /**
   * ⚠ The consent's `body` is composed HERE, from the clauses, and stored — not composed at read
   * time. The same rule `recordRelease` follows for every other instrument: what somebody was shown
   * is a stored fact. If the composition ever changes, an instrument signed last year must still
   * read back exactly as it read when it was signed.
   */
  const body = payload.instrument === "esign_consent"
    ? esignConsentBody({
      ...ESIGN_CONSENT,
      title: payload.title,
      intent: payload.intent,
      clauses: { ...ESIGN_CONSENT.clauses, ...(payload.clauses ?? {}) } as typeof ESIGN_CONSENT.clauses,
    })
    : (payload.body ?? "");

  const { error } = await admin.from("org_disclosures").insert({
    org_id: orgId,
    instrument: payload.instrument,
    version,
    title: payload.title,
    body,
    clauses: payload.clauses ?? null,
    intent: payload.intent,
    published_by: ctx.actorId,
  });
  if (error) {
    // The unique index. Somebody else published the same instrument a moment ago; theirs is the
    // version that exists, and re-pressing Publish will number from there.
    if (/duplicate key|unique/i.test(error.message)) {
      return {
        code: "publish_raced",
        message: "Somebody else published this at the same moment. Reload and check what is live before publishing again.",
      };
    }
    return { code: "publish_failed", message: "That could not be published. Try again." };
  }

  await writeAudit(admin, {
    orgId,
    actorId: ctx.actorId,
    action: "disclosure_published",
    entity: "organizations",
    entityId: orgId,
    // ⚠ The instrument and version, never the text. An audit row is not the place to keep a second
    // copy of a legal instrument — `org_disclosures` is, and it is append-only.
    meta: { instrument: payload.instrument, version },
  });

  return { instrument: payload.instrument, version };
}
