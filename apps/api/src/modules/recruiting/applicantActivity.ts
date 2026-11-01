import type { SupabaseClient } from "@supabase/supabase-js";
import {
  APPLICANT_DISPOSITION_LABELS,
  AUTHORIZATION_PURPOSE_LABELS,
  DQ_KIND_LABELS,
  TRAVEL_MODE_LABELS,
  fetchAllPaged,
  fetchAllPagedIn,
  orderApplicantActivity,
  type ApplicantActivityEdit,
  type ApplicantActivityItem,
  type ApplicantDispositionOutcome,
  type AuthorizationPurpose,
  type TravelMode,
} from "@silvicom/shared";
import { labelOf, memberLabels } from "../../lib/memberLabels.js";
import { pspOrdersFor } from "../psp/index.js";
import type { SmsTemplate } from "./smsOutbox.js";

/**
 * Everything that has happened on one applicant, as a dated list — HIRING-WORKFLOW-AUDIT-2026-10-31
 * §8.2 and §9 P10.
 *
 * ── DERIVED, NEVER STORED ──────────────────────────────────────────────────────────────────────
 * §8.2 measured the gap: nowhere on the record says what has happened. Every fact the list needs is
 * already a row written for its own reason — an invitation's phase stamps, a signed permission, a
 * filed §391.51 record, a PSP order, an outbox text, an edit-log row (0337), a trip, a decision, a
 * note. So the list is folded from those rows at read time and nothing is written: an activity table
 * would be a second record of the same events, and the day a writer forgot it the two would disagree
 * about what happened to a person.
 *
 * ── ONE APPLICANT, ONE READ PER TABLE, ORG-SCOPED ─────────────────────────────────────────────
 * ⚠ The service role bypasses RLS: every read carries its own `.eq("org_id", …)` (`expectOrgScoped`
 * in `routes/notes.test.ts`). Reads keyed on the applicant's invitations go through
 * `fetchAllPagedIn` — fifty ids per `.in()`, every chunk paged past PostgREST's 1,000-row answer — and
 * the per-driver reads page too, because an outbox or an edit log that stopped at its thousandth row
 * would read as a complete history.
 *
 * ── WHAT IT CANNOT SAY, AND WHY ───────────────────────────────────────────────────────────────
 * ⚠ "Every SMS in" is what is ON FILE: an inbound STOP and START (the suppression rows) and a consent
 * given or withdrawn. The body of any other inbound text is not stored anywhere (`handleInboundSms`
 * acts on keywords and keeps nothing else), and the applicant's own "text me the link" send
 * (`publicApplicationSms.ts`) writes no row — so neither can be derived, and neither is invented here.
 */

/** What each outbox template is, in the office's words — total over `SMS_TEMPLATES` by the type. */
const TEXT_LABELS: Record<SmsTemplate, string> = {
  consent_confirm: "texts turned on",
  application_approved: "application approved",
  drug_test_site: "where to take the drug test",
  application_sent: "the application link",
  nudge: "a reminder to finish",
  signing_link: "the link to sign",
  invite: "the invitation link",
};

type Invitation = {
  id: string; created_at: string; created_by: string | null; intake_completed_at: string | null;
  application_sent_at: string | null; review_requested_at: string | null; approved_at: string | null;
  submitted_at: string | null; revoked_at: string | null;
};
/** A table, as `admin.from("<literal>")` — see `byDriver`. */
type Table = () => ReturnType<SupabaseClient["from"]>;
type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
/** supabase-js types a select parsed from a string as an error type; the row type is the column list above it. */
const page = <T>(q: unknown): Page<T> => q as Page<T>;

