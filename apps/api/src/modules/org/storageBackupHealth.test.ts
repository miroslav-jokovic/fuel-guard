import { describe, it, expect, vi, beforeEach } from "vitest";

const admin = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => admin.client }));

const { toStorageBackupHealth, storageBackupHealthy, getStorageBackupHealth, resetStorageBackupHealthCache, FRESH_MS } =
  await import("./storageBackupHealth.js");

const NOW = Date.parse("2026-10-21T15:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const H = 3_600_000;

describe("toStorageBackupHealth", () => {
  it("is pending before any org has a run", () => {
    expect(toStorageBackupHealth([{ lastDoneAt: null, latestStatus: null }], NOW).state).toBe("pending");
  });

  it("is ok when every org's last success is fresh, and reports the OLDEST success", () => {
    expect(
      toStorageBackupHealth(
        [
          { lastDoneAt: ago(2 * H), latestStatus: "done" },
          { lastDoneAt: ago(20 * H), latestStatus: "done" },
        ],
        NOW,
      ),
    ).toEqual({ state: "ok", lastSucceededAt: ago(20 * H) });
  });

  it("stays ok through one failed night while the last success is fresh", () => {
    expect(toStorageBackupHealth([{ lastDoneAt: ago(20 * H), latestStatus: "failed" }], NOW).state).toBe("ok");
  });

  it("is failing when an org is past FRESH_MS and its latest run failed — including one that never succeeded", () => {
    expect(toStorageBackupHealth([{ lastDoneAt: ago(FRESH_MS + H), latestStatus: "failed" }], NOW).state).toBe("failing");
    expect(toStorageBackupHealth([{ lastDoneAt: null, latestStatus: "failed" }], NOW)).toEqual({ state: "failing", lastSucceededAt: null });
  });

  it("is stale when an org is past FRESH_MS and nothing is failing: the runs stopped", () => {
    expect(toStorageBackupHealth([{ lastDoneAt: ago(FRESH_MS + H), latestStatus: "done" }], NOW).state).toBe("stale");
  });

  it("lets the worst org win: failing over stale over ok", () => {
    expect(
      toStorageBackupHealth(
        [
          { lastDoneAt: ago(H), latestStatus: "done" },
          { lastDoneAt: ago(FRESH_MS + H), latestStatus: "done" },
          { lastDoneAt: ago(FRESH_MS + H), latestStatus: "failed" },
        ],
        NOW,
      ).state,
    ).toBe("failing");
  });

  it("does not alarm on a new org with no run yet while the others are fresh", () => {
    expect(
      toStorageBackupHealth(
        [
          { lastDoneAt: ago(H), latestStatus: "done" },
          { lastDoneAt: null, latestStatus: null },
        ],
        NOW,
      ),
    ).toEqual({ state: "ok", lastSucceededAt: null });
  });
});

describe("storageBackupHealthy", () => {
  it("accepts off, pending and ok, and nothing else", () => {
    const states = ["off", "pending", "ok", "failing", "stale", "unknown"] as const;
    expect(Object.fromEntries(states.map((s) => [s, storageBackupHealthy(s)]))).toEqual({
      off: true,
      pending: true,
      ok: true,
      failing: false,
      stale: false,
      unknown: false,
    });
  });
});

describe("getStorageBackupHealth", () => {
  const CONFIGURED = {
    STORAGE_BACKUP_S3_BUCKET: "b",
    STORAGE_BACKUP_S3_REGION: "us-east-2",
    STORAGE_BACKUP_AWS_ACCESS_KEY_ID: "id",
    STORAGE_BACKUP_AWS_SECRET_ACCESS_KEY: "secret",
  } as never;
  beforeEach(() => resetStorageBackupHealthCache());

  it("is off when any variable is missing, without reading anything", async () => {
    admin.client = null;
    expect((await getStorageBackupHealth({ STORAGE_BACKUP_S3_BUCKET: "b" } as never, NOW)).state).toBe("off");
  });

  it.each([
    ["the latest-run read", false],
    ["the last-success read", true],
  ])("is unknown — never pending — when %s errors", async (_label, failDoneRead) => {
    const chain = (isDone = false) => ({
      select: () => chain(isDone),
      eq: (c: string, v: string) => chain(isDone || (c === "status" && v === "done")),
      order: () => chain(isDone),
      limit: async () =>
        isDone === failDoneRead ? { data: null, error: { message: "connection refused" } } : { data: [], error: null },
    });
    admin.client = {
      from: (t: string) => (t === "organizations" ? { select: async () => ({ data: [{ id: "o1" }], error: null }) } : chain()),
    };
    expect((await getStorageBackupHealth(CONFIGURED, NOW)).state).toBe("unknown");
  });

  it("reads each org's own rows, filtered by org and kind", async () => {
    const filters: string[] = [];
    const rows: Record<string, { status: string; finished_at: string }[]> = {
      latest: [{ status: "done", finished_at: ago(H) }],
      done: [{ status: "done", finished_at: ago(H) }],
    };
    const chain = (eqs: string[] = []) => ({
      select: () => chain(eqs),
      eq: (c: string, v: string) => chain([...eqs, `${c}=${v}`]),
      order: () => chain(eqs),
      limit: async () => {
        filters.push(eqs.join("&"));
        return { data: eqs.includes("status=done") ? rows.done : rows.latest, error: null };
      },
    });
    admin.client = {
      from: (t: string) => (t === "organizations" ? { select: async () => ({ data: [{ id: "o1" }], error: null }) } : chain()),
    };
    expect((await getStorageBackupHealth(CONFIGURED, NOW)).state).toBe("ok");
    expect(filters.sort()).toEqual(["org_id=o1&kind=storage_backup", "org_id=o1&kind=storage_backup&status=done"]);
  });
});
