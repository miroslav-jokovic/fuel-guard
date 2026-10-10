import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { DOCUMENT_PROFILES } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { TransientModelError, type ModelClient } from "../model/readPages.js";
import { combinedSchemaHash, sectionWireSchemas } from "../model/readSections.js";
import { SEND_RULE_VERSION } from "../model/readPages.js";
import { sentCopyOf } from "../pages/canonical.js";
import { TIER_LIMITS } from "../model/visionTier.js";
import { ACCEPTANCE_RULE_VERSION, readCacheKey } from "./cacheKey.js";
import { executeRead, failUnavailableRead, type ReadGate } from "./executeRead.js";
import { READ_PROMPTS } from "./prompts.js";

/** Step 1.6 — one read, end to end, against the recorder: every outcome is one transition. */
const ORG = "org-1";
const READ = "read-1";
const SOURCE = "source-1";
const PROFILE = DOCUMENT_PROFILES.shipping_document;
const ENV: { HAZMAT_MODEL_A: string; HAZMAT_MODEL_B: string; DOC_READ_MODEL_A?: string; DOC_READ_MODEL_B?: string } = {
  HAZMAT_MODEL_A: "claude-sonnet-4-6", HAZMAT_MODEL_B: "claude-haiku-4-5", DOC_READ_MODEL_A: undefined, DOC_READ_MODEL_B: undefined,
};

async function png(shade: number): Promise<Buffer> {
  return sharp(Buffer.alloc(40 * 30 * 3, shade), { raw: { width: 40, height: 30, channels: 3 } }).png().toBuffer();
}
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

interface World {
  status?: string;
  profileVersion?: string;
  pages?: { id: string; page_number: number; path: string; bytes: Buffer; recordedSha?: string }[];
  classes?: Record<string, string>;
  cached?: unknown;
  reviews?: number;
  used?: number;
  gate?: ReadGate;
  missing?: string[];
  model?: () => Anthropic.Message;
  env?: Partial<typeof ENV>;
  /** The read names an assembly of these page ids, in this order, instead of the source (0455). */
  assembly?: string[];
}

function message(over: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: "m", type: "message", role: "assistant", model: "claude-sonnet-4-6",
    content: [{ type: "text", text: "{}", citations: null }],
    stop_reason: "end_turn", stop_sequence: null, stop_details: null, container: null,
    usage: { input_tokens: 3000, output_tokens: 400, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    ...over,
  } as Anthropic.Message;
}

async function world(w: World = {}) {
  const pages = w.pages ?? [
    { id: "p1", page_number: 1, path: "o/1.png", bytes: await png(200) },
    { id: "p2", page_number: 2, path: "o/2.png", bytes: await png(100) },
  ];
  const isRow = (q: RecordedQuery) => q.filters().some((f) => f.col === "id" && f.val === READ);
  const isCache = (q: RecordedQuery) => q.filters().some((f) => f.col === "cache_key");
  const rec = createSupabaseRecorder({
    tables: {
      document_reads: (q) => {
        // The cache lookup excludes this read with `.neq("id", READ)`, so it is told apart first.
        if (isCache(q)) return w.cached === undefined ? [] : [{ id: "older", result: w.cached }];
        if (isRow(q)) return [{ id: READ, source_id: w.assembly ? null : SOURCE, assembly_id: w.assembly ? "assembly-1" : null, profile: "shipping_document", profile_version: w.profileVersion ?? PROFILE.version, status: w.status ?? "queued" }];
        return [{ id: READ }, { id: "older" }];
      },
      document_pages: pages.map((p) => ({
        id: p.id, source_id: SOURCE, page_number: p.page_number, original_path: p.path,
        original_sha256: p.recordedSha ?? sha(p.bytes), normaliser_version: "1.0.0",
      })),
      document_assembly_pages: (w.assembly ?? []).map((page_id, i) => ({ position: i + 1, page_id, assembly_id: "assembly-1" })),
      document_read_reviews: { data: [], count: w.reviews ?? 0 },
      org_usage_month: w.used === undefined ? [] : [{ input_tokens: w.used, output_tokens: 0 }],
    },
    rpc: (fn) => (fn === "document_page_current_class"
      ? Object.entries(w.classes ?? {}).map(([page_id, page_class]) => ({ page_id, page_class }))
      : null),
    storage: {
      download: (path: string) => {
        const p = pages.find((x) => x.path === path);
        if (!p || w.missing?.includes(path)) return { data: null, error: { message: "Object not found" } };
        return { data: new Blob([new Uint8Array(p.bytes)]), error: null };
      },
    },
  });
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client: ModelClient = { messages: { create: async (req) => (requests.push(req), (w.model ?? (() => message()))()) } };
  const gates: string[] = [];
  const deps = {
    client,
    env: { ...ENV, ...w.env },
    now: () => new Date("2026-10-09T12:00:00Z"),
    gateFor: async (_a: unknown, org: string) => (gates.push(org), w.gate ?? { open: true, monthlyTokenBudget: null }),
  };
  const run = () => executeRead(rec.client, ORG, READ, deps);
  const transitions = () => rec.rpcs().filter((r) => r.fn === "document_read_transition").map((r) => r.args as Record<string, unknown>);
  return { rec, run, requests, transitions, pages, gates };
}

