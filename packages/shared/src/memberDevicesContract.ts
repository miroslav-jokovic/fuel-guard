import { z } from "zod";
import { recordId } from "./recordId.js";

/**
 * Signed-in devices, remembered (INSTALLED-APP-PLAN IA-S6; the owner's rulings of 2026-11-16, Q-IA14 … Q-IA19;
 * migration 0620).
 *
 * The numbers are the owner's, in one place, for the API that enforces them and the apps that explain them.
 */

/** At most this many devices hold a place at once, for everybody (Q-IA15) — fixed, not a company setting (Q-IA16). */
export const DEVICE_LIMIT = 3;

/**
 * A device not seen for this long has lost its place (0620's `p_idle_hours`). The owner ruled the 12-hour
 * inactivity sign-out (Q-IA2) and it is Supabase's dashboard setting — ⚠ which no code can read, so this is a
 * restatement of it, labelled as one: if the dashboard value is ever changed, this changes with it.
 */
export const SESSION_IDLE_HOURS = 12;

/** Devices and their addresses are kept this long after they were last seen (Q-IA17), then pruned. */
export const DEVICE_HISTORY_DAYS = 365;

/**
 * The header each app sends its own device key in. The key is random, made once per install and kept on the
 * device; it names nothing and proves nothing — it only lets the PC that signs out on Friday and in on Monday
 * be one device, not two. The database binds a session to one device at first sight, so a key sent later on
 * the same session is ignored.
 */
export const DEVICE_KEY_HEADER = "x-silvicom-device";

/**
 * The key's alphabet and length. 0620 checks the same pattern and treats anything else as no key. Each app
 * makes its own (32 hex characters of a random UUID) with its own platform's randomness — this package has
 * none, by design (it is shared with code that must not use clocks or randomness).
 */
export const DEVICE_KEY_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export const deviceAddressSchema = z.object({
  ip: z.string(),
  first_seen_at: z.string(),
  last_seen_at: z.string(),
});
export type DeviceAddress = z.infer<typeof deviceAddressSchema>;

export const memberDeviceSchema = z.object({
  id: recordId(),
  /** "Chrome on Windows" — `sessionDeviceLabel` of the user agent Supabase recorded. */
  device: z.string(),
  first_seen_at: z.string(),
  last_seen_at: z.string(),
  /** Holding one of the places now: its session exists and the API saw it within `SESSION_IDLE_HOURS`. */
  signed_in: z.boolean(),
  /** The session to end to sign it out; null when it is not signed in. An id, never a token. */
  session_id: recordId().nullable(),
  /** The device this very request comes from. */
  current: z.boolean(),
  /** Every address it was seen from, the most recent first. */
  addresses: z.array(deviceAddressSchema),
});
export type MemberDevice = z.infer<typeof memberDeviceSchema>;

export const memberDevicesResponseSchema = z.object({
  devices: z.array(memberDeviceSchema),
  limit: z.number().int().positive(),
  history_days: z.number().int().positive(),
});
export type MemberDevicesResponse = z.infer<typeof memberDevicesResponseSchema>;
