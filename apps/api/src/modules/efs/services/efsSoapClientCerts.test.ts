import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ClientCertServiceError,
  activatePendingCert,
  certsNeedingExpiryWarning,
  listCerts,
  loadActiveMaterial,
  loadPendingMaterial,
  recordHandshake,
  retireAllCerts,
  rollbackToPreviousCert,
  uploadClientCert,
} from "./efsSoapClientCerts.js";
import { testEnv } from "../../../testing/testEnv.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../..", "lib", "__fixtures__", "mtls");
const fx = (n: string): string => readFileSync(join(FIXTURES, n), "utf8");
const CLIENT_CERT = fx("client.crt");
const CLIENT_KEY = fx("client.key");
const CLIENT2_CERT = fx("client2.crt");
const CLIENT2_KEY = fx("client2.key");
const CLIENT_KEY_ENC = fx("client.enc.key");
const CA = fx("ca.crt");

const ORG = "org-1";
const ACTOR = "user-1";
const env = testEnv({ SECRETS_ENCRYPTION_KEY: randomBytes(32).toString("base64") });

// ── An in-memory stand-in for the one table under test ──────────────────────────────────────────
// Deliberately a real store rather than canned responses: the properties worth testing here are
// STATEFUL (only one active certificate ever exists; rollback picks the right predecessor), and canned
// responses would assert the mock rather than the logic.

interface Row extends Record<string, unknown> {
  id: string;
  org_id: string;
  status: string;
}

function fakeDb(rows: Row[] = []) {
  let seq = rows.length;
  const store = { rows };

  function makeQuery(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    let orderKey: string | null = null;
    let orderAsc = true;
    let limitN = Infinity;
    let pendingUpdate: Record<string, unknown> | null = null;
    let inserted: Row[] | null = null;

    const applied = (): Row[] => {
      let out = store.rows.filter((r) => filters.every((f) => f(r)));
      if (orderKey) {
        const k = orderKey;
        out = [...out].sort((a, b) => {
          const av = String(a[k] ?? "");
          const bv = String(b[k] ?? "");
          return orderAsc ? av.localeCompare(bv) : bv.localeCompare(av);
        });
      }
      return out.slice(0, limitN);
    };

    const commit = (): Row[] => {
      if (inserted) {
        // Enforce the migration's partial unique indexes — the invariant the rotation flow relies on.
        for (const row of inserted) {
          if (row.status === "active" || row.status === "pending") {
            const clash = store.rows.find((r) => r.org_id === row.org_id && r.status === row.status);
            if (clash) throw new Error(`duplicate key value violates unique constraint (one ${row.status} per org)`);
          }
          store.rows.push(row);
        }
        return inserted;
      }
      if (pendingUpdate) {
        const target = applied();
        for (const r of target) {
          if (pendingUpdate.status === "active" || pendingUpdate.status === "pending") {
            const clash = store.rows.find(
              (o) => o !== r && o.org_id === r.org_id && o.status === pendingUpdate!.status,
            );
            if (clash) throw new Error(`duplicate key value violates unique constraint (one ${pendingUpdate.status} per org)`);
          }
          Object.assign(r, pendingUpdate);
        }
        return target;
      }
      return applied();
    };

    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = (col: string, val: unknown) => {
      filters.push((r) => r[col] === val);
      return q;
    };
    q.in = (col: string, vals: unknown[]) => {
      filters.push((r) => vals.includes(r[col]));
      return q;
    };
    q.lte = (col: string, val: string) => {
      filters.push((r) => String(r[col] ?? "") <= val);
      return q;
    };
    q.not = (col: string, _op: string, _val: unknown) => {
      filters.push((r) => r[col] != null);
      return q;
    };
    q.order = (col: string, opts?: { ascending?: boolean }) => {
      orderKey = col;
      orderAsc = opts?.ascending !== false;
      return q;
    };
    q.limit = (n: number) => {
      limitN = n;
      return q;
    };
    q.insert = (payload: Record<string, unknown> | Record<string, unknown>[]) => {
      const list = Array.isArray(payload) ? payload : [payload];
      inserted = list.map(
        (p) => ({ id: `${table}-${++seq}`, created_at: new Date(2026, 0, seq).toISOString(), ...p }) as unknown as Row,
      );
      return q;
    };
    q.update = (p: Record<string, unknown>) => {
      pendingUpdate = p;
      return q;
    };
    q.maybeSingle = async () => {
      try {
        return { data: commit()[0] ?? null, error: null };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message } };
      }
    };
    q.single = async () => {
      try {
        const r = commit()[0];
        return r ? { data: r, error: null } : { data: null, error: { message: "no rows" } };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message } };
      }
    };
    (q as { then: unknown }).then = (resolve: (v: unknown) => unknown) => {
      try {
        return resolve({ data: commit(), error: null });
      } catch (e) {
        return resolve({ data: null, error: { message: (e as Error).message } });
      }
    };
    return q;
  }

  const client = { from: (table: string) => makeQuery(table) } as unknown as SupabaseClient;
  return { client, store };
}

