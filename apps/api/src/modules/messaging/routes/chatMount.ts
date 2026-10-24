import { Router } from "express";
import { chatRouter } from "./chat.js";
import { chatComplianceRouter } from "./chatCompliance.js";

/**
 * Everything under `/api/chat`: the compliance console FIRST, at `/api/chat/compliance`, then the chat
 * itself. Order matters — `chatRouter` gates every path beneath it with `requireRole(...OFFICE_ROLES)`
 * and `requireSurface("chat")`, and the console answers to different gates (`chat.compliance`, the
 * settings section, step-up). Mounted ahead of it, the console's own middleware decides its requests
 * and the chat's never sees them; a path neither claims falls through to the app's 404 as before.
 *
 * `/compliance` cannot collide with a conversation: `chatRouter` reads `/:id` as a uuid and answers
 * 404 for anything else, so the word was never a conversation's address.
 */
export function chatRouters(): Router {
  const router = Router();
  router.use("/compliance", chatComplianceRouter());
  router.use("/", chatRouter());
  return router;
}
