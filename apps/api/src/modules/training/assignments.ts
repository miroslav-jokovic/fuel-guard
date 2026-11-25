import type { SupabaseClient } from "@supabase/supabase-js";
import {
  coveredMs,
  TRAINING_LINK_DAYS,
  trainingLinkPath,
  type TrainingAssign,
  type TrainingAssignmentRow,
  type TrainingReach,
  type TrainingSendOutcome,
  type TrainingSendVia,
} from "@silvicom/shared";
import type { Env } from "../../env.js";
import { sendEmail } from "../../lib/mailer.js";
import { mintLinkToken } from "./media.js";
import { refuse, type TrainingRefusal } from "./refusal.js";
import { ASSIGNMENT_COLS, standings, type AssignmentRow } from "./standing.js";

/**
 * Sending films to drivers, and the office's view of how they are doing (D-TR3, D-TR11).
 *
 * ── HOW A LINK REACHES A DRIVER (D-TR11) ───────────────────────────────────────────────────────
 *   · An applicant who agreed to texts → a text, on the applicants' number and consent (the texter
 *     recruiting hands in; this module never texts by itself).
 *   · Anybody with an email address → an email.
 *   · Otherwise → the office gets the link to copy and send themselves. This is also every hired
 *     driver without email until a driver-operations number and consent exist (Q-TR9 (a)).
 * The link is in the response ONLY for "copy": a link that went by text or email exists in that
 * message and nowhere else, as the applicant links do.
 */

export interface TrainingTexter {
  canText(admin: SupabaseClient, env: Env, orgId: string, driverId: string, status: string): Promise<{ ok: boolean; reason: string | null }>;
  send(admin: SupabaseClient, env: Env, orgId: string, driverId: string, carrier: string, link: string): Promise<{ ok: boolean; detail: string | null }>;
}

interface DriverRow { id: string; full_name: string | null; email: string | null; phone: string | null; status: string }

const fail = (what: string, e: { message: string }): never => {
  throw new Error(`[training] ${what}: ${e.message}`);
};

async function driversOf(admin: SupabaseClient, orgId: string, ids: readonly string[]): Promise<DriverRow[]> {
  const { data, error } = await admin.from("drivers").select("id, full_name, email, phone, status").eq("org_id", orgId).in("id", [...ids]);
  if (error) fail("drivers not read", error);
  return (data ?? []) as DriverRow[];
}

async function carrierName(admin: SupabaseClient, orgId: string): Promise<string> {
  const { data } = await admin.from("organizations").select("name").eq("id", orgId).maybeSingle();
  return ((data as { name: string } | null)?.name ?? "Your carrier").trim();
}

/** How each driver can be reached, for the Send tab's "Can we text?" column. */
export async function reachOf(admin: SupabaseClient, env: Env, texter: TrainingTexter, orgId: string, driverIds: readonly string[]): Promise<Record<string, TrainingReach>> {
  const out: Record<string, TrainingReach> = {};
  for (const d of await driversOf(admin, orgId, driverIds)) {
    const t = d.phone ? await texter.canText(admin, env, orgId, d.id, d.status) : { ok: false, reason: "No phone number on file." };
    out[d.id] = { sms: t.ok, smsReason: t.reason, email: d.email?.trim() || null };
  }
  return out;
}

