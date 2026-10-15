import { z } from "zod";

/**
 * The one schema for a record's id: every `uuid` column the API reads or writes by id (D-US13).
 *
 * ── WHY `z.guid()` AND NOT `z.uuid()` ─────────────────────────────────────────────────────────
 * Zod 4's `z.uuid()` is RFC 9562 strict: the version nibble must be 1–8 and the variant 8/9/a/b.
 * Postgres's `uuid` type is not. It stores any 128 bits written 8-4-4-4-12 in hex, and Postgres
 * is the authority on what an id is. So a contract built on `z.uuid()` refused ids our own
 * database holds. Staging's org is `00000000-0000-0000-0000-0000000000a1` (version nibble 0),
 * which made Driver Qualification's carrier records answer 400 on staging only (UI-standardization
 * US6b F31). The same id is in the seed and in the PGlite matrices, and `docs/11-DEPLOYMENT.md`
 * Stage 2 prescribes it for bootstrapping a real carrier. Re-keying staging was considered and
 * refused: it would hide the bug, not remove it.
 *
 * `z.guid()` checks exactly what the column stores, so a malformed id is still a 400 here, before
 * the database would turn it into a 500. A contract can be strict about what a field MEANS; it
 * cannot be stricter than the database about how an id is SPELLED.
 *
 * Every id site reads this; `lint:record-id` refuses a bare `z.uuid()` / `z.guid()` /
 * `.uuid()` anywhere else, so the next contract cannot restate it.
 *
 * `message` is the sentence a form shows when the field is blank or not an id ("Select a vehicle").
 */
export function recordId(message?: string) {
  return message === undefined ? z.guid() : z.guid(message);
}

const ANY_RECORD_ID = recordId();

/**
 * The same rule as a predicate, for a value that is filtered or routed rather than parsed: an id
 * list from a query string, a path segment named `:id` in the request metrics, an audit row's entity.
 * Eleven API files each held their own copy of this regex before D-US13; a copy is a second
 * definition that can drift from the first.
 */
export function isRecordId(value: unknown): boolean {
  return ANY_RECORD_ID.safeParse(value).success;
}
