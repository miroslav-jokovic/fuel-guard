/**
 * Every Microsoft Graph request the gateway may make, as a closed list (D-BMR4).
 *
 * The gateway holds a token that opens every dispatcher mailbox in its Exchange scope. What it can
 * DO with that token is decided here, not by Graph: a URL is only ever built by `graphUrl()` from one
 * of the shapes below, or accepted from Graph as a paging link only when it parses back into one of
 * them for the same mailbox. There is no free-form request function in this program. A test
 * enumerates `CALL_SHAPES` and fails on a fifth, so adding a call is a visible decision in a diff.
 *
 * No send, no move, no mark-read, no attachments, no folder or rule changes — none of those can be
 * expressed. P4 (0656) added the four draft shapes, and each is narrower than Graph's general call:
 *   5. `find_message` — one message by the `internetMessageId` 360 stored, `$select=id,conversationId`;
 *   6. `conversation_drafts` — the DRAFTS folder's messages on one conversation, `$select=id` only:
 *      "has a person already started a reply here?" (never step on a human);
 *   7. `create_reply` — POST createReply on that message with our text as its comment. A reply DRAFT:
 *      Graph saves it in Drafts and sends nothing; the dispatcher presses Send in Outlook;
 *   8. `delete_draft` — DELETE of a message id 360 recorded, addressed UNDER the Drafts folder, so a
 *      draft the dispatcher already sent (Outlook moved it to Sent Items) answers 404 and survives.
 * PATCH of a draft's body (D-BMR4's first list) is not a shape: createReply's `comment` writes our text
 * in the same call, above the broker's quoted message, so there is no second write to allow.
 *
 * The mailbox check is the second half: every builder takes the cycle's allowed-mailbox set, and a
 * mailbox outside it throws BEFORE any request exists (D-BMR4, "a mailbox outside the cycle's list is
 * refused before any request"). The derived list comes from the database (D-BMR5); the probe set
 * (canary + unlinked mailboxes, D-BMR14) is separate and admits only shape 4.
 */

export const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";

/** The envelope fields D-BMR6 selects (plus `id`, which Graph returns regardless). */
export const ENVELOPE_SELECT =
  "id,internetMessageId,conversationId,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,subject";

export const CALL_SHAPES = [
  "folder_delta", "message_delta", "message_body", "inbox_probe",
  "find_message", "conversation_drafts", "create_reply", "delete_draft",
] as const;
/** The shapes that change a mailbox. Only `graphWrite.ts` sends them, and only these. */
export const WRITE_SHAPES = ["create_reply", "delete_draft"] as const satisfies readonly CallShape[];
export type CallShape = (typeof CALL_SHAPES)[number];

/** A folder the gateway reads: a well-known name (Inbox, Sent Items) or an Inbox subfolder's id. */
export type FolderRef = { kind: "inbox" } | { kind: "sentitems" } | { kind: "id"; id: string };

export type GraphCall =
  | { shape: "folder_delta"; mailbox: string }
  | { shape: "message_delta"; mailbox: string; folder: FolderRef; receivedSince: string }
  | { shape: "message_body"; mailbox: string; messageId: string }
  | { shape: "inbox_probe"; mailbox: string }
  | { shape: "find_message"; mailbox: string; internetMessageId: string }
  | { shape: "conversation_drafts"; mailbox: string; conversationId: string }
  | { shape: "create_reply"; mailbox: string; messageId: string }
  | { shape: "delete_draft"; mailbox: string; draftId: string };

export class RefusedCall extends Error {
  constructor(reason: string) {
    super(`refused Graph call: ${reason}`);
    this.name = "RefusedCall";
  }
}

