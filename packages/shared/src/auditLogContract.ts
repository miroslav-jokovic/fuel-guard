import { z } from "zod";
import { recordId } from "./recordId.js";

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
    const uuid = recordId().safeParse(id);
    if (rest.length || !ts.success || !uuid.success) {
      ctx.addIssue({ code: "custom", message: "Invalid cursor" });
      return z.NEVER;
    }
    return { createdAt: ts.data, id: uuid.data };
  });

/**
 * Which page: the rows OLDER than `before`, the rows NEWER than `after`, or, with neither, the newest
 * page (D-US12).
 *
 * The page is addressed by its cursor, never by a number. The log is evidence: a link to "what it
 * showed" has to reopen the same rows next week, when an auditor or counsel follows it. A page number
 * cannot do that on a log that grows at its newest end, because page 3 today is not page 3 tomorrow.
 * So the cursor is what the page's URL carries, and `after` lets Newer work from a pasted link as
 * well as from a walk.
 *
 * `cursor` is the name `before` had until 2026-10-15. A tab still open on the old page sends it for
 * the minutes of the deploy. It is read as `before` and goes in the release after this one.
 */
export const auditLogQuerySchema = z
  .object({
    /** Prefix of `action`, as typed in the search box ("invite", "anomaly", …). */
    action: z.string().trim().max(100).optional().transform((v) => v || undefined),
    before: cursorSchema.optional(),
    after: cursorSchema.optional(),
    cursor: cursorSchema.optional(),
  })
  .transform(({ cursor, ...q }, ctx) => {
    const before = q.before ?? cursor;
    if (before && q.after) {
      ctx.addIssue({ code: "custom", message: "A page is before one row or after one, not both" });
      return z.NEVER;
    }
    return { action: q.action, before, after: q.after };
  });
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

/**
 * One page, newest first. No total, by Q-SET5: counting the org's rows was a sequential scan of the
 * whole 1.2 GB table on every load and every keystroke (measured 2026-09-30: 3.2 s warm, 36.9 s cold).
 * The pager only needs to know whether there is more on either side.
 *
 * `hasNext` / `nextCursor` are the OLDER side (their names from before D-US12, kept so an open tab on
 * the old page still pages). `hasNewer` / `newerCursor` are the side D-US12 added.
 */
export const auditLogPageSchema = z.object({
  rows: z.array(auditLogRowSchema),
  hasNext: z.boolean(),
  nextCursor: z.string().nullable(),
  hasNewer: z.boolean(),
  newerCursor: z.string().nullable(),
});
export type AuditLogPage = z.infer<typeof auditLogPageSchema>;

export const auditLogCursor = (row: Pick<AuditLog, "created_at" | "id">): string => `${row.created_at}|${row.id}`;
