import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A pluggable delivery source for EFS reports. The scheduler and auto-ingest glue depend ONLY on this
 * interface, so the transport (Supabase Storage today; direct IMAP mailbox or SFTP later) is a config
 * choice, not a rewrite. Every method is scoped to one org.
 *
 * Lifecycle for each artifact: list() → fetch() → (ingest) → markDone() on success, or
 * quarantine() when the file is unreadable / unrecognized. Nothing is ever deleted — a processed or
 * quarantined artifact is MOVED, preserving an audit trail and preventing re-processing.
 */
export interface Artifact {
  /** Opaque handle used by the source to fetch/move it (e.g. the object path). */
  id: string;
  /** Original filename — drives extension detection and the import record. */
  name: string;
  /** The org this artifact belongs to. */
  orgId: string;
}

export interface IngestSource {
  list(): Promise<Artifact[]>;
  fetch(artifact: Artifact): Promise<Buffer>;
  markDone(artifact: Artifact): Promise<void>;
  quarantine(artifact: Artifact, reason: string): Promise<void>;
}

/**
 * The narrow object-store surface the Storage source needs. Abstracted so the source is unit-testable
 * with an in-memory fake and never coupled to the exact supabase-js storage response shapes.
 */
export interface ObjectStore {
  list(prefix: string): Promise<{ name: string }[]>;
  download(path: string): Promise<Buffer>;
  move(fromPath: string, toPath: string): Promise<void>;
}

/** Thin adapter from the service-role Supabase client's Storage API to ObjectStore. Untested plumbing. */
export function supabaseObjectStore(admin: SupabaseClient, bucket: string): ObjectStore {
  const b = admin.storage.from(bucket);
  return {
    async list(prefix) {
      const { data, error } = await b.list(prefix);
      if (error) throw new Error(error.message);
      return (data ?? []).map((o) => ({ name: o.name }));
    },
    async download(path) {
      const { data, error } = await b.download(path);
      if (error || !data) throw new Error(error?.message ?? `download failed: ${path}`);
      return Buffer.from(await data.arrayBuffer());
    },
    async move(fromPath, toPath) {
      const { error } = await b.move(fromPath, toPath);
      if (error) throw new Error(error.message);
    },
  };
}

/**
 * Object-storage delivery source. Reports are dropped under `<orgId>/incoming/`; processed files move to
 * `<orgId>/processed/` and unreadable ones to `<orgId>/error/`. This works today by any mechanism that
 * lands a file in the bucket — an email-forwarding rule, an SFTP→bucket sync, or a manual drop for
 * testing — and requires no dependency beyond the Supabase client the API already uses.
 */
export class StorageSource implements IngestSource {
  private readonly incoming: string;
  constructor(
    private readonly store: ObjectStore,
    private readonly orgId: string,
  ) {
    this.incoming = `${orgId}/incoming`;
  }

  async list(): Promise<Artifact[]> {
    const objects = await this.store.list(this.incoming);
    // Ignore folder placeholders and hidden files; only take real report files.
    return objects
      .filter((o) => o.name && !o.name.endsWith("/") && !o.name.startsWith("."))
      .map((o) => ({ id: `${this.incoming}/${o.name}`, name: o.name, orgId: this.orgId }));
  }

  fetch(artifact: Artifact): Promise<Buffer> {
    return this.store.download(artifact.id);
  }

  markDone(artifact: Artifact): Promise<void> {
    return this.store.move(artifact.id, `${this.orgId}/processed/${stamp()}-${artifact.name}`);
  }

  quarantine(artifact: Artifact, _reason: string): Promise<void> {
    // The reason is recorded by the caller (jobs.stats / digest); the file is preserved under error/.
    return this.store.move(artifact.id, `${this.orgId}/error/${stamp()}-${artifact.name}`);
  }
}

/** A sortable, collision-resistant timestamp prefix so re-delivered filenames never overwrite. */
function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
