import type { Request, Router } from "express";
import {
  NOTES_MANAGE_ALL_PERMISSION,
  isRecordId,
  unitNoteEditSchema,
  unitNoteResolveSchema,
  type UnitNoteEdit,
  type UnitNoteResolve,
} from "@silvicom/shared";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { holdsNamedPermission } from "../../org/index.js";
import { getUnitNote, isNoteRefusal } from "./unitNotes.js";
import { ringNoteMentions } from "./noteMentions.js";
import { editUnitNote, removeUnitNote, resolveUnitMention, type NoteChangeRefusal } from "./noteChanges.js";

/**
 * `/api/notes`' v3 writes (UNIT-NOTES-PLAN §9, owner 2026-11-12), mounted by `unitNotesRouter` on its own
 * router so they sit behind exactly its gates (office role + the `notes` screen):
 *
 * - `PATCH /:id` — new words (D-UN15) and `DELETE /:id` — remove, i.e. hide (D-UN16): the author always,
 *   anybody else only with `notes.manage_all` (D-UN19). The permission is asked here and handed to the
 *   database, which refuses a stranger's note without it (UN025), so forgetting to ask fails closed.
 * - `POST /:id/units/resolve` — take one unit's chip for this note off the Dispatch Board (D-UN18), for
 *   anybody who reads notes, as anybody may pin.
 *
 * Every one writes an audit row — `notes.edited`, `notes.removed`, `notes.mention_resolved` — naming the
 * note, its unit and whether the author did it: the Audit page is where admins keep track (Q-UN9). Never
 * the words (routes.ts' ⚠).
 */
export function mountNoteChangeRoutes(router: Router): void {
  const adminOf = (req: Request) => getSupabaseAdmin(getAppLocals(req).env);
  const status = (r: NoteChangeRefusal) =>
    r.code === "not_found" ? 404 : r.code === "invalid_mention" ? 422 : r.code === "forbidden" ? 403 : 500;
  const actorOf = (req: Request) => ({ userId: req.auth!.userId, role: req.auth!.role ?? null, email: req.auth!.email ?? null });

  router.patch(
    "/:id",
    validateBody(unitNoteEditSchema),
    asyncHandler(async (req, res) => {
      const admin = adminOf(req);
      const orgId = req.auth!.orgId!;
      const noteId = String(req.params.id ?? "").toLowerCase();
      const before = isRecordId(noteId) ? await getUnitNote(admin, orgId, noteId) : null;
      if (!before || isNoteRefusal(before)) {
        res.status(before ? 500 : 404).json(apiError(before ? "db_error" : "not_found", before ? "Could not load the note" : "Note not found"));
        return;
      }
      const any = await holdsNamedPermission(req, NOTES_MANAGE_ALL_PERMISSION);
      const out = await editUnitNote(admin, orgId, actorOf(req), noteId, (res.locals.body as UnitNoteEdit).body, any);
      if ("code" in out) {
        res.status(status(out)).json(apiError(out.code, out.message));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "notes.edited",
        entity: "unit_notes",
        entityId: noteId,
        meta: { kind: out.facts.kind, subjectId: out.facts.subjectId, byAuthor: out.facts.byAuthor },
      });
      // Only the people this edit ADDED hear of it (noteMentions.ts); after the save, as on add.
      await ringNoteMentions(admin, orgId, req.auth!.userId, out.note, out.note.mentions.filter((id) => !before.mentions.includes(id)));
      res.json({ note: out.note });
    }),
  );

  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const admin = adminOf(req);
      const orgId = req.auth!.orgId!;
      const noteId = String(req.params.id ?? "").toLowerCase();
      if (!isRecordId(noteId)) {
        res.status(404).json(apiError("not_found", "Note not found"));
        return;
      }
      const any = await holdsNamedPermission(req, NOTES_MANAGE_ALL_PERMISSION);
      const out = await removeUnitNote(admin, orgId, actorOf(req), noteId, any);
      if ("code" in out) {
        res.status(status(out)).json(apiError(out.code, out.message));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "notes.removed",
        entity: "unit_notes",
        entityId: noteId,
        meta: { kind: out.kind, subjectId: out.subjectId, byAuthor: out.byAuthor },
      });
      res.json({ removed: true });
    }),
  );

  router.post(
    "/:id/units/resolve",
    validateBody(unitNoteResolveSchema),
    asyncHandler(async (req, res) => {
      const admin = adminOf(req);
      const orgId = req.auth!.orgId!;
      const noteId = String(req.params.id ?? "").toLowerCase();
      if (!isRecordId(noteId)) {
        res.status(404).json(apiError("not_found", "Note not found"));
        return;
      }
      const { kind, subjectId } = res.locals.body as UnitNoteResolve;
      const out = await resolveUnitMention(admin, orgId, actorOf(req), noteId, kind, subjectId);
      if (out !== true) {
        res.status(status(out)).json(apiError(out.code, out.message));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "notes.mention_resolved",
        entity: "unit_notes",
        entityId: noteId,
        meta: { kind, subjectId },
      });
      res.json({ resolved: true });
    }),
  );

}