describe("executeRead — a read that reaches the model", () => {
  it("reads an assembly's pages in the assembly's order, not their page numbers, and keys the cache on that order", async () => {
    const w = await world({ assembly: ["p2", "p1"] });
    expect(await w.run()).toMatchObject({ outcome: "done", pages: 2 });
    expect(w.rec.storageCalls().map((c) => c.args[0])).toEqual(["o/2.png", "o/1.png"]);
    expect(w.rec.forTable("document_assembly_pages")[0]!.filters()).toContainEqual({ col: "assembly_id", val: "assembly-1" });
    const [p1, p2] = w.pages;
    expect(w.transitions()[1]!.p_cache_key).toBe(readCacheKey({
      profileVersion: PROFILE.version, models: ["claude-sonnet-4-6"], promptVersion: READ_PROMPTS.shipping_document.version,
      schemaHash: combinedSchemaHash(sectionWireSchemas("shipping_document").map((s) => [s.name, s.hash] as const)),
      acceptanceRule: ACCEPTANCE_RULE_VERSION,
      pages: [p2!, p1!].map((p) => ({ sha256: sha(p.bytes), normaliserVersion: "1.0.0" })),
      sendRule: SEND_RULE_VERSION, reviewEpoch: 0,
    }));
    expectOrgScoped(w.rec, ORG);
  });

  it("reads every page that is classed for the profile or not yet classed, and ends done with the merged document", async () => {
    const extra = { id: "p3", page_number: 3, path: "o/3.png", bytes: await png(50) };
    const w = await world({
      pages: [
        { id: "p1", page_number: 1, path: "o/1.png", bytes: await png(200) },
        { id: "p2", page_number: 2, path: "o/2.png", bytes: await png(100) },
        extra,
      ],
      classes: { p1: "bol", p3: "placard" },
    });
    const r = await w.run();
    expect(r).toEqual({ outcome: "done", cacheHit: false, inputTokens: 9000, outputTokens: 1200, pages: 2 });
    // Three section requests (Q-DR11), each carrying pages 1 and 2 — never the placard.
    expect(w.requests).toHaveLength(3);
    for (const req of w.requests) {
      const images = (req.messages[0]!.content as { type: string }[]).filter((c) => c.type === "image");
      expect(images).toHaveLength(2);
    }
    expect(w.rec.storageCalls().map((c) => [c.bucket, c.fn, c.args[0]])).toEqual([
      ["document-intake", "download", "o/1.png"],
      ["document-intake", "download", "o/2.png"],
    ]);
    const [reading, done] = w.transitions();
    expect(reading).toMatchObject({ p_org: ORG, p_read: READ, p_to: "reading" });
    expect(done).toMatchObject({
      p_org: ORG, p_read: READ, p_to: "done", p_result: PROFILE.empty(), p_evidence: [],
      p_models: ["claude-sonnet-4-6"], p_prompt_version: READ_PROMPTS.shipping_document.version,
      p_acceptance_rule_version: ACCEPTANCE_RULE_VERSION, p_input_tokens: 9000, p_output_tokens: 1200,
    });
    expect(w.transitions()).toHaveLength(2);
  });

  it("records the cache key of exactly what it read: the read pages' hashes, the versions and the review epoch", async () => {
    const w = await world({ reviews: 3 });
    await w.run();
    const done = w.transitions()[1]!;
    const hash = combinedSchemaHash(sectionWireSchemas("shipping_document").map((s) => [s.name, s.hash] as const));
    expect(done.p_schema_hash).toBe(hash);
    expect(done.p_cache_key).toBe(readCacheKey({
      profileVersion: PROFILE.version, models: ["claude-sonnet-4-6"], promptVersion: READ_PROMPTS.shipping_document.version,
      schemaHash: hash, acceptanceRule: ACCEPTANCE_RULE_VERSION,
      pages: w.pages.map((p) => ({ sha256: sha(p.bytes), normaliserVersion: "1.0.0" })), sendRule: SEND_RULE_VERSION, reviewEpoch: 3,
    }));
  });

  it("sends the model a copy re-derived from the verified original, after its page label", async () => {
    const w = await world();
    await w.run();
    const content = w.requests[0]!.messages[0]!.content as { type: string; text?: string; source?: { data: string; media_type: string } }[];
    expect(content[0]).toEqual({ type: "text", text: "Page 1 of 2:" });
    const expected = await sentCopyOf(w.pages[0]!.bytes, TIER_LIMITS.standard);
    expect(content[1]!.source).toEqual({ type: "base64", media_type: "image/webp", data: expected.bytes.toString("base64") });
  });

  /** The size of the image the model was sent, read back out of the request's bytes. */
  const sentSize = async (w: Awaited<ReturnType<typeof world>>) => {
    const content = w.requests[0]!.messages[0]!.content as { type: string; source?: { data: string } }[];
    const meta = await sharp(Buffer.from(content.find((c) => c.type === "image")!.source!.data, "base64")).metadata();
    return `${meta.width}x${meta.height}`;
  };
  const letterPage = async () => {
    const bytes = await sharp({ create: { width: 2550, height: 3300, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer();
    return [{ id: "p1", page_number: 1, path: "o/1.png", bytes }];
  };

  it("sizes a 300 DPI letter page to the standard tier's limit for Sonnet 4.6, so the API resizes nothing (D-DR16)", async () => {
    const w = await world({ pages: await letterPage() });
    await w.run();
    expect(await sentSize(w)).toBe("952x1232");
  });

  it("sends the same page at the high-resolution tier's size when the model is 4.7 or later", async () => {
    const w = await world({ pages: await letterPage(), env: { DOC_READ_MODEL_A: "claude-sonnet-5-5" } });
    await w.run();
    expect(await sentSize(w)).toBe("1688x2184");
  });

  it("names the org on every query and every RPC — the service role bypasses RLS", async () => {
    const w = await world({ used: 10 });
    await w.run();
    expectOrgScoped(w.rec, ORG);
    for (const r of w.rec.rpcs()) expect((r.args as { p_org: string }).p_org).toBe(ORG);
    expect(w.gates).toEqual([ORG]);
  });

  it("ends failed with the section's code and the tokens it spent when the model refuses", async () => {
    const w = await world({ model: () => message({ stop_reason: "refusal", content: [] }) });
    expect(await w.run()).toEqual({ outcome: "failed", code: "refusal", inputTokens: 9000, outputTokens: 1200 });
    expect(w.transitions()[1]).toMatchObject({ p_to: "failed", p_failure_code: "refusal", p_input_tokens: 9000 });
  });

  it("rethrows a transient model error with the read left reading, for the queue to retry", async () => {
    const w = await world({ model: () => { throw new Anthropic.RateLimitError(429, undefined, "rate limited", new Headers()); } });
    await expect(w.run()).rejects.toBeInstanceOf(TransientModelError);
    expect(w.transitions().map((t) => t.p_to)).toEqual(["reading"]);
  });
});

describe("executeRead — a read that ends before the model", () => {
  it("skips a read that is already done or failed (a lease-expired retry)", async () => {
    for (const status of ["done", "failed"]) {
      const w = await world({ status });
      expect(await w.run()).toEqual({ outcome: "skipped", reason: "already_terminal" });
      expect(w.rec.rpcs()).toEqual([]);
    }
  });

  it("refuses to read under a profile version other than the one the read was queued with", async () => {
    const w = await world({ profileVersion: "0.9.0" });
    await expect(w.run()).rejects.toThrow(/queued under shipping_document 0\.9\.0/);
    expect(w.rec.rpcs()).toEqual([]);
  });

  it("ends reading_disabled, with no download and no model call, when the consumer's gate is shut", async () => {
    const w = await world({ gate: { open: false, monthlyTokenBudget: null } });
    expect(await w.run()).toMatchObject({ outcome: "failed", code: "reading_disabled", inputTokens: 0 });
    expect(w.rec.storageCalls()).toEqual([]);
    expect(w.requests).toEqual([]);
  });

  it("ends no_readable_page when every page is classed outside the profile, or there are none", async () => {
    const classed = await world({ classes: { p1: "placard", p2: "other" } });
    expect(await classed.run()).toMatchObject({ outcome: "failed", code: "no_readable_page" });
    const none = await world({ pages: [] });
    expect(await none.run()).toMatchObject({ outcome: "failed", code: "no_readable_page" });
    expect(none.requests).toEqual([]);
  });

  it("ends integrity_mismatch when a stored original's bytes no longer hash to the recorded sha256, or are gone", async () => {
    const bytes = await png(200);
    const changed = await world({ pages: [{ id: "p1", page_number: 1, path: "o/1.png", bytes, recordedSha: "0".repeat(64) }] });
    expect(await changed.run()).toMatchObject({ outcome: "failed", code: "integrity_mismatch" });
    const gone = await world({ missing: ["o/2.png"] });
    expect(await gone.run()).toMatchObject({ outcome: "failed", code: "integrity_mismatch" });
    expect([...changed.requests, ...gone.requests]).toEqual([]);
  });

  it("replays a finished read with the same cache key, spending nothing and asking no budget (D17's order)", async () => {
    const cached = { identity: { bolNumber: "123" } };
    const w = await world({ cached, used: 10_000_000, gate: { open: true, monthlyTokenBudget: 1 } });
    expect(await w.run()).toEqual({ outcome: "done", cacheHit: true, inputTokens: 0, outputTokens: 0, pages: 2 });
    expect(w.transitions()[1]).toMatchObject({ p_to: "done", p_result: cached, p_input_tokens: 0, p_output_tokens: 0 });
    expect(w.requests).toEqual([]);
    expect(w.rec.forTable("org_usage_month")).toEqual([]);
    const lookup = w.rec.forTable("document_reads").find((q) => q.filters().some((f) => f.col === "cache_key"))!;
    expect(lookup.filters()).toEqual(expect.arrayContaining([{ col: "status", val: "done" }, { col: "id", val: READ }]));
  });

  it("ends budget_exhausted when this month's counter has reached the gate's budget", async () => {
    const w = await world({ used: 500_000, gate: { open: true, monthlyTokenBudget: 500_000 } });
    expect(await w.run()).toMatchObject({ outcome: "failed", code: "budget_exhausted" });
    expect(w.requests).toEqual([]);
    expect(w.rec.forTable("org_usage_month")[0]!.filters()).toContainEqual({ col: "yyyymm", val: "2026-10" });
  });
});

describe("failUnavailableRead — the read the queue gave up on", () => {
  it("ends a read still reading as model_unavailable", async () => {
    const rec = createSupabaseRecorder({ tables: { document_reads: [{ status: "reading" }] } });
    await failUnavailableRead(rec.client, ORG, READ);
    expect(rec.rpcs()).toEqual([{ fn: "document_read_transition", args: { p_org: ORG, p_read: READ, p_to: "failed", p_failure_code: "model_unavailable" } }]);
    expectOrgScoped(rec, ORG);
  });
  it("leaves a read that already ended alone", async () => {
    const rec = createSupabaseRecorder({ tables: { document_reads: [{ status: "done" }] } });
    await failUnavailableRead(rec.client, ORG, READ);
    expect(rec.rpcs()).toEqual([]);
  });
});
