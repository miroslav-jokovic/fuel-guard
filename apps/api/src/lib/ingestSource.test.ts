import { describe, it, expect } from "vitest";
import { StorageSource, type ObjectStore } from "./ingestSource.js";

/** In-memory ObjectStore: paths → bytes, recording moves so we can assert markDone/quarantine. */
class FakeStore implements ObjectStore {
  files = new Map<string, Buffer>();
  moves: { from: string; to: string }[] = [];

  async list(prefix: string): Promise<{ name: string }[]> {
    const out: { name: string }[] = [];
    for (const path of this.files.keys()) {
      if (path.startsWith(`${prefix}/`)) {
        const rest = path.slice(prefix.length + 1);
        if (!rest.includes("/")) out.push({ name: rest }); // immediate children only
      }
    }
    return out;
  }
  async download(path: string): Promise<Buffer> {
    const b = this.files.get(path);
    if (!b) throw new Error(`not found: ${path}`);
    return b;
  }
  async move(fromPath: string, toPath: string): Promise<void> {
    const b = this.files.get(fromPath);
    if (!b) throw new Error(`not found: ${fromPath}`);
    this.files.delete(fromPath);
    this.files.set(toPath, b);
    this.moves.push({ from: fromPath, to: toPath });
  }
}

describe("StorageSource", () => {
  it("lists real report files under <org>/incoming, ignoring hidden/placeholder entries", async () => {
    const store = new FakeStore();
    store.files.set("org1/incoming/report.csv", Buffer.from("x"));
    store.files.set("org1/incoming/.keep", Buffer.from(""));
    store.files.set("org2/incoming/other.csv", Buffer.from("y")); // different org — excluded
    const src = new StorageSource(store, "org1");

    const artifacts = await src.list();
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({ id: "org1/incoming/report.csv", name: "report.csv", orgId: "org1" });
  });

  it("fetches the artifact bytes", async () => {
    const store = new FakeStore();
    store.files.set("org1/incoming/report.csv", Buffer.from("hello"));
    const src = new StorageSource(store, "org1");
    const [artifact] = await src.list();
    expect((await src.fetch(artifact!)).toString()).toBe("hello");
  });

  it("markDone moves the file into <org>/processed", async () => {
    const store = new FakeStore();
    store.files.set("org1/incoming/report.csv", Buffer.from("x"));
    const src = new StorageSource(store, "org1");
    const [artifact] = await src.list();
    await src.markDone(artifact!);

    expect(store.files.has("org1/incoming/report.csv")).toBe(false);
    expect(store.moves).toHaveLength(1);
    expect(store.moves[0]!.to).toMatch(/^org1\/processed\/.*report\.csv$/);
  });

  it("quarantine moves the file into <org>/error", async () => {
    const store = new FakeStore();
    store.files.set("org1/incoming/bad.csv", Buffer.from("x"));
    const src = new StorageSource(store, "org1");
    const [artifact] = await src.list();
    await src.quarantine(artifact!, "unreadable");

    expect(store.moves[0]!.to).toMatch(/^org1\/error\/.*bad\.csv$/);
  });
});
