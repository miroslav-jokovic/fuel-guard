import { z } from "zod";

/** Organization settings (profile, operating hours, notifications). */
export interface OrgSettings {
  id: string;
  name: string;
  /** USDOT number as issued by FMCSA. Printed on the driver-qualification binder cover (D-BD5). */
  dot_number: string | null;
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
