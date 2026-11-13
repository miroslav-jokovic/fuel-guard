import { Router, type Request } from "express";
import {
  OFFICE_ROLES,
  isRecordId,
  unitNoteCreateSchema,
  unitNoteListQuerySchema,
  unitNotePinSchema,
  unitNoteSummaryQuerySchema,
  unitNoteUnitsQuerySchema,
  type UnitNoteCreate,
  type UnitNotePin,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireRole } from "../../../middleware/auth.js";
import { requireSurface } from "../../../middleware/requireSurface.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { addUnitNote, getUnitNote, isNoteRefusal, listUnitNotes, pinUnitNote, summariseUnitNotes, type NoteRefusal } from "./unitNotes.js";
import { listNotePeople, ringNoteMentions } from "./noteMentions.js";
import { listNoteUnits } from "./noteUnits.js";
import type { NoteChangeRefusal } from "./noteChanges.js";
import { mountNoteChangeRoutes } from "./changeRoutes.js";

/**
 * `/api/notes` — notes on drivers, trucks and trailers (`docs/plans/notes/UNIT-NOTES-PLAN.md` §4.3,
 * steps UN2 and UN3). UN3 added the `@` list (`GET /people`), the bell a mention rings on `POST /`, and
 * `GET /:id`, which turns the bell's note id into the unit the drawer opens on (`noteMentions.ts`).
 *
 * ── WHO ────────────────────────────────────────────────────────────────────────────────────────
 * Notes are OFFICE-WIDE (D-UN4, owner 2026-11-11: "if dispatch leaves a note related to billing or
 * safety they can see it"). Measured, the four tables' own sections would refuse billing all four
 * (plan M5), so notes answer to their own screen, `notes`, gated `STAFF` like office chat (M5b): every
 * office role reads, writes and pins; the `driver` role never reaches a note. The router asks exactly
 * chat's stack (`messaging/routes/chat.ts`): `requireRole(...OFFICE_ROLES)` is the role gate the
 * route-gate fitness functions can see, and `requireSurface("notes")` is the screen. It kept the
 * screen dark, admins only, while it was built (D-UN14); since UN9 the catalogue line is chat's exact
 * shape, so it is on for every office role and no longer a switch on the Permissions page.
 *
 * ── v3 (plan §9, owner 2026-11-12) ────────────────────────────────────────────────────────────────
 * `PATCH /:id` edits and `DELETE /:id` removes (hides) a note: its author always, anybody else only with
 * the named permission `notes.manage_all` (D-UN15, D-UN16, D-UN19), asked here and handed to the
 * database, which refuses a stranger's note without it (UN025). `GET /units` is the `@` list's trucks,
 * trailers and drivers, and `POST /:id/units/resolve` takes a unit's chip off the Dispatch Board
 * (D-UN17, D-UN18) — anybody who reads notes may, as anybody may pin.
 *
 * ⚠ The audit row says THAT a note was written, pinned, edited, removed or resolved and which unit it is
 * on — the Audit page is where admins keep track of edits and removals (Q-UN9) — never what it says.
 * The audit log is an admin's reading, and a note is the office's sentence about a person or a truck —
 * `recruiting/routes/notes.ts` keeps an applicant note's text out of its audit for the same reason.
 */
