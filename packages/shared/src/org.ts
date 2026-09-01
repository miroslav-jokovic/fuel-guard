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
  allowed_domains: z.array(z.string().trim().toLowerCase().min(1)).default([]),
  operating_hours: z.object({
    start: timeHHMM,
    end: timeHHMM,
    tz: z.string().min(1),
  }),
  notifications_enabled: z.boolean(),
  notification_emails: z.array(z.email()),
});
export type OrgSettingsForm = z.infer<typeof orgSettingsFormSchema>;

/** An audit log row as the viewer reads it. */
export interface AuditLog {
  id: string;
  org_id: string;
  actor_id: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  meta: Record<string, unknown>;
  created_at: string;
}
