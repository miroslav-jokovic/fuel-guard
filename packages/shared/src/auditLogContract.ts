import { z } from "zod";

/**
 * The Audit log screen's read, through the API (SETTINGS-PERMISSIONS-PLAN.md SP4).
 *
 * Until SP4 the page read `audit_logs` straight through PostgREST, and the `audit_select` policy —
 * `auth_role() in ('admin','auditor')` — decided who got rows. That is a ROLE test the Permissions
 * page cannot answer: a fleet manager the admin gave the Audit log opened it and saw an empty table.
 * The same bug SP2 fixed for the saves. The read now asks what the screen asks, and this is the
 * shape both sides agree on.
 */

/** An audit log row as the viewer reads it. */
export const auditLogRowSchema = z.object({
  id: z.string(),
  org_id: z.string(),
  actor_id: z.string().nullable(),
  action: z.string(),
  entity: z.string().nullable(),
  entity_id: z.string().nullable(),
  meta: z.record(z.string(), z.unknown()),
  created_at: z.string(),
});
export type AuditLog = z.infer<typeof auditLogRowSchema>;

export const AUDIT_LOG_PAGE_SIZE = 50;

/**
 * The keyset cursor: the last row's `created_at|id`, the page's own sort key. Opaque to the page,
 * which only hands back what the previous page gave it.
 *
 * ⚠ Parsed to a timestamp and a uuid, never passed through. The API interpolates both into a
 * PostgREST `or=` filter, where a `,` or a `)` in either half would rewrite the filter itself — the
 * browser used to build that string from whatever the cursor held.
 */
const cursorSchema = z
  .string()
  .transform((raw, ctx) => {
    const [createdAt = "", id = "", ...rest] = raw.split("|");
    const ts = z.iso.datetime({ offset: true }).safeParse(createdAt);
    const uuid = z.uuid().safeParse(id);
    if (rest.length || !ts.success || !uuid.success) {
      ctx.addIssue({ code: "custom", message: "Invalid cursor" });
      return z.NEVER;
    }
    return { createdAt: ts.data, id: uuid.data };
  });

export const auditLogQuerySchema = z.object({
  /** Prefix of `action`, as typed in the search box ("invite", "anomaly", …). */
  action: z.string().trim().max(100).optional().transform((v) => v || undefined),
  cursor: cursorSchema.optional(),
});
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

/**
 * One page. No total, by Q-SET5: counting the org's rows was a sequential scan of the whole 1.2 GB
 * table on every load and every keystroke (measured 2026-09-30: 3.2 s warm, 36.9 s cold), and the
 * pager only ever needed to know whether there is a next page.
 */
export const auditLogPageSchema = z.object({
  rows: z.array(auditLogRowSchema),
  hasNext: z.boolean(),
  nextCursor: z.string().nullable(),
});
export type AuditLogPage = z.infer<typeof auditLogPageSchema>;

export const auditLogCursor = (row: Pick<AuditLog, "created_at" | "id">): string => `${row.created_at}|${row.id}`;
