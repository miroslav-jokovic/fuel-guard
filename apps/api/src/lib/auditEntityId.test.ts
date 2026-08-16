import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSupabaseRecorder } from "../testing/supabaseRecorder.js";
import { isAuditEntityId, writeAudit } from "./audit.js";

/**
 * Step 5.11. `audit_logs.entity_id` is `uuid` (migration 0003); `AuditEntry.entityId` is `string`.
 * One field, two sources of truth, and the disagreement resolves toward "the write just vanishes" —
 * Postgres rejects the insert, `writeAudit` retries once, logs to stderr, returns false, and most of
 * the 109 call sites ignore the return.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const UUID = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const API_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a non-uuid entityId never costs us the audit row", () => {
  it("stores the value in meta and leaves entity_id null, rather than losing the insert", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = createSupabaseRecorder();

    // "card_lock" is the literal value that made the first real capability promotion unattributable.
    const ok = await writeAudit(db.client, {
      orgId: ORG,
      action: "fuel_card.capability_promoted",
      entity: "efs_capability_promotions",
      entityId: "card_lock",
      meta: { reason: "proof run 1" },
    });

    expect(ok).toBe(true); // the row lands — that is the whole point
    const row = db.writtenRows("audit_logs")[0]!;
    expect(row.entity_id).toBeNull();
    expect(row.meta).toEqual({ reason: "proof run 1", entityIdRejected: "card_lock" });
    expect(row.action).toBe("fuel_card.capability_promoted");
    expect(errors).toHaveBeenCalled(); // …and it is loud
  });

  it("passes a real uuid straight through and adds nothing to meta", async () => {
    const db = createSupabaseRecorder();

    await writeAudit(db.client, { orgId: ORG, action: "x", entity: "y", entityId: UUID, meta: { a: 1 } });

    const row = db.writtenRows("audit_logs")[0]!;
    expect(row.entity_id).toBe(UUID);
    expect(row.meta).toEqual({ a: 1 });
  });

  it("leaves an absent entityId absent — omitting it is legitimate, not a rejection", async () => {
    const db = createSupabaseRecorder();

    await writeAudit(db.client, { orgId: ORG, action: "x", meta: { a: 1 } });

    const row = db.writtenRows("audit_logs")[0]!;
    expect(row.entity_id).toBeNull();
    expect(row.meta).toEqual({ a: 1 });
  });

  it.each([
    ["a capability key", "card_lock"],
    ["a feature slug", "core.app"],
    ["a composite key", "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e:core.app"],
    ["a joined id list", `${UUID},${UUID}`],
    ["an order number", "SO-10422"],
    ["the empty string", ""],
  ])("rejects %s", (_label, value) => {
    expect(isAuditEntityId(value)).toBe(false);
  });

  it("accepts a uuid in either case", () => {
    expect(isAuditEntityId(UUID)).toBe(true);
    expect(isAuditEntityId(UUID.toUpperCase())).toBe(true);
  });
});

/**
 * The static half of the sweep. The runtime guard above means no row is ever lost again, but a call
 * site passing a slug is still a bug — the audit trail loses the column it should have been queryable
 * by. This catches the shapes that can be judged from the source alone: a string literal, a template
 * with interpolation, and a `.join(…)`. It cannot judge a bare identifier like `result.id`, and does
 * not pretend to; those are covered by the runtime guard.
 */
describe("no call site passes an entityId that is statically not a uuid", () => {
  it("scans every writeAudit call site in apps/api", () => {
    const files = execFileSync("git", ["ls-files", "src/**/*.ts", "src/*.ts"], {
      cwd: path.dirname(API_ROOT),
      encoding: "utf8",
    })
      .split("\n")
      .filter((f) => f && !f.endsWith(".test.ts"));

    const offenders: string[] = [];
    let seen = 0;
    for (const file of files) {
      readFileSync(path.join(path.dirname(API_ROOT), file), "utf8")
        .split("\n")
        .forEach((line, i) => {
          const match = /entityId:\s*(.+?)(?:,\s*$|,\s*meta|\s*\}|$)/.exec(line);
          if (!match) return;
          const trimmed = line.trimStart();
          if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
          seen++;
          const expr = match[1]!.trim();
          const literal = /^"([^"]*)"$/.exec(expr);
          const isBadLiteral = literal !== null && !isAuditEntityId(literal[1]!);
          const isTemplate = expr.startsWith("`") && expr.includes("${");
          const isJoin = /\.join\(/.test(expr);
          if (isBadLiteral || isTemplate || isJoin) offenders.push(`${file}:${i + 1} ${expr}`);
        });
    }

    expect(seen).toBeGreaterThan(50); // the scan found the call sites, rather than matching nothing
    expect(offenders).toEqual([]);
  });
});
