import type { Env } from "../env.js";
import type { Artifact, IngestSource } from "./ingestSource.js";

/**
 * Microsoft 365 mailbox source for EFS reports, via the Microsoft Graph API with app-only
 * (client-credentials) auth. This is the supported way to read an M365 mailbox from a backend service —
 * Microsoft disabled basic-auth IMAP/POP, so a username+password login is no longer possible.
 *
 * The app registration (tenant/client id + secret, Mail.Read application permission, admin consent, and an
 * Application Access Policy scoping it to just the EFS mailbox) is a one-time setup — see
 * docs/plans/EFS-MICROSOFT365-SETUP.md. No new npm dependency: token + Graph calls use the built-in fetch.
 */

/** One mail message with the file attachments Graph reports for it. */
export interface GraphMessage {
  id: string;
  subject: string;
  attachments: { id: string; name: string }[];
}

/** The narrow Graph surface the source needs — abstracted so the source is unit-testable with a fake. */
export interface GraphMailClient {
  /** Unread messages (in the configured folder) that carry attachments. */
  list(): Promise<GraphMessage[]>;
  /** The raw bytes of one attachment. */
  download(messageId: string, attachmentId: string): Promise<Buffer>;
  /** Mark a message read so it isn't listed again. */
  markRead(messageId: string): Promise<void>;
}

/** Report attachments we can parse; everything else on a mail (logos, signatures) is ignored. */
const REPORT_EXT = /\.(csv|xlsx|xls)$/i;

function splitId(id: string): { messageId: string; attachmentId: string } {
  const i = id.indexOf("|");
  return { messageId: id.slice(0, i), attachmentId: id.slice(i + 1) };
}

/**
 * IngestSource over an M365 mailbox. Each report attachment on an unread message becomes one artifact
 * (`<messageId>|<attachmentId>`). Marking a message read is the exclusion mechanism — it is only marked
 * read (never moved), so its id stays valid while sibling attachments in the same run are still fetched.
 * Idempotency (file hash) means a re-listed message is a safe no-op even if a run is interrupted.
 */
export class GraphMailSource implements IngestSource {
  constructor(
    private readonly client: GraphMailClient,
    private readonly orgId: string,
  ) {}

  async list(): Promise<Artifact[]> {
    const messages = await this.client.list();
    const out: Artifact[] = [];
    for (const m of messages) {
      for (const a of m.attachments) {
        if (REPORT_EXT.test(a.name)) out.push({ id: `${m.id}|${a.id}`, name: a.name, orgId: this.orgId });
      }
    }
    return out;
  }

  fetch(artifact: Artifact): Promise<Buffer> {
    const { messageId, attachmentId } = splitId(artifact.id);
    return this.client.download(messageId, attachmentId);
  }

  markDone(artifact: Artifact): Promise<void> {
    return this.client.markRead(splitId(artifact.id).messageId);
  }

  quarantine(artifact: Artifact, _reason: string): Promise<void> {
    // Mark read so a bad attachment isn't re-listed forever. The digest surfaces the quarantined count and
    // the email stays in the mailbox/folder for a human to review.
    return this.client.markRead(splitId(artifact.id).messageId);
  }
}

// ── Real Graph client (thin plumbing; untested like the Supabase storage adapter) ────────────────────

interface GraphConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  mailbox: string;
  folder?: string;
}

/** Read + validate the Graph config from env. Returns null when it isn't fully configured. */
export function graphConfigFromEnv(env: Env): GraphConfig | null {
  const { EFS_GRAPH_TENANT_ID, EFS_GRAPH_CLIENT_ID, EFS_GRAPH_CLIENT_SECRET, EFS_GRAPH_MAILBOX, EFS_GRAPH_FOLDER } = env;
  if (!EFS_GRAPH_TENANT_ID || !EFS_GRAPH_CLIENT_ID || !EFS_GRAPH_CLIENT_SECRET || !EFS_GRAPH_MAILBOX) return null;
  return {
    tenantId: EFS_GRAPH_TENANT_ID,
    clientId: EFS_GRAPH_CLIENT_ID,
    clientSecret: EFS_GRAPH_CLIENT_SECRET,
    mailbox: EFS_GRAPH_MAILBOX,
    folder: EFS_GRAPH_FOLDER,
  };
}

export function graphMailClient(cfg: GraphConfig): GraphMailClient {
  let cachedToken: { value: string; expiresAt: number } | null = null;

  async function token(): Promise<string> {
    if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.value;
    const body = new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    });
    const res = await fetch(`https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`, { method: "POST", body });
    if (!res.ok) throw new Error(`Graph token request failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    cachedToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return json.access_token;
  }

  async function graph(path: string, init?: RequestInit): Promise<Response> {
    const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${await token()}`, ...(init?.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`Graph ${init?.method ?? "GET"} ${path} failed: ${res.status} ${await res.text()}`);
    return res;
  }

  const base = `/users/${encodeURIComponent(cfg.mailbox)}`;

  /** Resolve the optional folder display name to a path segment; empty = whole mailbox. */
  async function folderSegment(): Promise<string> {
    if (!cfg.folder) return "";
    const res = await graph(
      `${base}/mailFolders?$filter=displayName eq '${cfg.folder.replace(/'/g, "''")}'&$select=id&$top=1`,
    );
    const json = (await res.json()) as { value: { id: string }[] };
    const id = json.value[0]?.id;
    if (!id) throw new Error(`Graph mail folder not found: "${cfg.folder}"`);
    return `/mailFolders/${id}`;
  }

  return {
    async list(): Promise<GraphMessage[]> {
      const seg = await folderSegment();
      const res = await graph(
        `${base}${seg}/messages?$filter=isRead eq false and hasAttachments eq true&$select=id,subject&$top=50`,
      );
      const json = (await res.json()) as { value: { id: string; subject: string }[] };
      const out: GraphMessage[] = [];
      for (const m of json.value) {
        const ares = await graph(`${base}/messages/${m.id}/attachments?$select=id,name`);
        const ajson = (await ares.json()) as { value: { id: string; name: string }[] };
        out.push({ id: m.id, subject: m.subject, attachments: ajson.value.map((a) => ({ id: a.id, name: a.name })) });
      }
      return out;
    },
    async download(messageId: string, attachmentId: string): Promise<Buffer> {
      const res = await graph(`${base}/messages/${messageId}/attachments/${attachmentId}`);
      const json = (await res.json()) as { contentBytes?: string };
      if (json.contentBytes) return Buffer.from(json.contentBytes, "base64");
      // Attachments larger than ~4 MB omit contentBytes in the metadata response — fetch the raw bytes via
      // the $value endpoint so a big RejectTransactionReport still ingests instead of quarantining.
      const raw = await graph(`${base}/messages/${messageId}/attachments/${attachmentId}/$value`);
      return Buffer.from(await raw.arrayBuffer());
    },
    async markRead(messageId: string): Promise<void> {
      await graph(`${base}/messages/${messageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isRead: true }),
      });
    },
  };
}