let db: ReturnType<typeof fakeDb>;
beforeEach(() => {
  db = fakeDb();
});

const upload = (certPem = CLIENT_CERT, keyPem = CLIENT_KEY, extra: Record<string, unknown> = {}) =>
  uploadClientCert(db.client, env, ORG, { certPem, keyPem, ...extra }, ACTOR);

describe("uploadClientCert", () => {
  it("stores a validated certificate as PENDING — never live on upload", async () => {
    const r = await upload();
    expect(r.cert.status).toBe("pending");
    expect(r.cert.subject).toContain("fuelguard-efs-client");
    expect(r.cert.fingerprintSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.replacedPending).toBe(false);
    // Nothing is presenting yet, so an unenrolled certificate cannot take the integration down.
    expect(await loadActiveMaterial(db.client, env, ORG)).toBeNull();
  });

  it("never writes the private key in plaintext", async () => {
    await upload();
    const row = db.store.rows[0]!;
    expect(String(row.key_sealed)).not.toContain("PRIVATE KEY");
    expect(String(row.key_sealed)).toMatch(/^v1\.[0-9a-f]{8}\./);
    // …and the whole row, serialised, contains no key material at all.
    expect(JSON.stringify(row)).not.toContain("PRIVATE KEY");
  });

  it("refuses to store anything when SECRETS_ENCRYPTION_KEY is unset", async () => {
    const noKeyEnv = testEnv();
    await expect(uploadClientCert(db.client, noKeyEnv, ORG, { certPem: CLIENT_CERT, keyPem: CLIENT_KEY }, ACTOR)).rejects.toThrow(
      /SECRETS_ENCRYPTION_KEY is not configured/,
    );
    expect(db.store.rows).toHaveLength(0); // fail closed — nothing written
  });

  it("rejects an invalid pair before it ever reaches the database", async () => {
    await expect(upload(CLIENT_CERT, CLIENT2_KEY)).rejects.toThrow(ClientCertServiceError);
    await expect(upload(CLIENT_CERT, CLIENT2_KEY)).rejects.toThrow(/different key pairs/);
    expect(db.store.rows).toHaveLength(0);
  });

  it("re-uploading replaces the earlier pending certificate (one pending per org)", async () => {
    await upload();
    const second = await upload(CLIENT2_CERT, CLIENT2_KEY);
    expect(second.replacedPending).toBe(true);
    expect(db.store.rows.filter((r) => r.status === "pending")).toHaveLength(1);
    expect(db.store.rows.find((r) => r.status === "retired")?.retired_reason).toBe("superseded_before_activation");
  });

  it("round-trips an encrypted key + passphrase through sealing", async () => {
    await upload(CLIENT_CERT, CLIENT_KEY_ENC, { passphrase: "testpass", caPem: CA });
    const material = await loadPendingMaterial(db.client, env, ORG);
    expect(material?.key).toContain("ENCRYPTED PRIVATE KEY");
    expect(material?.passphrase).toBe("testpass");
    expect(material?.ca).toContain("BEGIN CERTIFICATE");
    expect(material?.source).toBe("org");
  });

  it("surfaces warnings without blocking (near expiry, missing intermediates)", async () => {
    const r = await upload();
    expect(r.warnings.some((w) => /No intermediate certificates/.test(w))).toBe(true);
  });
});

