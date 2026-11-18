import { graphFolderId, type GraphRequester } from "./graphMail.js";

/**
 * Read-only listing of one mailbox folder by RECEIVED TIME, for feeds whose messages a person also reads.
 *
 * ── WHY NOT "UNREAD = NEW" ───────────────────────────────────────────────────────────────────────────
 * The EFS source (`graphMail.ts`) lists unread messages and marks each read when done. That cannot work for
 * the Pilot price emails: the owner reads them in Outlook, so on 2026-11-17 every message in the folder was
 * already read=True and an unread filter would have found nothing, forever (PILOT-PRICE-MAIL-PLAN §1). This
 * reader never changes the mailbox — no mark-read, no move — and the caller keeps its own record of which
 * messages it has handled, keyed on `internetMessageId`. Graph's `id` changes when a message is moved
 * between folders; the internet message id is the sender's and does not.
 */
export interface FolderMessage {
  /** RFC 5322 Message-ID — stable across folder moves, so it is the processed-message key. */
  internetMessageId: string;
  subject: string;
  /** Lower-cased sender address. */
  from: string;
  receivedAt: string;
  /** The HTML (or text) body. */
  body: string;
}

export interface GraphFolderReader {
  /** Messages in the named folder received at or after `since`, oldest first. Throws if the folder is missing. */
  listSince(folder: string, since: Date): Promise<FolderMessage[]>;
}

/** Enough for a daily feed with a 48-hour link life; a page more would only be older mail. */
const PAGE = 50;

export function graphFolderReader(rq: GraphRequester): GraphFolderReader {
  return {
    async listSince(folder, since) {
      const id = await graphFolderId(rq, folder);
      if (!id) throw new Error(`Mail folder not found: "${folder}" — it must exist at the mailbox root or under Inbox with exactly this name`);
      const filter = encodeURIComponent(`receivedDateTime ge ${since.toISOString()}`);
      const res = await rq.graph(
        `${rq.base}/mailFolders/${id}/messages?$filter=${filter}&$orderby=receivedDateTime%20asc&$top=${PAGE}` +
          `&$select=internetMessageId,subject,from,receivedDateTime,body`,
      );
      const json = (await res.json()) as {
        value: Array<{
          internetMessageId?: string;
          subject?: string;
          from?: { emailAddress?: { address?: string } };
          receivedDateTime: string;
          body?: { content?: string };
        }>;
      };
      return json.value
        .filter((m) => !!m.internetMessageId)
        .map((m) => ({
          internetMessageId: m.internetMessageId!,
          subject: m.subject ?? "",
          from: (m.from?.emailAddress?.address ?? "").toLowerCase(),
          receivedAt: m.receivedDateTime,
          body: m.body?.content ?? "",
        }));
    },
  };
}
