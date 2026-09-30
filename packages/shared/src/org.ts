import { z } from "zod";

/** Organization settings (profile, operating hours, notifications). */
export interface OrgSettings {
  id: string;
  name: string;
  /** USDOT number as issued by FMCSA. Printed on the driver-qualification binder cover (D-BD5). */
  dot_number: string | null;
  /** The carrier's address (0282) — §396.21(a)(2) on the inspection report, §396.17(c)(2) on the decal. */
  address_line1: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  allowed_domains: string[];
  operating_hours: { start: string; end: string; tz: string };
  notification_emails: string[];
  notifications_enabled: boolean;
}

const timeHHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24h)");

export const orgSettingsFormSchema = z.object({
  name: z.string().trim().min(1).max(120),
  // Digits only, up to eight — FMCSA numbers are numeric and a carrier that types "USDOT 1234567"
  // should be told so here rather than have the prefix printed on every binder cover. Empty is
  // allowed and means "not recorded", which the cover then says in as many words.
  dot_number: z
    .string()
    .trim()
    .regex(/^\d{1,8}$/, "Use digits only, as issued by FMCSA")
    .or(z.literal(""))
    .nullish(),
  /**
   * The carrier's own address (0282), beside `dot_number` because it is the same kind of fact and
   * printed for the same kind of reader.
   *
   * §396.21(a)(2) requires the annual inspection report to identify the motor carrier, and
   * §396.17(c)(2) requires the decal on the vehicle to name the address WHERE THE REPORT IS
   * MAINTAINED — an officer's route from a sticker on a truck to a filing cabinet. Empty means "not
   * recorded", and the inspection refuses to certify rather than printing a blank carrier block.
   */
  address_line1: z.string().trim().max(200).or(z.literal("")).nullish(),
  city: z.string().trim().max(100).or(z.literal("")).nullish(),
  state: z.string().trim().max(20).or(z.literal("")).nullish(),
  postal_code: z.string().trim().max(20).or(z.literal("")).nullish(),
  /**
   * The invitation allowlist: when non-empty, an invite to any other domain is refused at creation
   * AND at acceptance (`isEmailDomainAllowed`). Shaped as a bare domain because a stored entry is
   * compared to the email's domain part exactly — "@example.com" or "https://example.com" would
   * match nobody and so refuse every invitation, which is the worst way for a typo to fail (Q-SET4).
   */
  allowed_domains: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, "Enter each domain like example.com"),
    )
    .default([]),
  operating_hours: z.object({
    start: timeHHMM,
    end: timeHHMM,
    tz: z.string().min(1),
  }),
  notifications_enabled: z.boolean(),
  notification_emails: z.array(z.email()),
});
export type OrgSettingsForm = z.infer<typeof orgSettingsFormSchema>;

/**
 * The two halves of `organizations` that two Settings screens write (SETTINGS-PERMISSIONS-PLAN.md
 * SP2), each behind its own screen's permission. PICKED from the one schema above, not restated.
 *
 * ⚠ Split for more than the permission. Both pages used to send the WHOLE row, each passing the
 * other's fields "through unchanged" — and the Notifications page did not pass the DOT number or
 * the address, which the save wrote as null. Saving Notifications erased them (measured
 * 2026-09-30: production's carrier row held both, one Notifications save from losing them). A
 * page that can only send its own fields cannot erase anybody else's.
 *
 * `allowed_domains` is the Organization screen's. No save wrote it from the initial commit until
 * the owner ruled Q-SET4 (a), 2026-09-30: it saves, and the page says plainly that it refuses
 * invitations to other domains.
 */
export const orgProfileFormSchema = orgSettingsFormSchema.pick({
  name: true,
  allowed_domains: true,
  dot_number: true,
  address_line1: true,
  city: true,
  state: true,
  postal_code: true,
  operating_hours: true,
});
export type OrgProfileForm = z.infer<typeof orgProfileFormSchema>;
export const orgNotificationsFormSchema = orgSettingsFormSchema.pick({
  notifications_enabled: true,
  notification_emails: true,
});
export type OrgNotificationsForm = z.infer<typeof orgNotificationsFormSchema>;

