import { Router } from "express";
import {
  applicantNoteCreateSchema,
  applicantNotePinSchema,
  type ApplicantNoteCreate,
  type ApplicantNotePin,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { addApplicantNote, isNoteRefusal, listApplicantNotes, pinApplicantNote } from "../applicantNotes.js";
import { applicantActivity } from "../applicantActivity.js";

/**
 * The human layer on the applicant record (HIRING-WORKFLOW-AUDIT-2026-10-31 §8.2, §9 P10): the
 * office's notes (0535) and the activity list derived from what is already on file.
 *
 * ── WHO ────────────────────────────────────────────────────────────────────────────────────────
 * `recruitment` view to read both, `recruitment` manage to add or pin a note — the same split as the
 * section's other reads and acts (`dispositions.ts`, `checklist.ts`). Whoever can see the applicant
 * can see what the office wrote about them; whoever can work the application can write.
 *
 * ⚠ The audit row says THAT a note was written or pinned, never what it says. The audit log is
 * readable by an admin who has no part in hiring, and a recruiter's sentence about a person belongs to
 * the people hiring — `dispositions.ts` keeps a decline's reason out of its audit for the same reason.
 */
export function recruitmentNotesRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  const canManage = requireSection("recruitment");
  const canView = requireSection("recruitment", "view");

  router.get(
    "/applicants/:driverId/notes",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const notes = await listApplicantNotes(admin, req.auth!.orgId!, String(req.params.driverId ?? ""));
      if (isNoteRefusal(notes)) {
        res.status(500).json(apiError(notes.code, notes.message));
        return;
      }
      res.json({ notes });
    }),
  );

  router.post(
    "/applicants/:driverId/notes",
    requireOrg,
    canManage,
    validateBody(applicantNoteCreateSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const driverId = String(req.params.driverId ?? "");
      const body = res.locals.body as ApplicantNoteCreate;
      const note = await addApplicantNote(
        admin,
        orgId,
        { userId: req.auth!.userId, role: req.auth!.role ?? null, email: req.auth!.email ?? null },
        driverId,
        body.body,
      );
      if (isNoteRefusal(note)) {
        res.status(note.code === "not_found" ? 404 : 500).json(apiError(note.code, note.message));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "recruitment.applicant_note_added",
        entity: "drivers",
        entityId: driverId,
        meta: { noteId: note.id },
      });
      res.status(201).json({ note });
    }),
  );

  router.post(
    "/applicants/:driverId/notes/:noteId/pin",
    requireOrg,
    canManage,
    validateBody(applicantNotePinSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const driverId = String(req.params.driverId ?? "");
      const noteId = String(req.params.noteId ?? "");
      const { pinned } = res.locals.body as ApplicantNotePin;
      const result = await pinApplicantNote(admin, orgId, driverId, noteId, pinned);
      if (isNoteRefusal(result)) {
        res.status(result.code === "not_found" ? 404 : 500).json(apiError(result.code, result.message));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: pinned ? "recruitment.applicant_note_pinned" : "recruitment.applicant_note_unpinned",
        entity: "drivers",
        entityId: driverId,
        meta: { noteId },
      });
      res.json(result);
    }),
  );

  router.get(
    "/applicants/:driverId/activity",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      try {
        const activity = await applicantActivity(admin, req.auth!.orgId!, String(req.params.driverId ?? ""));
        res.json({ activity });
      } catch {
        res.status(500).json(apiError("db_error", "Could not load the activity"));
      }
    }),
  );

  return router;
}
