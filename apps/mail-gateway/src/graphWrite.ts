import { GraphFailed, GraphThrottled, MailboxRefused, type TokenSource } from "./graphClient.js";

/**
 * The gateway's only two writes to a mailbox (P4, D-BMR4 shapes 7–8), kept apart from `graphClient.ts`,
 * which can only GET. Each method takes a URL `graphUrl()` built — so the allowlist and the mailbox
 * check run first — and checks the URL's shape again here, so a GET-shaped URL can never be POSTed and
 * a create can never be pointed at `/send`.
 *
 *  · `createReply(url, comment)` — POST, body `{ comment }`. Graph makes a reply DRAFT in the owner's
 *    Drafts folder, our text above the broker's quoted message, and sends nothing. Answers its id.
 *  · `deleteDraft(url)` — DELETE under `mailFolders/drafts`. 404 means the draft is not in Drafts any
 *    more: the dispatcher sent it or deleted it by hand. That is an answer (`gone`), never an error.
 *
 * A 403 is Microsoft refusing the write (`MailboxRefused`): until Simo gives the scope
 * `Application Mail.ReadWrite`, every draft ends `refused`, which is exactly what the page should say.
 */

export type WriteFetch = (url: string, init: { method: "POST" | "DELETE"; headers: Record<string, string>; body?: string }) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

export interface GraphWrite {
  createReply(url: string, comment: string): Promise<string>;
  deleteDraft(url: string): Promise<"deleted" | "gone">;
}

const CREATE = /^https:\/\/graph\.microsoft\.com\/v1\.0\/users\/[^/]+\/messages\/[^/]+\/createReply$/;
const DELETE = /^https:\/\/graph\.microsoft\.com\/v1\.0\/users\/[^/]+\/mailFolders\/drafts\/messages\/[^/?]+$/;

export function graphWrite(fetch: WriteFetch, tokens: TokenSource): GraphWrite {
  async function send(url: string, method: "POST" | "DELETE", body?: string) {
    const headers = (t: string): Record<string, string> => ({ authorization: `Bearer ${t}`, ...(body ? { "content-type": "application/json" } : {}) });
    let res = await fetch(url, { method, headers: headers(await tokens.get()), body });
    if (res.status === 401) res = await fetch(url, { method, headers: headers(await tokens.get(true)), body });
    return res;
  }
  async function fail(res: Awaited<ReturnType<WriteFetch>>): Promise<never> {
    const json = (await res.json().catch(() => ({}))) as { error?: { code?: string } };
    if (res.status === 429 || res.status === 503) throw new GraphThrottled(Math.min(Number(res.headers.get("retry-after")) || 60, 3600));
    if (res.status === 403 || res.status === 404) throw new MailboxRefused(res.status);
    throw new GraphFailed(res.status, json.error?.code ?? null);
  }
  return {
    async createReply(url, comment) {
      if (!CREATE.test(url)) throw new Error("refused write: not a createReply URL");
      const res = await send(url, "POST", JSON.stringify({ comment }));
      if (res.status < 200 || res.status >= 300) return fail(res);
      const json = (await res.json().catch(() => ({}))) as { id?: unknown };
      if (typeof json.id !== "string" || json.id.length === 0) throw new GraphFailed(res.status, "NoDraftId");
      return json.id;
    },
    async deleteDraft(url) {
      if (!DELETE.test(url)) throw new Error("refused write: not a draft URL");
      const res = await send(url, "DELETE");
      if (res.status === 204 || res.status === 200) return "deleted";
      if (res.status === 404) return "gone";
      return fail(res);
    },
  };
}