export function unitNotesRouter(): Router {
  const router = Router();
  router.use(requireAuth, requireOrg, requireRole(...OFFICE_ROLES), requireSurface("notes"));

  const adminOf = (req: Request) => getSupabaseAdmin(getAppLocals(req).env);
  const status = (r: NoteRefusal | NoteChangeRefusal) =>
    r.code === "not_found" ? 404 : r.code === "invalid_mention" ? 422 : r.code === "forbidden" ? 403 : 500;
  const actorOf = (req: Request) => ({ userId: req.auth!.userId, role: req.auth!.role ?? null, email: req.auth!.email ?? null });

  router.get(
    "/summary",
    asyncHandler(async (req, res) => {
      const parsed = unitNoteSummaryQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(apiError("invalid_request", parsed.error.issues[0]?.message ?? "Invalid query"));
        return;
      }
      const out = await summariseUnitNotes(adminOf(req), req.auth!.orgId!, parsed.data.kinds);
      if (isNoteRefusal(out)) {
        res.status(500).json(apiError(out.code, out.message));
        return;
      }
      res.json(out);
    }),
  );

  router.get(
    "/people",
    asyncHandler(async (req, res) => {
      const people = await listNotePeople(adminOf(req), req.auth!.orgId!);
      if (!people) {
        res.status(500).json(apiError("db_error", "Could not load the people"));
        return;
      }
      res.json({ people });
    }),
  );

  router.get(
    "/units",
    asyncHandler(async (req, res) => {
      const parsed = unitNoteUnitsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(apiError("invalid_request", parsed.error.issues[0]?.message ?? "Invalid query"));
        return;
      }
      const units = await listNoteUnits(adminOf(req), req.auth!.orgId!, parsed.data.q);
      if (!units) {
        res.status(500).json(apiError("db_error", "Could not load the units"));
        return;
      }
      res.json({ units });
    }),
  );

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const parsed = unitNoteListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(apiError("invalid_request", parsed.error.issues[0]?.message ?? "Invalid query"));
        return;
      }
      const out = await listUnitNotes(adminOf(req), req.auth!.orgId!, parsed.data);
      if (isNoteRefusal(out)) {
        res.status(500).json(apiError(out.code, out.message));
        return;
      }
      res.json(out);
    }),
  );

  router.post(
    "/",
    validateBody(unitNoteCreateSchema),
    asyncHandler(async (req, res) => {
      const admin = adminOf(req);
      const orgId = req.auth!.orgId!;
      const body = res.locals.body as UnitNoteCreate;
      const note = await addUnitNote(
        admin,
        orgId,
        actorOf(req),
        body.kind,
        body.subjectId,
        body.body,
      );
      if (isNoteRefusal(note)) {
        res.status(status(note)).json(apiError(note.code, note.message));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "notes.added",
        entity: "unit_notes",
        entityId: note.id,
        meta: { kind: note.kind, subjectId: note.subjectId },
      });
      // After the save and its audit, never before: a ring that fails must not lose the note (noteMentions.ts).
      await ringNoteMentions(admin, orgId, req.auth!.userId, note);
      res.status(201).json({ note });
    }),
  );

  // Declared after `/summary`, `/people` and `/units`, which `/:id` would otherwise read as a note id.
  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const noteId = String(req.params.id ?? "");
      const note = isRecordId(noteId) ? await getUnitNote(adminOf(req), req.auth!.orgId!, noteId.toLowerCase()) : null;
      if (isNoteRefusal(note)) {
        res.status(500).json(apiError(note.code, note.message));
        return;
      }
      if (!note) {
        res.status(404).json(apiError("not_found", "Note not found"));
        return;
      }
      res.json({ note });
    }),
  );

  router.post(
    "/:id/pin",
    validateBody(unitNotePinSchema),
    asyncHandler(async (req, res) => {
      const admin = adminOf(req);
      const orgId = req.auth!.orgId!;
      const noteId = String(req.params.id ?? "");
      const { pinned } = res.locals.body as UnitNotePin;
      const result = await pinUnitNote(admin, orgId, noteId, pinned);
      if (isNoteRefusal(result)) {
        res.status(status(result)).json(apiError(result.code, result.message));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: pinned ? "notes.pinned" : "notes.unpinned",
        entity: "unit_notes",
        entityId: noteId,
        meta: { kind: result.kind, subjectId: result.subjectId },
      });
      res.json({ pinned: result.pinned });
    }),
  );

  // v3: edit, remove, resolve (plan §9) — their own file, on this router so they sit behind the same gates.
  mountNoteChangeRoutes(router);

  return router;
}