describe("activation and rollback", () => {
  it("promotes pending to active and retires the incumbent", async () => {
    await upload();
    const first = await activatePendingCert(db.client, ORG, ACTOR);
    expect(first.activated.status).toBe("active");
    expect(first.retired).toBeNull();

    await upload(CLIENT2_CERT, CLIENT2_KEY);
    const second = await activatePendingCert(db.client, ORG, ACTOR);
    expect(second.activated.subject).toContain("fuelguard-efs-client-2");
    expect(second.retired?.fingerprintSha256).toBe(first.activated.fingerprintSha256);
    // The invariant the partial unique index exists to guarantee.
    expect(db.store.rows.filter((r) => r.status === "active")).toHaveLength(1);
  });

  it("refuses to activate when nothing is staged", async () => {
    await expect(activatePendingCert(db.client, ORG, ACTOR)).rejects.toThrow(/No pending certificate/);
  });

  it("the active certificate is what resolves as TLS material", async () => {
    await upload();
    await activatePendingCert(db.client, ORG, ACTOR);
    const material = await loadActiveMaterial(db.client, env, ORG);
    expect(material?.cert).toContain("BEGIN CERTIFICATE");
    expect(material?.key).toContain("PRIVATE KEY");
    expect(material?.rejectUnauthorized).toBe(true);
    expect(material?.certId).toBeTruthy();
  });

  it("rolls back to the previously-active certificate", async () => {
    await upload();
    const first = await activatePendingCert(db.client, ORG, ACTOR);
    await upload(CLIENT2_CERT, CLIENT2_KEY);
    const second = await activatePendingCert(db.client, ORG, ACTOR);

    const rolled = await rollbackToPreviousCert(db.client, ORG, ACTOR);
    expect(rolled.restored.fingerprintSha256).toBe(first.activated.fingerprintSha256);
    expect(rolled.rolledBack?.fingerprintSha256).toBe(second.activated.fingerprintSha256);
    expect(db.store.rows.filter((r) => r.status === "active")).toHaveLength(1);
    const material = await loadActiveMaterial(db.client, env, ORG);
    expect(material?.cert?.trim()).toBe(CLIENT_CERT.trim());
  });

  it("never rolls back to a certificate that was only ever staged", async () => {
    await upload(); // pending, then superseded — was never live
    await upload(CLIENT2_CERT, CLIENT2_KEY);
    await activatePendingCert(db.client, ORG, ACTOR);
    // The only retired row was never activated, so there is nothing legitimate to restore.
    await expect(rollbackToPreviousCert(db.client, ORG, ACTOR)).rejects.toThrow(/No previously-active certificate/);
  });

  it("withdrawal retires everything and leaves no TLS material", async () => {
    await upload();
    await activatePendingCert(db.client, ORG, ACTOR);
    await upload(CLIENT2_CERT, CLIENT2_KEY);
    expect(await retireAllCerts(db.client, ORG, ACTOR)).toBe(2);
    expect(await loadActiveMaterial(db.client, env, ORG)).toBeNull();
    expect(await loadPendingMaterial(db.client, env, ORG)).toBeNull();
  });
});

describe("observability", () => {
  it("records handshake outcomes against the certificate that was presented", async () => {
    await upload();
    const { activated } = await activatePendingCert(db.client, ORG, ACTOR);
    await recordHandshake(db.client, activated.id, false, "EPROTO alert handshake failure");
    const [current] = await listCerts(db.client, ORG);
    expect(current!.lastHandshakeOk).toBe(false);
    expect(current!.lastHandshakeError).toContain("handshake failure");
  });

  it("history is metadata only — no route can return key material by mistake", async () => {
    await upload();
    await activatePendingCert(db.client, ORG, ACTOR);
    const serialized = JSON.stringify(await listCerts(db.client, ORG));
    expect(serialized).not.toContain("PRIVATE KEY");
    expect(serialized).not.toContain("key_sealed");
    expect(serialized).not.toContain("BEGIN CERTIFICATE");
  });

  it("finds active certificates inside the expiry warning band", async () => {
    await upload();
    await activatePendingCert(db.client, ORG, ACTOR);
    // The fixture expires far in the future, so a wide band catches it and a narrow one does not.
    const now = new Date("2026-08-10T00:00:00Z");
    expect(await certsNeedingExpiryWarning(db.client, 30, now)).toHaveLength(0);
    expect(await certsNeedingExpiryWarning(db.client, 400 * 365, now)).toHaveLength(1);
  });
});