/** The applicant's activity, newest first. Throws on a failed read — the route answers 500. */
export async function applicantActivity(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<ApplicantActivityItem[]> {
  // Each reader is handed `() => admin.from("<literal>")` rather than a table name, so every table read
  // here stays a literal the table gates can see (`lint:table-access` refuses a dynamic `.from`).
  const byDriver = <T>(table: Table, cols: string) =>
    fetchAllPaged<T>((from, to) =>
      page<T>(table().select(cols).eq("org_id", orgId).eq("driver_id", driverId).order("id").range(from, to)),
    );

  const invitations = await byDriver<Invitation>(
    () => admin.from("application_invitations"),
    "id, created_at, created_by, intake_completed_at, application_sent_at, review_requested_at, approved_at, submitted_at, revoked_at",
  );
  const invitationIds = invitations.map((i) => i.id);
  const byInvitation = <T>(table: Table, cols: string) =>
    fetchAllPagedIn<T>(invitationIds, (chunk) => (from, to) =>
      page<T>(table().select(cols).eq("org_id", orgId).in("invitation_id", chunk).order("id").range(from, to)),
    );

  const [auths, records, psp, texts, consents, suppressions, edits, drafts, trips, decisions, notes] = await Promise.all([
    byDriver<{ purpose: AuthorizationPurpose; accepted_at: string; revokes: string | null; recorded_by: string | null }>(
      () => admin.from("driver_authorizations"), "id, purpose, accepted_at, revokes, recorded_by"),
    byDriver<{ kind: string; created_at: string; created_by: string | null }>(() => admin.from("qualification_records"), "kind, created_at, created_by"),
    pspOrdersFor(admin, orgId, driverId),
    byDriver<{ template: SmsTemplate; status: string; created_at: string; sent_at: string | null; failed_at: string | null }>(
      () => admin.from("sms_outbox"), "template, status, created_at, sent_at, failed_at"),
    byDriver<{ source: string; granted_at: string; revoked_at: string | null; revoked_reason: string | null }>(
      () => admin.from("sms_consents"), "source, granted_at, revoked_at, revoked_reason"),
    byDriver<{ reason: string; created_at: string; lifted_at: string | null }>(() => admin.from("sms_suppressions"), "reason, created_at, lifted_at"),
    byInvitation<{ path: Array<string | number>; before: unknown; after: unknown; edited_by: string | null; edited_at: string }>(
      () => admin.from("application_edits"), "path, before, after, edited_by, edited_at"),
    byInvitation<{ employers: unknown }>(() => admin.from("application_drafts"), "employers:payload->employers"),
    byInvitation<{ mode: TravelMode; depart_at: string; booked_by: string; cancelled_at: string | null; created_at: string }>(
      () => admin.from("applicant_travel"), "mode, depart_at, booked_by, cancelled_at, created_at"),
    byDriver<{ outcome: ApplicantDispositionOutcome; decided_on: string; decided_by: string | null; created_at: string }>(
      () => admin.from("applicant_dispositions"), "outcome, decided_on, decided_by, created_at"),
    byDriver<{ author_name: string; created_at: string }>(() => admin.from("applicant_notes"), "author_name, created_at"),
  ]);

  const actorIds = [
    ...invitations.map((i) => i.created_by), ...auths.map((a) => a.recorded_by), ...records.map((r) => r.created_by),
    ...edits.map((e) => e.edited_by), ...trips.map((t) => t.booked_by), ...decisions.map((d) => d.decided_by),
  ].filter((id): id is string => Boolean(id));
  const people = await memberLabels(admin, orgId, actorIds);
  const who = (id: string | null) => (id ? (labelOf(people.get(id)) ?? "An office user") : null);

  const items: ApplicantActivityItem[] = [];
  const add = (at: string | null | undefined, kind: ApplicantActivityItem["kind"], text: string, actor: string | null = null) => {
    if (at) items.push({ at, kind, text, actor });
  };

  for (const i of invitations) {
    add(i.created_at, "invited", "Invited to apply", who(i.created_by));
    add(i.intake_completed_at, "part_one_finished", "Finished Part 1 of the application");
    add(i.application_sent_at, "application_sent", "Was sent the full application");
    add(i.review_requested_at, "application_finished", "Finished the application and sent it for review");
    add(i.approved_at, "application_approved", "Application approved for signing");
    add(i.submitted_at, "application_signed", "Signed and filed the application");
    add(i.revoked_at, "invitation_withdrawn", "The application link was withdrawn");
  }
  for (const a of auths) {
    const label = AUTHORIZATION_PURPOSE_LABELS[a.purpose] ?? a.purpose;
    if (a.revokes) add(a.accepted_at, "permission_withdrawn", `Withdrew permission: ${label}`, who(a.recorded_by));
    else add(a.accepted_at, "permission_signed", `Signed permission: ${label}`, who(a.recorded_by));
  }
  for (const r of records) add(r.created_at, "record_filed", `Filed: ${DQ_KIND_LABELS[r.kind] ?? r.kind}`, who(r.created_by));
  for (const p of psp) add(p.created_at, "psp_ordered", "PSP record ordered");
  for (const t of texts) {
    const what = TEXT_LABELS[t.template] ?? "a text";
    if (t.status === "sent" || t.status === "delivered") add(t.sent_at ?? t.created_at, "text_out", `Texted ${what}`);
    else if (t.status === "failed") add(t.failed_at ?? t.created_at, "text_out", `A text did not go through: ${what}`);
    else if (t.status === "queued" || t.status === "sending") add(t.created_at, "text_out", `Text waiting for daytime hours: ${what}`);
    else add(t.created_at, "text_out", `A text was not sent: ${what}`);
  }
  for (const c of consents) {
    add(c.granted_at, "texts_agreed", c.source === "office_invite" ? "Asked the office to text them the application" : "Agreed to receive texts");
    // A STOP by text is the suppression row's to say (below); saying it twice would read as two acts.
    if (!(c.revoked_reason ?? "").startsWith("inbound:")) add(c.revoked_at, "texts_stopped", "Texts turned off");
  }
  for (const s of suppressions.filter((x) => x.reason === "stop")) {
    add(s.created_at, "texts_stopped", "Texted STOP — no more texts");
    add(s.lifted_at, "texts_agreed", "Texted START — texts back on");
  }
  const names = employerNames(drafts, edits);
  for (const e of edits) {
    items.push({
      at: e.edited_at, kind: "answer_edited", text: "Changed an answer on the application", actor: who(e.edited_by),
      edit: describeEdit(e, names),
    });
  }
  for (const t of trips) {
    add(t.created_at, "travel_booked", `Travel booked: ${TRAVEL_MODE_LABELS[t.mode] ?? t.mode}`, who(t.booked_by));
    add(t.cancelled_at, "travel_cancelled", "Travel cancelled");
  }
  for (const d of decisions) {
    add(d.created_at, "decision", `Application closed: ${APPLICANT_DISPOSITION_LABELS[d.outcome] ?? d.outcome}`, who(d.decided_by));
  }
  for (const n of notes) add(n.created_at, "note_added", "Added a note", n.author_name);

  return orderApplicantActivity(items);
}

type Row = Record<string, unknown>;
const isRow = (v: unknown): v is Row => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Employer key → the name on the application (§9 P5: employer paths name the row by its `key`). From
 * the live drafts, and from the edit log's own add/remove rows — a job the office removed is no longer
 * in any draft, and the removal's `before` is the only place its name survives.
 */
function employerNames(drafts: ReadonlyArray<{ employers: unknown }>, edits: ReadonlyArray<{ before: unknown; after: unknown }>): Map<string, string> {
  const out = new Map<string, string>();
  const take = (e: unknown) => {
    if (isRow(e) && typeof e.key === "string" && typeof e.employer_name === "string" && e.employer_name.trim()) {
      out.set(e.key, e.employer_name.trim());
    }
  };
  for (const d of drafts) if (Array.isArray(d.employers)) d.employers.forEach(take);
  for (const e of edits) { take(e.before); take(e.after); }
  return out;
}

const blank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

function describeEdit(
  e: { path: Array<string | number>; before: unknown; after: unknown },
  names: Map<string, string>,
): ApplicantActivityEdit {
  const path = Array.isArray(e.path) ? e.path : [];
  const employer = path[0] === "employers" && path.length >= 2 ? (names.get(String(path[1])) ?? null) : null;
  // A whole job: the path stops at its key (`applyApplicationEdit`'s add_employer / remove_employer).
  const wholeJob = path[0] === "employers" && path.length === 2;
  const change: ApplicantActivityEdit["change"] = wholeJob
    ? (blank(e.after) ? "removed" : "added")
    : blank(e.before) ? "filled" : blank(e.after) ? "cleared" : "changed";
  return { path, change, employer };
}
