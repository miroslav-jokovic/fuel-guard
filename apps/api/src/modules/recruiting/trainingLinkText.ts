import type { SupabaseClient } from "@supabase/supabase-js";
import { smsOrientationVideos } from "@silvicom/shared";
import type { Env } from "../../env.js";
import { smsConfigured } from "../../lib/sms.js";
import { sendApplicationSms, smsConsentStatus } from "./applicationSms.js";

/**
 * Texting an APPLICANT their safety-training link (SAFETY-VIDEOS-AND-QUIZZES-ANALYSIS D-TR11).
 *
 * The training module may not import recruiting (lint:boundaries), and only recruiting may text: the
 * number is verified for applicant texts and the only consent is the applicant's (SMS-OPT-IN-PLAN). So
 * recruiting hands the composition root this texter and app.ts passes it to the training router — the
 * medstop precedent. Orientation videos are part of the application, so the applicants' number and
 * consent cover them; the wording is the existing "videos" text, which the carrier already approved.
 *
 * A HIRED driver is never texted from here: `canText` answers false for anybody whose status is not
 * `applicant`. Texting company drivers waits on a number and a consent of their own (Q-TR9 (a)).
 */
export interface ApplicantTexter {
  canText(admin: SupabaseClient, env: Env, orgId: string, driverId: string, status: string): Promise<{ ok: boolean; reason: string | null }>;
  send(admin: SupabaseClient, env: Env, orgId: string, driverId: string, carrier: string, link: string): Promise<{ ok: boolean; detail: string | null }>;
}

export const applicantTrainingTexter: ApplicantTexter = {
  async canText(admin, env, orgId, driverId, status) {
    if (status !== "applicant") return { ok: false, reason: "Texting hired drivers is not set up yet. Send by email or copy the link." };
    if (!smsConfigured(env)) return { ok: false, reason: "Texting is not set up on this server." };
    const c = await smsConsentStatus(admin, orgId, driverId);
    if (c.state === "stopped") return { ok: false, reason: "They replied STOP to our texts." };
    if (c.state !== "agreed") return { ok: false, reason: "They have not agreed to texts on their application." };
    return { ok: true, reason: null };
  },
  async send(admin, env, orgId, driverId, carrier, link) {
    const out = await sendApplicationSms(admin, env, orgId, driverId, smsOrientationVideos(carrier, link), new Date());
    if (out.sent) return { ok: true, detail: null };
    if ("held" in out) return { ok: false, detail: out.held === "quiet_hours" ? "Held until daytime; send again in the morning." : `Not texted (${out.held.replace("_", " ")}).` };
    return { ok: false, detail: out.failed };
  },
};
