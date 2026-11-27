/**
 * Every Microsoft Graph request the gateway may make, as a closed list (D-BMR4).
 *
 * The gateway holds a token that opens every dispatcher mailbox in its Exchange scope. What it can
 * DO with that token is decided here, not by Graph: a URL is only ever built by `graphUrl()` from one
 * of the shapes below, or accepted from Graph as a paging link only when it parses back into one of
 * them for the same mailbox. There is no free-form request function in this program. A test
 * enumerates `CALL_SHAPES` and fails on a fifth, so adding a call is a visible decision in a diff.
 *
 * No send, no move, no mark-read, no delete, no attachments, no folder or rule changes — none of
 * those can be expressed. P4 adds the draft shapes (D-BMR4 5–8) in its own PR.
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

export const CALL_SHAPES = ["folder_delta", "message_delta", "message_body", "inbox_probe"] as const;
export type CallShape = (typeof CALL_SHAPES)[number];

/** A folder the gateway reads: a well-known name (Inbox, Sent Items) or an Inbox subfolder's id. */
export type FolderRef = { kind: "inbox" } | { kind: "sentitems" } | { kind: "id"; id: string };

export type GraphCall =
  | { shape: "folder_delta"; mailbox: string }
  | { shape: "message_delta"; mailbox: string; folder: FolderRef; receivedSince: string }
  | { shape: "message_body"; mailbox: string; messageId: string }
  | { shape: "inbox_probe"; mailbox: string };

export class RefusedCall extends Error {
  constructor(reason: string) {
    super(`refused Graph call: ${reason}`);
    this.name = "RefusedCall";
  }
}

const ID = /^[A-Za-z0-9=+/_-]{1,512}$/;
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
