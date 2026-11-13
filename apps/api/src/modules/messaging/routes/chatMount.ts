import { Router } from "express";
import { chatRouter } from "./chat.js";
import { chatComplianceRouter } from "./chatCompliance.js";
import { chatComplianceRecordsRouter } from "./chatComplianceRecords.js";
import { chatChannelsRouter, chatTeamsRouter } from "./chatTeams.js";
import { chatFilesRouter } from "./chatFiles.js";
import { chatAboutRouter } from "./chatAbout.js";
import { chatSearchRouter } from "./chatSearch.js";
import { chatCatchupRouter } from "./chatCatchup.js";
import { chatPushRouter } from "./chatPush.js";

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
  // CHA3b: holds and exports, under the same gates as the reads (its own router: one file per concern).
  router.use("/compliance", chatComplianceRecordsRouter());
  // CH5b: teams and channels, also ahead of `chatRouter` — its `/:id` would answer `/teams` as a
  // conversation that does not exist. Each carries the office-chat gates itself (chatTeams.ts).
  router.use("/teams", chatTeamsRouter());
  router.use("/channels", chatChannelsRouter());
  // CH7: files. Its routes carry their own gates (see chatFiles.ts) — `/files/:id` must be claimed before
  // the conversation router could read `/files` as a conversation id.
  router.use("/", chatFilesRouter());
  // CH11b: "Chat about this" — `/about` would otherwise be read as a conversation id.
  router.use("/", chatAboutRouter());
  // CH8: search, for the same reason — the conversation router would read `/search` as a conversation id.
  router.use("/", chatSearchRouter());
  // CH12: "Catch me up", with its own module gate (D-CHAT37) on top of the chat's.
  router.use("/", chatCatchupRouter());
  // CH10: this device's notifications — `/push` would otherwise be read as a conversation id.
  router.use("/push", chatPushRouter());
  router.use("/", chatRouter());
  return router;
}
