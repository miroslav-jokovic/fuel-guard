import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ingestArtifact, runEfsIngest, sha256Hex, type AutoIngestDeps } from "./efsAutoIngest.js";
import type { Artifact, IngestSource } from "../lib/ingestSource.js";
import type { IngestResult } from "./efsIngest.js";
import { loadEnv, type Env } from "../env.js";

const env: Env = loadEnv({});
const admin = {} as unknown as SupabaseClient;

function result(overrides: Partial<IngestResult>): IngestResult {
  return {
    kind: "transaction",
    alreadyImported: false,
    importId: "imp1",
    efsLines: 0,
    newFuel: 0,
    duplicateFuel: 0,
    duplicateEfs: 0,
    unattributed: 0,
    newDeclined: 0,
    duplicateDeclined: 0,
    skipped: 0,
    reportFrom: null,
    reportTo: null,
    shortfallRows: 0,
    scoreError: null,
    ...overrides,
  };
}

/** In-memory source recording done/quarantine decisions. */
class FakeSource implements IngestSource {
  done: string[] = [];
  quarantined: { name: string; reason: string }[] = [];
  constructor(
    private artifacts: Artifact[],
    private bytes: Record<string, Buffer> = {},
  ) {}
  async list(): Promise<Artifact[]> {
    return this.artifacts;
  }
  async fetch(a: Artifact): Promise<Buffer> {
    return this.bytes[a.id] ?? Buffer.from(`bytes:${a.name}`);
  }
  async markDone(a: Artifact): Promise<void> {
    this.done.push(a.name);
  }
  async quarantine(a: Artifact, reason: string): Promise<void> {
    this.quarantined.push({ name: a.name, reason });
  }
}

function deps(over: Partial<AutoIngestDeps> = {}): AutoIngestDeps {
  return {
    read: async () => ({ headers: ["Card #"], rows: [{ "Card #": "1" }] }),
    ingest: async () => result({ newFuel: 2 }),
    ...over,
  };
}

const artifact = (name: string): Artifact => ({ id: `org1/incoming/${name}`, name, orgId: "org1" });

describe("ingestArtifact", () => {
  it("ingests a good file and marks it done, tagging channel=auto and the file hash", async () => {
    const src = new FakeSource([artifact("efs.csv")], { "org1/incoming/efs.csv": Buffer.from("DATA") });
    let seen: Parameters<AutoIngestDeps["ingest"]>[2] | null = null;
    const d = deps({
      ingest: async (_a, _e, input) => {
        seen = input;
        return result({ newFuel: 2 });
      },
    });

    const outcome = await ingestArtifact(admin, env, src, artifact("efs.csv"), d);

    expect(outcome.status).toBe("ingested");
    expect(src.done).toEqual(["efs.csv"]);
    expect(src.quarantined).toEqual([]);
    expect(seen!.channel).toBe("auto");
    expect(seen!.source).toBe("csv");
    expect(seen!.orgId).toBe("org1");
    expect(seen!.fileHash).toBe(sha256Hex(Buffer.from("DATA")));
  });

  it("quarantines an unsupported extension WITHOUT fetching or ingesting", async () => {
    const src = new FakeSource([artifact("notes.txt")]);
    let ingestCalled = false;
    const d = deps({
      ingest: async () => {
        ingestCalled = true;
        return result({});
      },
    });

    const outcome = await ingestArtifact(admin, env, src, artifact("notes.txt"), d);

    expect(outcome.status).toBe("quarantined");
    expect(src.quarantined[0]!.reason).toMatch(/unsupported file type/);
    expect(ingestCalled).toBe(false);
    expect(src.done).toEqual([]);
  });

  it("quarantines an unreadable file", async () => {
    const src = new FakeSource([artifact("efs.csv")]);
    const d = deps({
      read: async () => {
        throw new Error("corrupt xlsx");
      },
    });

    const outcome = await ingestArtifact(admin, env, src, artifact("efs.csv"), d);

    expect(outcome.status).toBe("quarantined");
    expect(src.quarantined[0]!.reason).toMatch(/unreadable file: corrupt xlsx/);
  });

  it("quarantines a file the parser cannot recognize as an EFS report", async () => {
    const src = new FakeSource([artifact("efs.csv")]);
    const d = deps({ ingest: async () => result({ kind: "unknown", importId: null }) });

    const outcome = await ingestArtifact(admin, env, src, artifact("efs.csv"), d);

    expect(outcome.status).toBe("quarantined");
    expect(src.quarantined[0]!.reason).toMatch(/unrecognized report/);
    expect(src.done).toEqual([]);
  });
});

describe("runEfsIngest", () => {
  it("processes every artifact and aggregates counts; one bad file never stops the batch", async () => {
    const src = new FakeSource([artifact("good.csv"), artifact("bad.txt")]);
    const stats = await runEfsIngest(admin, env, src, deps());

    expect(stats.found).toBe(2);
    expect(stats.ingested).toBe(1);
    expect(stats.quarantined).toBe(1);
    expect(stats.newFuel).toBe(2);
    expect(stats.outcomes).toHaveLength(2);
    expect(src.done).toEqual(["good.csv"]);
    expect(src.quarantined.map((q) => q.name)).toEqual(["bad.txt"]);
  });
});
