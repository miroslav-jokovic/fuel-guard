import { describe, it, expect } from "vitest";
import { backupOrgStorage, bucketsToBackUp, objectsToCopy, type BackupTarget, type TargetObject } from "./storageBackup.js";

const ORG = "86d6b3ea-4361-4f71-877f-e8373615769b";

describe("bucketsToBackUp", () => {
  it("copies every bucket Storage has except the derived binders, so a new bucket needs no edit here", () => {
    expect(bucketsToBackUp(["receipts", "compliance-exports", "compliance-docs", "a-bucket-added-tomorrow"])).toEqual([
      "a-bucket-added-tomorrow",
      "compliance-docs",
      "receipts",
    ]);
  });
});

describe("objectsToCopy", () => {
  const held = new Map<string, TargetObject>([
    [`docs/${ORG}/a.pdf`, { size: 10, lastModifiedMs: Date.parse("2026-10-20T00:00:00Z") }],
  ]);
  const obj = (path: string, size?: number, updatedAt?: string) => ({ path, createdAt: "2026-10-01T00:00:00Z", size, updatedAt });

  it("copies an object the target does not hold", () => {
    expect(objectsToCopy("docs", [obj(`${ORG}/new.pdf`, 5)], held).map((o) => o.path)).toEqual([`${ORG}/new.pdf`]);
  });

  it("skips an object the target holds at the same size and a later write", () => {
    expect(objectsToCopy("docs", [obj(`${ORG}/a.pdf`, 10, "2026-10-19T00:00:00Z")], held)).toEqual([]);
  });

  it("re-copies an object whose size changed", () => {
    expect(objectsToCopy("docs", [obj(`${ORG}/a.pdf`, 11, "2026-10-19T00:00:00Z")], held)).toHaveLength(1);
  });

  it("re-copies an object replaced in place at the same size, by its later write", () => {
    expect(objectsToCopy("docs", [obj(`${ORG}/a.pdf`, 10, "2026-10-21T00:00:00Z")], held)).toHaveLength(1);
  });

  it("keys by bucket, so the same path in another bucket is a different object", () => {
    expect(objectsToCopy("photos", [obj(`${ORG}/a.pdf`, 10, "2026-10-19T00:00:00Z")], held)).toHaveLength(1);
  });
});

/** A Storage admin with the given buckets → { path: bytes } and the downloads that should fail. */
function fakeAdmin(buckets: Record<string, Record<string, string>>, failing: Set<string> = new Set()) {
  const listed: string[] = [];
  const admin = {
    storage: {
      listBuckets: async () => ({ data: Object.keys(buckets).map((name) => ({ name })), error: null }),
      from: (bucket: string) => ({
        // listAllObjects descends one folder per call; this fake serves the org folder flat.
        list: async (prefix: string) => {
          listed.push(`${bucket}:${prefix}`);
          const names = Object.keys(buckets[bucket] ?? {})
            .filter((p) => p.startsWith(`${prefix}/`))
            .map((p) => p.slice(prefix.length + 1));
          return {
            data: names.map((name) => ({
              name,
              id: name,
              created_at: "2026-10-01T00:00:00Z",
              updated_at: "2026-10-01T00:00:00Z",
              metadata: { size: buckets[bucket]![`${prefix}/${name}`]!.length },
            })),
            error: null,
          };
        },
        download: async (path: string) =>
          failing.has(`${bucket}/${path}`)
            ? { data: null, error: { message: "Object not found" } }
            : { data: new Blob([buckets[bucket]![path]!], { type: "application/pdf" }), error: null },
      }),
    },
  };
  return { admin: admin as never, listed };
}

function memoryTarget(): BackupTarget & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async inventory(prefix) {
      const m = new Map<string, TargetObject>();
      for (const [k, v] of store) if (k.startsWith(prefix)) m.set(k, { size: v.length, lastModifiedMs: Date.parse("2026-10-21T00:00:00Z") });
      return m;
    },
    async put(key, body) {
      store.set(key, new TextDecoder().decode(body));
    },
  };
}

describe("backupOrgStorage", () => {
  it("copies every object of the org in every bucket, keyed bucket/path, and skips the excluded bucket", async () => {
    const { admin } = fakeAdmin({
      "compliance-docs": { [`${ORG}/d/med.pdf`]: "medical" },
      "inspection-evidence": { [`${ORG}/i/1.jpg`]: "photo" },
      "compliance-exports": { [`${ORG}/binder.pdf`]: "binder" },
    });
    const target = memoryTarget();
    const r = await backupOrgStorage(admin, ORG, target);
    expect([...target.store.keys()].sort()).toEqual([`compliance-docs/${ORG}/d/med.pdf`, `inspection-evidence/${ORG}/i/1.jpg`]);
    expect(r).toMatchObject({ buckets: 2, scanned: 2, copied: 2, failed: 0, bytes: "medical".length + "photo".length });
  });

  it("lists only under the org's own folder, never the bucket root", async () => {
    const { admin, listed } = fakeAdmin({ "compliance-docs": { [`${ORG}/a.pdf`]: "a" } });
    await backupOrgStorage(admin, ORG, memoryTarget());
    expect(listed).toEqual([`compliance-docs:${ORG}`]);
  });

  it("copies nothing on a second night with no uploads", async () => {
    const { admin } = fakeAdmin({ "compliance-docs": { [`${ORG}/a.pdf`]: "a" } });
    const target = memoryTarget();
    await backupOrgStorage(admin, ORG, target);
    expect((await backupOrgStorage(admin, ORG, target)).copied).toBe(0);
  });

  it("keeps copying past a failed object, then fails the run naming it", async () => {
    const { admin } = fakeAdmin(
      { "compliance-docs": { [`${ORG}/bad.pdf`]: "x", [`${ORG}/good.pdf`]: "y" } },
      new Set([`compliance-docs/${ORG}/bad.pdf`]),
    );
    const target = memoryTarget();
    await expect(backupOrgStorage(admin, ORG, target)).rejects.toThrow(/1 of 2 object\(s\) not copied.*bad\.pdf: Object not found/);
    expect([...target.store.keys()]).toEqual([`compliance-docs/${ORG}/good.pdf`]);
  });
});