export function trainingEmail(carrier: string, firstName: string, courseTitle: string, link: string, dueOn: string | null) {
  const due = dueOn ? ` Please finish by ${dueOn}.` : "";
  const text =
    `Hi ${firstName},\n\n${carrier} has sent you safety videos: ${courseTitle}. Each one is a few minutes, with a short quiz after it.${due}\n\n` +
    `Watch them only when you are parked:\n${link}\n\nThe link is yours; please do not share it.\n`;
  const html =
    `<p>Hi ${esc(firstName)},</p><p>${esc(carrier)} has sent you safety videos: <b>${esc(courseTitle)}</b>. Each one is a few minutes, with a short quiz after it.${esc(due)}</p>` +
    `<p><a href="${esc(link)}" style="display:inline-block;padding:12px 18px;background:#1f4e8c;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Open my safety videos</a></p>` +
    `<p>Watch them only when you are parked. The link is yours; please do not share it.</p>`;
  return { subject: `${carrier}: your safety videos`, text, html };
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Send a course (or some of its films) to drivers: one assignment and one link each. */
export async function assign(
  admin: SupabaseClient,
  env: Env,
  texter: TrainingTexter,
  orgId: string,
  userId: string,
  body: TrainingAssign,
): Promise<TrainingSendOutcome[] | TrainingRefusal> {
  const { data: course, error: ce } = await admin.from("training_courses").select("id, title, retired_at").eq("org_id", orgId).eq("id", body.courseId).maybeSingle();
  if (ce) fail("course not read", ce);
  if (!course || (course as { retired_at: string | null }).retired_at) return refuse(404, "not_found", "No such course.");
  if (body.lessonIds) {
    const { data: ls, error } = await admin.from("training_lessons").select("id").eq("org_id", orgId).eq("course_id", body.courseId).in("id", body.lessonIds);
    if (error) fail("films not read", error);
    if ((ls ?? []).length !== new Set(body.lessonIds).size) return refuse(422, "lessons", "One of the picked films is not in this course.");
  }
  const drivers = await driversOf(admin, orgId, body.driverIds);
  if (drivers.length !== new Set(body.driverIds).size) return refuse(404, "not_found", "One of the picked drivers is not in this company.");
  const carrier = await carrierName(admin, orgId);
  const title = (course as { title: string }).title;
  const out: TrainingSendOutcome[] = [];
  for (const d of drivers) {
    const { token, hash } = mintLinkToken();
    const { data: row, error } = await admin
      .from("training_assignments")
      .insert({
        org_id: orgId,
        driver_id: d.id,
        course_id: body.courseId,
        lesson_ids: body.lessonIds,
        due_on: body.dueOn,
        token_hash: hash,
        link_expires_at: new Date(Date.now() + TRAINING_LINK_DAYS * 86_400_000).toISOString(),
        created_by: userId,
      })
      .select("id")
      .single();
    if (error || !row) fail("assignment not made", error ?? { message: "no row" });
    out.push(await deliver(admin, env, texter, orgId, (row as { id: string }).id, d, carrier, title, body.dueOn, token));
  }
  return out;
}

/** Deliver one link by the best way open, and stamp how it went. */
async function deliver(
  admin: SupabaseClient,
  env: Env,
  texter: TrainingTexter,
  orgId: string,
  assignmentId: string,
  d: DriverRow,
  carrier: string,
  courseTitle: string,
  dueOn: string | null,
  token: string,
): Promise<TrainingSendOutcome> {
  const link = `${env.WEB_APP_URL.replace(/\/+$/, "")}${trainingLinkPath(token)}`;
  let via: TrainingSendVia = "copy";
  const ok = true;
  let detail: string | null = null;
  const text = d.phone ? await texter.canText(admin, env, orgId, d.id, d.status) : { ok: false, reason: null };
  if (text.ok) {
    const r = await texter.send(admin, env, orgId, d.id, carrier, link);
    if (r.ok) via = "sms";
    else detail = r.detail;
  }
  if (via === "copy" && d.email?.trim()) {
    const first = (d.full_name ?? "").trim().split(/\s+/)[0] || "there";
    const r = await sendEmail(env, { to: [d.email.trim()], ...trainingEmail(carrier, first, courseTitle, link, dueOn) });
    if (r.ok) via = "email";
    else detail = detail ?? `Email not sent${r.detail ? `: ${r.detail}` : ""}.`;
  }
  const { error } = await admin
    .from("training_assignments")
    .update({ last_sent_at: new Date().toISOString(), last_sent_via: via })
    .eq("org_id", orgId)
    .eq("id", assignmentId);
  if (error) fail("send not recorded", error);
  return { driverId: d.id, assignmentId, via, ok, detail, link: via === "copy" ? link : null };
}

/** Send again: a NEW link replaces the old one (the old one stops working), delivered the same way. */
export async function resend(admin: SupabaseClient, env: Env, texter: TrainingTexter, orgId: string, assignmentId: string): Promise<TrainingSendOutcome | TrainingRefusal> {
  const { data, error } = await admin.from("training_assignments").select(`${ASSIGNMENT_COLS}`).eq("org_id", orgId).eq("id", assignmentId).maybeSingle();
  if (error) fail("assignment not read", error);
  const a = data as AssignmentRow | null;
  if (!a) return refuse(404, "not_found", "No such assignment.");
  if (a.revoked_at) return refuse(409, "revoked", "This link was cancelled. Send the training again.");
  const [d] = await driversOf(admin, orgId, [a.driver_id]);
  if (!d) return refuse(404, "not_found", "The driver is no longer in this company.");
  const { token, hash } = mintLinkToken();
  const { error: ue } = await admin
    .from("training_assignments")
    .update({ token_hash: hash, link_expires_at: new Date(Date.now() + TRAINING_LINK_DAYS * 86_400_000).toISOString() })
    .eq("org_id", orgId)
    .eq("id", assignmentId);
  if (ue) fail("link not replaced", ue);
  const { data: c } = await admin.from("training_courses").select("title").eq("org_id", orgId).eq("id", a.course_id).maybeSingle();
  return deliver(admin, env, texter, orgId, assignmentId, d, await carrierName(admin, orgId), (c as { title: string } | null)?.title ?? "Safety training", a.due_on, token);
}

export async function revoke(admin: SupabaseClient, orgId: string, userId: string, assignmentId: string): Promise<true | TrainingRefusal> {
  const { data, error } = await admin
    .from("training_assignments")
    .update({ revoked_at: new Date().toISOString(), revoked_by: userId })
    .eq("org_id", orgId)
    .eq("id", assignmentId)
    .is("revoked_at", null)
    .select("id");
  if (error) fail("not cancelled", error);
  return (data ?? []).length ? true : refuse(409, "revoked", "This link is already cancelled, or does not exist.");
}

/** The Progress tab: every assignment, newest first, with each film's status, watch time and best quiz. */
export async function progressRows(admin: SupabaseClient, orgId: string): Promise<TrainingAssignmentRow[]> {
  const { data, error } = await admin.from("training_assignments").select(ASSIGNMENT_COLS).eq("org_id", orgId).order("created_at", { ascending: false }).limit(500);
  if (error) fail("assignments not read", error);
  const rows = (data ?? []) as AssignmentRow[];
  if (!rows.length) return [];
  const [stand, drivers, courses] = await Promise.all([
    standings(admin, orgId, rows),
    driversOf(admin, orgId, [...new Set(rows.map((r) => r.driver_id))]),
    admin.from("training_courses").select("id, title").eq("org_id", orgId),
  ]);
  if (courses.error) fail("courses not read", courses.error);
  const names = new Map(drivers.map((d) => [d.id, d.full_name ?? "Unnamed driver"]));
  const titles = new Map(((courses.data ?? []) as Array<{ id: string; title: string }>).map((c) => [c.id, c.title]));
  return rows.map((a) => {
    const films = stand.get(a.id) ?? [];
    return {
      id: a.id,
      driverId: a.driver_id,
      driverName: names.get(a.driver_id) ?? "Unnamed driver",
      courseId: a.course_id,
      courseTitle: titles.get(a.course_id) ?? "",
      sentAt: a.last_sent_at ?? a.created_at,
      lastSentVia: a.last_sent_via,
      dueOn: a.due_on,
      firstOpenedAt: a.first_opened_at,
      completedAt: a.completed_at,
      revokedAt: a.revoked_at,
      lessons: films.map((f) => {
        const submitted = f.attempts.filter((x) => x.submitted_at);
        const best = submitted.reduce<{ correct: number; total: number } | null>(
          (b, x) => (!b || (x.correct ?? 0) > b.correct ? { correct: x.correct ?? 0, total: x.served.length } : b),
          null,
        );
        return {
          lessonId: f.lessonId,
          title: f.title,
          status: f.status,
          watchedMs: coveredMs(f.progress?.watched ?? [], 0, f.version.duration_ms),
          durationMs: f.version.duration_ms,
          best,
          attempts: submitted.length,
        };
      }),
    };
  });
}