const ID = /^[A-Za-z0-9=+/_-]{1,512}$/;
/** RFC 5322 message ids are `<local@host>`; nothing that could close an OData string survives. */
const INTERNET_ID = /^<[^<>\s'"]{1,990}>$/;
/** A literal inside an OData filter: single quotes doubled (the OData escape), then the URL's own encoding. */
const odataString = (v: string) => encodeURIComponent(`'${v.replace(/'/g, "''")}'`);
const MAILBOX = /^[^@\s/()'"?#]+@[a-z0-9.-]+$/;

function mailboxPath(mailbox: string, allowed: ReadonlySet<string>): string {
  const mb = mailbox.toLowerCase();
  if (!MAILBOX.test(mb)) throw new RefusedCall("not a mailbox address");
  if (!allowed.has(mb)) throw new RefusedCall("mailbox is not in this cycle's list");
  return `${GRAPH_ROOT}/users/${encodeURIComponent(mb)}`;
}

function folderPath(folder: FolderRef): string {
  if (folder.kind === "inbox") return "mailFolders/inbox";
  if (folder.kind === "sentitems") return "mailFolders/sentitems";
  if (!ID.test(folder.id)) throw new RefusedCall("not a folder id");
  return `mailFolders/${encodeURIComponent(folder.id)}`;
}

/**
 * The only way a Graph URL comes into being. `allowed` is the derived list for shapes 1–3, and the
 * probe set for shape 4 — the caller passes the right set; a shape-4 call is the only one the probe
 * set may make.
 */
export function graphUrl(call: GraphCall, allowed: ReadonlySet<string>, opts: { bodyReading: boolean } = { bodyReading: false }): string {
  const base = mailboxPath(call.mailbox, allowed);
  switch (call.shape) {
    case "folder_delta":
      return `${base}/mailFolders/delta?$select=id,parentFolderId`;
    case "message_delta": {
      if (Number.isNaN(Date.parse(call.receivedSince))) throw new RefusedCall("receivedSince is not a time");
      const filter = encodeURIComponent(`receivedDateTime ge ${new Date(call.receivedSince).toISOString()}`);
      return `${base}/${folderPath(call.folder)}/messages/delta?changeType=created&$select=${ENVELOPE_SELECT}&$filter=${filter}`;
    }
    case "message_body":
      // Shape 3 exists only while the config says so (Q-BMR9: days 1–3 run without it at all).
      if (!opts.bodyReading) throw new RefusedCall("body reading is off");
      if (!ID.test(call.messageId)) throw new RefusedCall("not a message id");
      return `${base}/messages/${encodeURIComponent(call.messageId)}?$select=body`;
    case "inbox_probe":
      return `${base}/mailFolders/inbox?$select=id`;
    case "find_message":
      if (!INTERNET_ID.test(call.internetMessageId)) throw new RefusedCall("not an internet message id");
      return `${base}/messages?$filter=${encodeURIComponent("internetMessageId eq ")}${odataString(call.internetMessageId)}&$select=id,conversationId&$top=2`;
    case "conversation_drafts":
      if (!ID.test(call.conversationId)) throw new RefusedCall("not a conversation id");
      return `${base}/mailFolders/drafts/messages?$filter=${encodeURIComponent("conversationId eq ")}${odataString(call.conversationId)}&$select=id&$top=10`;
    case "create_reply":
      if (!ID.test(call.messageId)) throw new RefusedCall("not a message id");
      return `${base}/messages/${encodeURIComponent(call.messageId)}/createReply`;
    case "delete_draft":
      if (!ID.test(call.draftId)) throw new RefusedCall("not a draft id");
      return `${base}/mailFolders/drafts/messages/${encodeURIComponent(call.draftId)}`;
  }
}

/**
 * A paging link Graph returned (`@odata.nextLink` / `@odata.deltaLink`) is followed only if it is
 * the SAME kind of request for the SAME mailbox: Graph's own host, a delta path under that user, no
 * other host or path. Graph writes the user either as `/users/<addr>` or `/users('<addr>')`, and
 * percent-encodes it in either form; both are read back and compared.
 */
export function acceptPagingLink(link: string, expect: { mailbox: string; shape: "folder_delta" | "message_delta" }, allowed: ReadonlySet<string>): string {
  let u: URL;
  try { u = new URL(link); } catch { throw new RefusedCall("paging link is not a URL"); }
  if (u.protocol !== "https:" || u.host !== "graph.microsoft.com") throw new RefusedCall("paging link leaves graph.microsoft.com");
  const m = /^\/v1\.0\/users(?:\/([^/()]+)|\('([^']+)'\))\/(.+)$/.exec(u.pathname);
  if (!m) throw new RefusedCall("paging link is not a user path");
  const who = decodeURIComponent(m[1] ?? m[2] ?? "").toLowerCase();
  if (who !== expect.mailbox.toLowerCase() || !allowed.has(who)) throw new RefusedCall("paging link names another mailbox");
  const rest = decodeURIComponent(m[3] ?? "");
  const ok = expect.shape === "folder_delta"
    ? /^mailFolders\/delta$/i.test(rest)
    : /^mailFolders(?:\/[^/]+|\('[^']+'\))\/messages\/delta$/i.test(rest);
  if (!ok) throw new RefusedCall("paging link is another kind of request");
  return u.toString();
}
