import { z } from "zod";

/** Organization settings (profile, operating hours, notifications). */
export interface OrgSettings {
  id: string;
  name: string;
  allowed_domains: string[];
  operating_hours: { start: string; end: string; tz: string };
  notification_emails: string[];
  notifications_enabled: boolean;
}

const timeHHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24h)");

export const orgSettingsFormSchema = z.object({
  name: z.string().trim().min(1).max(120),
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
