import { z } from "zod";
import { INVITE_TTL_DAYS_DEFAULT, INVITE_TTL_DAYS_MAX } from "./applicationIntake.js";
import { STALE_DRAFT_HOURS } from "./applicationNudge.js";

/**
 * The carrier's own answers about an application link's lifetime and its reminder
 * (APPLICATION-FLOW-V2-PLAN.md S2, Q-AW41 ruled (a) by the owner 2026-09-28; the table is 0379).
 *
 * ── THE DEFAULTS ARE THE CONSTANTS, AND ONLY THE CONSTANTS ────────────────────────────────────
 * An org that has never saved has no row, and reads `RECRUITING_SETTINGS_DEFAULTS`, which is built from
 * `INVITE_TTL_DAYS_DEFAULT` and `STALE_DRAFT_HOURS` rather than restating 14 and 48. 0379's columns carry
 * no default for the same reason: one home for each number.
 *
 * ── THE BOUNDS ARE 0379's, AND THE MATRIX KEEPS THEM THE SAME ─────────────────────────────────
 * 1–`INVITE_TTL_DAYS_MAX` days, 24–1440 hours, and the delay must come before the link dies (the sweep
 * skips an expired invitation, so a later one is a setting that does nothing). Checked here so the screen
 * and the api refuse with a sentence; checked again by the database, which is the one that cannot be
 * skipped.
 *
 * ── THE DELAY IS NOT ONLY THE REMINDER'S (C-AL1, Q-AW50 ruled by the owner 2026-09-29) ──────────
 * `reminder_after_hours` is when the sweep counts a driver as stopped: it times the driver's reminder AND
 * the office's alert, and the alert still fires with reminders switched off. So the delay-before-expiry
 * rule holds in BOTH states — with reminders off, a delay past the link's life was an alert that never
 * came. 0379's CHECK only binds it while reminders are on; this contract is the stricter of the two on
 * purpose (production had 0 rows when it tightened, 2026-09-29, so nothing saved became invalid).
 *
 * The 72 hours a phone keeps unsent answers (Q-AW39) is NOT here: it is a privacy rule, not a setting.
 */
export const REMINDER_AFTER_HOURS_MIN = 24;
export const REMINDER_AFTER_HOURS_MAX = 1440;

export const recruitingSettingsSchema = z
  .object({
    invite_ttl_days: z.number().int().min(1).max(INVITE_TTL_DAYS_MAX),
    reminders_enabled: z.boolean(),
    reminder_after_hours: z.number().int().min(REMINDER_AFTER_HOURS_MIN).max(REMINDER_AFTER_HOURS_MAX),
  })
  .refine((s) => s.reminder_after_hours < s.invite_ttl_days * 24, {
    path: ["reminder_after_hours"],
    message: "A driver must count as stopped before the link expires. Make the delay shorter or the link last longer.",
  });
export type RecruitingSettings = z.infer<typeof recruitingSettingsSchema>;

export const RECRUITING_SETTINGS_DEFAULTS: RecruitingSettings = {
  invite_ttl_days: INVITE_TTL_DAYS_DEFAULT,
  reminders_enabled: true,
  reminder_after_hours: STALE_DRAFT_HOURS,
};

/** `GET /api/recruitment/settings` — what is in force, and whether the carrier has ever chosen it. */
export interface RecruitingSettingsView {
  settings: RecruitingSettings;
  /** True while no row exists: the product's defaults are in force. */
  isDefault: boolean;
  updatedAt: string | null;
}
