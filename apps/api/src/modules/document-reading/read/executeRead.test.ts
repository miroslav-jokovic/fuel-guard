import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { DOCUMENT_PROFILES, printedHazmatLineSchema, readersAgree, readStageOf, type ReadStageTimings } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { TransientModelError, type ModelClient } from "../model/readPages.js";
import { combinedSchemaHash, sectionWireSchemas } from "../model/readSections.js";
import { SEND_RULE_VERSION } from "../model/readPages.js";
import { sentCopyOf, type TextLayer } from "../pages/canonical.js";
import { TIER_LIMITS } from "../model/visionTier.js";
import { ACCEPTANCE_RULE_VERSION, readCacheKey } from "./cacheKey.js";
import { executeRead, failUnavailableRead, type ReadGate } from "./executeRead.js";
import { READ_PROMPTS } from "./prompts.js";
import type { RecognisePage } from "../ocr/pageOcr.js";
import { CLASSIFY_PROMPT } from "../model/classifyPage.js";

/** Step 1.6 — one read, end to end, against the recorder: every outcome is one transition. */
const ORG = "org-1";
const READ = "read-1";
const SOURCE = "source-1";
const PROFILE = DOCUMENT_PROFILES.shipping_document;
const ENV: { HAZMAT_MODEL_A: string; HAZMAT_MODEL_B: string; DOC_READ_MODEL_A: string; DOC_READ_MODEL_B: string; DOC_FILE_READ_MODEL: string; DOC_CLASSIFY_MODEL: string } = {
  HAZMAT_MODEL_A: "claude-sonnet-4-6", HAZMAT_MODEL_B: "claude-haiku-4-5", DOC_READ_MODEL_A: "claude-sonnet-4-6", DOC_READ_MODEL_B: "claude-sonnet-5-5",
  // A pin distinct from both BOL readers, so a test can tell which one a one-reader profile asked.
  DOC_FILE_READ_MODEL: "claude-opus-5-5",
  DOC_CLASSIFY_MODEL: "claude-haiku-5-5",
};

async function png(shade: number): Promise<Buffer> {
  return sharp(Buffer.alloc(40 * 30 * 3, shade), { raw: { width: 40, height: 30, channels: 3 } }).png().toBuffer();
}
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

interface World {
  status?: string;
  /** The read's profile; `shipping_document` when absent. */
  profile?: keyof typeof DOCUMENT_PROFILES;
  profileVersion?: string;
  pages?: { id: string; page_number: number; path: string; bytes: Buffer; recordedSha?: string; textLayer?: TextLayer | null }[];
  classes?: Record<string, string>;
  /** The current verdict's rotation for a classed page (0456); absent = not answered. */
  rotations?: Record<string, number>;
  cached?: unknown;
  cachedEvidence?: unknown[];
  /** Per-model documents: each section request is answered with that model's document's slice. */
  documents?: Record<string, unknown>;
  reviews?: number;
  used?: number;
  gate?: ReadGate;
  missing?: string[];
  /** Answers every read request; a Promise lets a test hold the answer back. */
  model?: () => Anthropic.Message | Promise<Anthropic.Message>;
  env?: Partial<typeof ENV>;
  /** The read names an assembly of these page ids, in this order, instead of the source (0455). */
  assembly?: string[];
  /**
   * The classifier's answer for a page with no verdict yet (P2), by page id; a page absent here is
   * answered `bol`, upright. A function lets a test make the classifier refuse, fail, or hold its answer back.
   */
  classifier?: Record<string, { pageClass: string; rotation: string }> | ((pageId: string) => Anthropic.Message | Promise<Anthropic.Message>);
  /** The OCR witness's engine (§7B A5); absent = none, as with DOC_OCR_WITNESS=off. */
  ocr?: RecognisePage;
  /** Every mid-read stage mark (TC0.2) answers with this error, as an RPC the database refused would. */
  markError?: { message: string };
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

/** The part of `doc` a section's wire schema asks for: its properties, recursively through objects. */
function sliceBySchema(doc: unknown, schema: unknown): unknown {
  const props = (schema as { properties?: Record<string, unknown> }).properties;
  if (!props || doc === null || typeof doc !== "object" || Array.isArray(doc)) return doc;
  return Object.fromEntries(Object.entries(props).map(([k, sub]) => [k, sliceBySchema((doc as Record<string, unknown>)[k], sub)]));
}

/** A mid-read stage mark (TC0.2, 0529): reading → reading carrying the stages finished so far. */
const isMark = (m: Record<string, unknown>) => m.p_to === "reading" && m.p_stage_timings !== undefined;

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
        if (isCache(q)) return w.cached === undefined ? [] : [{ id: "older", result: w.cached, evidence: w.cachedEvidence ?? [] }];
        if (isRow(q)) return [{ id: READ, source_id: w.assembly ? null : SOURCE, assembly_id: w.assembly ? "assembly-1" : null, profile: w.profile ?? "shipping_document", profile_version: w.profileVersion ?? DOCUMENT_PROFILES[w.profile ?? "shipping_document"].version, status: w.status ?? "queued" }];
        return [{ id: READ }, { id: "older" }];
      },
      document_pages: pages.map((p) => ({
        id: p.id, source_id: SOURCE, page_number: p.page_number, original_path: p.path,
        original_sha256: p.recordedSha ?? sha(p.bytes), normaliser_version: "1.0.0", text_layer: p.textLayer ?? null,
      })),
      document_assembly_pages: (w.assembly ?? []).map((page_id, i) => ({ position: i + 1, page_id, assembly_id: "assembly-1" })),
      document_read_reviews: { data: [], count: w.reviews ?? 0 },
      org_usage_month: w.used === undefined ? [] : [{ input_tokens: w.used, output_tokens: 0 }],
    },
    rpc: (fn, args) => {
      if (fn === "document_page_current_class") {
        return Object.entries(w.classes ?? {}).map(([page_id, page_class]) => ({ page_id, page_class, rotation: w.rotations?.[page_id] ?? null }));
      }
      if (w.markError && isMark(args as Record<string, unknown>)) return { error: w.markError };
      return null;
    },
    storage: {
      download: (path: string) => {
        const p = pages.find((x) => x.path === path);
        if (!p || w.missing?.includes(path)) return { data: null, error: { message: "Object not found" } };
        return { data: new Blob([new Uint8Array(p.bytes)]), error: null };
      },
    },
  });
  // Read requests and classifier requests are told apart by the system prompt; the classifier is asked
  // about pages in document order, so its n-th request is about the n-th unclassified page.
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const classifyRequests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const unclassified = pages.filter((p) => !(w.classes ?? {})[p.id]).map((p) => p.id);
  const classifierAnswer = (pageId: string): Anthropic.Message | Promise<Anthropic.Message> => {
    if (typeof w.classifier === "function") return w.classifier(pageId);
    const a = w.classifier?.[pageId] ?? { pageClass: "bol", rotation: "0" };
    return message({ content: [{ type: "text", text: JSON.stringify(a), citations: null }], usage: { input_tokens: 500, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } as Partial<Anthropic.Message>);
  };
  const client: ModelClient = {
    messages: {
      create: async (req) => {
        if (req.system === CLASSIFY_PROMPT.system) {
          classifyRequests.push(req);
          return classifierAnswer(unclassified[classifyRequests.length - 1]!);
        }
        requests.push(req);
        if (w.documents?.[req.model]) {
          const slice = sliceBySchema(w.documents[req.model], (req.output_config as { format: { schema: unknown } }).format.schema);
          return message({ content: [{ type: "text", text: JSON.stringify(slice), citations: null }] } as Partial<Anthropic.Message>);
        }
        return (w.model ?? (() => message()))();
      },
    },
  };
  const gates: string[] = [];
  // Each reading of the clock is 100 ms after the last, so every stage's timing is a known, non-zero number.
  let tick = 0;
  const deps = {
    client,
    env: { ...ENV, ...w.env },
    now: () => new Date("2026-10-09T12:00:00Z"),
    clock: () => (tick += 100),
    gateFor: async (_a: unknown, org: string) => (gates.push(org), w.gate ?? { open: true, monthlyTokenBudget: null }),
    ocr: w.ocr,
  };
  const run = () => executeRead(rec.client, ORG, READ, deps);
  const moves = () => rec.rpcs().filter((r) => r.fn === "document_read_transition").map((r) => r.args as Record<string, unknown>);
  // The read's own moves (queued → reading → its outcome); the stage marks written in between are `marks`.
  const transitions = () => moves().filter((m) => !isMark(m));
  const marks = () => moves().filter(isMark);
  return { rec, run, requests, classifyRequests, transitions, marks, moves, pages, gates };
}

describe("executeRead — a one-reader profile (UNIT-FILES-PLAN UF7b2)", () => {
  it("asks only its own pin, records only that model, and judges the evidence with no pass B", async () => {
    const batch = { papers: [{ pageFrom: 1, pageTo: 2, kind: "irp", vins: ["1FUJHHDR0RLVW9438"], expiresOn: null }] };
    const w = await world({ profile: "compliance_paper", documents: { "claude-opus-5-5": batch } });
    expect(await w.run()).toMatchObject({ outcome: "done", pages: 2 });
    expect(w.requests.map((r) => r.model)).toEqual(["claude-opus-5-5"]);
    const done = w.transitions().at(-1)!;
    expect(done.p_models).toEqual(["claude-opus-5-5"]);
    const evidence = done.p_evidence as Array<{ path: string; status: string; sources: Array<{ reader: string }> }>;
    expect(evidence.flatMap((e) => e.sources.map((s) => s.reader))).not.toContain("passB");
    // One reader asked, one reader read nothing: not read, not "check".
    expect(evidence.find((e) => e.path === "papers[0].expiresOn")?.status).toBe("not_read");
    expect(evidence.find((e) => e.path === "papers[0].vins")?.status).toBe("check");
    expect((done.p_replay_inputs as { passB: unknown }).passB).toBeNull();
    expectOrgScoped(w.rec, ORG);
  });
});

describe("executeRead — a read that reaches the model", () => {
  it("reads an assembly's pages in the assembly's order, not their page numbers, and keys the cache on that order", async () => {
    const w = await world({ assembly: ["p2", "p1"], classes: { p1: "bol", p2: "bol" } });
    expect(await w.run()).toMatchObject({ outcome: "done", pages: 2 });
    expect(w.rec.storageCalls().map((c) => c.args[0])).toEqual(["o/2.png", "o/1.png"]);
    expect(w.rec.forTable("document_assembly_pages")[0]!.filters()).toContainEqual({ col: "assembly_id", val: "assembly-1" });
    const [p1, p2] = w.pages;
    expect(w.transitions()[1]!.p_cache_key).toBe(readCacheKey({
      profileVersion: PROFILE.version, models: ["claude-sonnet-4-6", "claude-sonnet-5-5"], promptVersion: READ_PROMPTS.shipping_document.version,
      schemaHash: combinedSchemaHash(sectionWireSchemas("shipping_document").map((s) => [s.name, s.hash] as const)),
      acceptanceRule: ACCEPTANCE_RULE_VERSION,
      pages: [p2!, p1!].map((p) => ({ sha256: sha(p.bytes), normaliserVersion: "1.0.0", rotation: 0 })),
      sendRule: SEND_RULE_VERSION, reviewEpoch: 0,
    }));
    expectOrgScoped(w.rec, ORG);
  });

  it("classifies the page with no verdict first, reads every page classed for the profile, and ends done with both spends", async () => {
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
    // 18,000 / 2,400 for three section reads by each of two readers, plus 500 / 20 for classifying p2, the
    // one page with no verdict.
    expect(r).toEqual({
      outcome: "done", cacheHit: false, inputTokens: 18_500, outputTokens: 2420, pages: 2,
      // No OCR engine in this world, so no `ocr` stage.
      stageTimings: { classify: expect.any(Number), fetch: expect.any(Number), passA: expect.any(Number), passB: expect.any(Number), evidence: expect.any(Number) },
    });
    expect(w.classifyRequests).toHaveLength(1);
    // The classifier's own pin (DOC_CLASSIFY_MODEL), never the reader's or pass B's.
    expect(w.classifyRequests[0]!.model).toBe("claude-haiku-5-5");
    expect(w.rec.writtenRows("document_page_classes")).toEqual([{
      org_id: ORG, page_id: "p2", page_class: "bol", set_by: "classifier", model: "claude-sonnet-4-6",
      prompt_version: CLASSIFY_PROMPT.version, rotation: 0,
    }]);
    // Three section requests (Q-DR11) by pass A, then the same three by pass B, each carrying pages 1 and 2 —
    // never the placard.
    expect(w.requests.map((r) => r.model)).toEqual([...Array(3).fill("claude-sonnet-4-6"), ...Array(3).fill("claude-sonnet-5-5")]);
    for (const req of w.requests) {
      const images = (req.messages[0]!.content as { type: string }[]).filter((c) => c.type === "image");
      expect(images).toHaveLength(2);
    }
    expect(w.rec.storageCalls().map((c) => [c.bucket, c.fn, c.args[0]])).toEqual([
      ["document-intake", "download", "o/2.png"], // the classifier's look at p2
      ["document-intake", "download", "o/1.png"],
      ["document-intake", "download", "o/2.png"],
    ]);
    const [reading, done] = w.transitions();
    expect(reading).toMatchObject({ p_org: ORG, p_read: READ, p_to: "reading" });
    expect(done).toMatchObject({
      p_org: ORG, p_read: READ, p_to: "done", p_result: PROFILE.empty(), p_evidence: expect.any(Array),
      p_models: ["claude-sonnet-4-6", "claude-sonnet-5-5"], p_prompt_version: READ_PROMPTS.shipping_document.version,
      p_acceptance_rule_version: ACCEPTANCE_RULE_VERSION, p_input_tokens: 18_500, p_output_tokens: 2420,
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
      profileVersion: PROFILE.version, models: ["claude-sonnet-4-6", "claude-sonnet-5-5"], promptVersion: READ_PROMPTS.shipping_document.version,
      schemaHash: hash, acceptanceRule: ACCEPTANCE_RULE_VERSION,
      pages: w.pages.map((p) => ({ sha256: sha(p.bytes), normaliserVersion: "1.0.0", rotation: 0 })), sendRule: SEND_RULE_VERSION, reviewEpoch: 3,
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
    const w = await world({ model: () => message({ stop_reason: "refusal", content: [] }), classes: { p1: "bol", p2: "bol" } });
    // Both readers' three sections, 3,000 / 400 each: pass B was asked at the same moment as pass A.
    // Every page already classed, so no `classify`; refused before the evidence, so no `evidence`.
    expect(await w.run()).toEqual({
      outcome: "failed", code: "refusal", inputTokens: 18_000, outputTokens: 2400,
      stageTimings: { fetch: expect.any(Number), passA: expect.any(Number), passB: expect.any(Number) },
    });
    expect(w.transitions()[1]).toMatchObject({ p_to: "failed", p_failure_code: "refusal", p_input_tokens: 18_000 });
  });

  it("rethrows a transient model error with the read left reading, for the queue to retry", async () => {
    const w = await world({ model: () => { throw new Anthropic.RateLimitError(429, undefined, "rate limited", new Headers()); } });
    await expect(w.run()).rejects.toBeInstanceOf(TransientModelError);
    expect(w.transitions().map((t) => t.p_to)).toEqual(["reading"]);
  });
});

describe("executeRead — stage timings (TWO-CLICK-READER-PLAN TC0.2, D-TC4)", () => {
  // An OCR engine that answers after both readers have, as the cold engine of 2026-10-29 did.
  const lateOcr: RecognisePage = async () => (await new Promise((r) => setTimeout(r, 5)), { items: [], view: null });

  it("writes every stage it ran onto the row with the outcome, the same numbers the outcome carries", async () => {
    const w = await world({ ocr: lateOcr });
    const r = await w.run();
    expect(r.outcome).toBe("done");
    const timings = (r as { stageTimings: Record<string, number> }).stageTimings;
    expect(Object.keys(timings).sort()).toEqual(["classify", "evidence", "fetch", "ocr", "passA", "passB"]);
    for (const ms of Object.values(timings)) expect(ms).toBeGreaterThan(0);
    expect(w.transitions().at(-1)!.p_stage_timings).toEqual(timings);
  });

  it("times the OCR witness by its own run, so an OCR answering after the readers shows as the longer stage", async () => {
    const w = await world({ ocr: lateOcr, classes: { p1: "bol", p2: "bol" } });
    const t = ((await w.run()) as { stageTimings: Record<string, number> }).stageTimings;
    expect(t.ocr).toBeGreaterThan(t.passA!);
    expect(t.ocr).toBeGreaterThan(t.passB!);
  });

  it("marks the row twice while reading — pages fetched, then both readers answered — and ends with the outcome", async () => {
    const w = await world({ ocr: lateOcr });
    await w.run();
    const [fetched, answered] = w.marks().map((m) => m.p_stage_timings as ReadStageTimings);
    expect(w.marks()).toHaveLength(2);
    expect(Object.keys(fetched!).sort()).toEqual(["classify", "fetch"]);
    expect(answered).toMatchObject({ passA: expect.any(Number), passB: expect.any(Number) });
    // The screen's words come from what the marks say was finished (readStageOf), never from a clock.
    expect(readStageOf("reading", fetched!)).toBe("reading");
    expect(readStageOf("reading", answered!)).toBe("checking");
    expect(w.moves().map((m) => (isMark(m) ? "mark" : m.p_to))).toEqual(["reading", "mark", "mark", "done"]);
  });

  it("finishes the read exactly as it would when the database refuses every stage mark", async () => {
    const refused = await world({ markError: { message: "the stage mark was refused" } });
    const fine = await world();
    expect(await refused.run()).toEqual(await fine.run());
    expect(refused.marks()).toHaveLength(2);
    expect(refused.transitions()).toEqual(fine.transitions());
  });

  it("marks a refused read once, at the pages fetched, before ending it failed with its stages", async () => {
    const w = await world({ model: () => message({ stop_reason: "refusal", content: [] }), classes: { p1: "bol", p2: "bol" } });
    await w.run();
    expect(w.moves().map((m) => (isMark(m) ? "mark" : m.p_to))).toEqual(["reading", "mark", "failed"]);
    expect(w.transitions().at(-1)!.p_stage_timings).toMatchObject({ fetch: expect.any(Number), passA: expect.any(Number) });
  });

  it("does not mark a cache hit, which reads nothing", async () => {
    const w = await world({ cached: { identity: {} }, classes: { p1: "bol", p2: "bol" } });
    await w.run();
    expect(w.marks()).toEqual([]);
    expect(w.transitions().at(-1)!.p_stage_timings).toEqual({ fetch: expect.any(Number) });
  });
});

describe("executeRead — P2, classify and orient (§7A.3, Q-DR19 (a))", () => {
  it("leaves out a page the classifier calls a placard, and sends a sideways page turned upright", async () => {
    const landscape = await sharp({ create: { width: 60, height: 40, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer();
    const w = await world({
      pages: [
        { id: "p1", page_number: 1, path: "o/1.png", bytes: landscape },
        { id: "p2", page_number: 2, path: "o/2.png", bytes: await png(90) },
      ],
      classifier: { p1: { pageClass: "bol", rotation: "90" }, p2: { pageClass: "placard", rotation: "0" } },
    });
    expect(await w.run()).toMatchObject({ outcome: "done", pages: 1 });
    expect(w.classifyRequests).toHaveLength(2);
    // One page reached the reader, and it is the BOL page turned a quarter clockwise: 60×40 became 40×60.
    const content = w.requests[0]!.messages[0]!.content as { type: string; source?: { data: string } }[];
    const images = content.filter((c) => c.type === "image");
    expect(images).toHaveLength(1);
    const meta = await sharp(Buffer.from(images[0]!.source!.data, "base64")).metadata();
    expect(`${meta.width}x${meta.height}`).toBe("40x60");
    expect(w.rec.writtenRows("document_page_classes").map((r) => [r.page_id, r.page_class, r.rotation]))
      .toEqual([["p1", "bol", 90], ["p2", "placard", 0]]);
  });

  it("asks no classifier about a page that already has a verdict, and turns it by that verdict's rotation", async () => {
    const landscape = await sharp({ create: { width: 60, height: 40, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer();
    const w = await world({ pages: [{ id: "p1", page_number: 1, path: "o/1.png", bytes: landscape }], classes: { p1: "bol" }, rotations: { p1: 270 } });
    await w.run();
    expect(w.classifyRequests).toEqual([]);
    expect(w.rec.writtenRows("document_page_classes")).toEqual([]);
    const img = (w.requests[0]!.messages[0]!.content as { type: string; source?: { data: string } }[]).find((c) => c.type === "image")!;
    const meta = await sharp(Buffer.from(img.source!.data, "base64")).metadata();
    expect(`${meta.width}x${meta.height}`).toBe("40x60");
  });

  it("asks the classifier about every unclassified page before the first answer, and writes the verdicts in page order", async () => {
    const pages = await Promise.all(Array.from({ length: 10 }, async (_, i) => ({ id: `p${i + 1}`, page_number: i + 1, path: `o/${i + 1}.png`, bytes: await png(40 + i) })));
    let answered = 0;
    const asked: number[] = [];
    const later = (m: Anthropic.Message) => new Promise<Anthropic.Message>((r) => setTimeout(() => (answered++, r(m)), 5));
    const w = await world({
      pages,
      classifier: (id) => (asked.push(answered), later(message({ content: [{ type: "text", text: JSON.stringify({ pageClass: id === "p2" ? "placard" : "bol", rotation: "0" }), citations: null }] } as Partial<Anthropic.Message>))),
    });
    expect(await w.run()).toMatchObject({ outcome: "done", pages: 9 });
    // CLASSIFY_AT_ONCE = 8: the first eight went out together, and the last two once those had answered.
    expect(asked).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 8, 8]);
    expect(w.rec.writtenRows("document_page_classes").map((r) => [r.page_id, r.page_class]))
      .toEqual(pages.map((p) => [p.id, p.id === "p2" ? "placard" : "bol"]));
  });

  it("writes the verdicts its siblings answered before rethrowing one page's transient failure", async () => {
    const w = await world({
      classifier: (id) => {
        if (id === "p1") throw new Anthropic.APIError(529, { type: "error", error: { type: "overloaded_error" } }, "overloaded", new Headers());
        return message({ content: [{ type: "text", text: JSON.stringify({ pageClass: "bol", rotation: "0" }), citations: null }] } as Partial<Anthropic.Message>);
      },
    });
    await expect(w.run()).rejects.toBeInstanceOf(TransientModelError);
    expect(w.rec.writtenRows("document_page_classes").map((r) => r.page_id)).toEqual(["p2"]);
    expect(w.requests).toEqual([]);
  });

  it("still reads a page the classifier could not answer, writing no verdict for it", async () => {
    const w = await world({ classifier: () => message({ stop_reason: "refusal", content: [] }) });
    expect(await w.run()).toMatchObject({ outcome: "done", pages: 2 });
    expect(w.rec.writtenRows("document_page_classes")).toEqual([]);
  });

  it("keys the cache on each read page's turn, so the same bytes turned are another read", async () => {
    const turned = await world({ classifier: { p1: { pageClass: "bol", rotation: "180" } } });
    const upright = await world();
    await turned.run();
    await upright.run();
    expect(turned.transitions()[1]!.p_cache_key).not.toBe(upright.transitions()[1]!.p_cache_key);
  });

  it("asks the budget before classifying, and spends nothing on a page when it is used up", async () => {
    const w = await world({ used: 500_000, gate: { open: true, monthlyTokenBudget: 500_000 } });
    expect(await w.run()).toMatchObject({ outcome: "failed", code: "budget_exhausted", inputTokens: 0 });
    expect(w.classifyRequests).toEqual([]);
  });

  it("counts a refused read's classification tokens too: the model was asked", async () => {
    const w = await world({ model: () => message({ stop_reason: "refusal", content: [] }) });
    expect(await w.run()).toEqual({
      outcome: "failed", code: "refusal", inputTokens: 19_000, outputTokens: 2440,
      stageTimings: { classify: expect.any(Number), fetch: expect.any(Number), passA: expect.any(Number), passB: expect.any(Number) },
    });
  });
});

describe("executeRead — evidence (§7B A2 + A3)", () => {
  const empty = PROFILE.empty();
  const withLine = (over: Record<string, unknown>) =>
    ({ ...empty, hazmat: { ...empty.hazmat, lines: [printedHazmatLineSchema.parse({ idText: "UN2735", psn: "Amines, liquid, corrosive, n.o.s.", hazardClass: "8", pg: "II", ...over })] } });

  it("asks the second reader, records both readers' values and the table, and returns pass A's document", async () => {
    // 0132900 (§7B.2): Sonnet 4.6 read 9 drums, the paper and Sonnet 5.5 say 6.
    const w = await world({ classes: { p1: "bol", p2: "bol" }, documents: {
      "claude-sonnet-4-6": withLine({ packageCount: 9 }),
      "claude-sonnet-5-5": withLine({ packageCount: 6 }),
    } });
    expect(await w.run()).toMatchObject({ outcome: "done", cacheHit: false });
    const done = w.transitions()[1]!;
    expect((done.p_result as typeof empty).hazmat.lines[0]!.packageCount).toBe(9);
    const ev = done.p_evidence as { path: string; status: string; ruleVersion: string; sources: { reader: string; value: unknown }[] }[];
    const count = ev.find((e) => e.path === "hazmat.lines[0].packageCount")!;
    expect(count.sources.map((s) => [s.reader, s.value])).toEqual([["passA", 9], ["passB", 6]]);
    expect(readersAgree(count as never)).toBe(false);
    expect(ev.find((e) => e.path === "hazmat.lines[0].idText")!.sources.map((s) => s.reader)).toEqual(["passA", "passB", "table"]);
    expect(ev.some((e) => e.status === "read")).toBe(false);
    // Evidence names the rule that made it — never "none" — and the read carries the same rule.
    expect(done.p_acceptance_rule_version).not.toBe("none");
    expect(new Set(ev.map((e) => e.ruleVersion))).toEqual(new Set([done.p_acceptance_rule_version]));
  });

  it("finishes on pass A's document with one reader's evidence when pass B refuses, counting both spends", async () => {
    let n = 0;
    const w = await world({ classes: { p1: "bol", p2: "bol" }, model: () => (++n > 3 ? message({ stop_reason: "refusal", content: [] }) : message()) });
    expect(await w.run()).toMatchObject({ outcome: "done", inputTokens: 18_000 });
    const ev = w.transitions()[1]!.p_evidence as { sources: { reader: string }[] }[];
    expect(ev.length).toBeGreaterThan(0);
    expect(ev.every((e) => !e.sources.some((s) => s.reader === "passB"))).toBe(true);
  });

  it("asks both readers at once, before either answers, and counts pass B's spend when pass A fails", async () => {
    let answered = 0;
    const asked: number[] = [];
    const w = await world({
      classes: { p1: "bol", p2: "bol" },
      model: () => (asked.push(answered), new Promise<Anthropic.Message>((r) => setTimeout(() => (answered++, r(message({ stop_reason: "refusal", content: [] }))), 5))),
    });
    expect(await w.run()).toMatchObject({ outcome: "failed", code: "refusal", inputTokens: 18_000 });
    expect(w.requests.map((r) => r.model)).toEqual([...Array(3).fill("claude-sonnet-4-6"), ...Array(3).fill("claude-sonnet-5-5")]);
    // All six section requests went out before the first answer came back: nobody waited on pass A.
    expect(asked).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("replays a cache hit's own evidence with its result", async () => {
    const stored = [{ path: "identity.bolNumber", value: "68275", status: "check", sources: [], ruleVersion: ACCEPTANCE_RULE_VERSION }];
    const w = await world({ cached: withLine({}), cachedEvidence: stored, classes: { p1: "bol", p2: "bol" } });
    expect(await w.run()).toMatchObject({ outcome: "done", cacheHit: true });
    expect(w.transitions()[1]!.p_evidence).toEqual(stored);
    expect(w.requests).toEqual([]);
  });
});

describe("executeRead — the OCR witness (§7B A5)", () => {
  const empty = PROFILE.empty();
  const withCount = (packageCount: number) =>
    ({ ...empty, hazmat: { ...empty.hazmat, lines: [printedHazmatLineSchema.parse({ idText: "UN2735", hazardClass: "8", packageCount })] } });
  const box = (text: string, y: number) => ({ text, box: { x: 2, y, width: 20, height: 4 } });
  const twoReaders = { "claude-sonnet-4-6": withCount(9), "claude-sonnet-5-5": withCount(6) };

  it("gives the engine every read page from its verified original, turned upright, and records the row's word on the count", async () => {
    const sizes: number[][] = [];
    const ocr: RecognisePage = async (b) => {
      const m = await sharp(b).metadata();
      sizes.push([m.width!, m.height!]);
      return { items: sizes.length === 1 ? [box("UN2735 Amines 8 PG II", 10), box("6", 11)] : [], view: null };
    };
    const w = await world({ classes: { p1: "bol", p2: "bol" }, rotations: { p2: 90 }, documents: twoReaders, ocr });
    expect(await w.run()).toMatchObject({ outcome: "done" });
    // 40 × 30 originals at full size; p2 turned a quarter, as the model's copy is.
    expect(sizes).toEqual([[40, 30], [30, 40]]);
    const ev = w.transitions()[1]!.p_evidence as { path: string; sources: { reader: string; page: number | null; value: unknown }[] }[];
    const count = ev.find((e) => e.path === "hazmat.lines[0].packageCount")!;
    expect(count.sources.map((s) => [s.reader, s.value])).toEqual([["passA", 9], ["passB", 6], ["ocr", 6]]);
    expect(count.sources.find((s) => s.reader === "ocr")!.page).toBe(1);
  });

  it("finishes the read without the witness when the engine fails", async () => {
    const w = await world({ classes: { p1: "bol", p2: "bol" }, documents: twoReaders, ocr: async () => { throw new Error("engine died"); } });
    expect(await w.run()).toMatchObject({ outcome: "done" });
    const ev = w.transitions()[1]!.p_evidence as { sources: { reader: string }[] }[];
    expect(ev.some((e) => e.sources.some((s) => s.reader === "ocr"))).toBe(false);
    expect(ev.some((e) => e.sources.some((s) => s.reader === "passB"))).toBe(true);
  });

  it("keeps pass B's whole document and the OCR words it judged on, so the read can be judged again (RC2, 0487)", async () => {
    const ocr: RecognisePage = async () => ({ items: [box("UN2735 Amines 8 PG II", 10), box("6", 11)], view: null });
    const w = await world({ classes: { p1: "bol", p2: "bol" }, documents: twoReaders, ocr });
    expect(await w.run()).toMatchObject({ outcome: "done" });
    const replay = w.transitions()[1]!.p_replay_inputs as { passB: unknown; ocr: { page: number; items: unknown[] }[] | null; textLayer: unknown };
    expect(replay.passB).toEqual(twoReaders["claude-sonnet-5-5"]);
    expect(replay).toHaveProperty("textLayer", null); // image pages: no text layer to keep
    expect(replay.ocr!.map((p) => [p.page, p.items.length])).toEqual([[1, 2], [2, 2]]);
  });

  it("stores no replay inputs for a cache hit, which judged nothing", async () => {
    const w = await world({ cached: withCount(6), classes: { p1: "bol", p2: "bol" } });
    expect(await w.run()).toMatchObject({ outcome: "done", cacheHit: true });
    expect(w.transitions()[1]!.p_replay_inputs).toBeNull();
  });

  it("runs no OCR for a cache hit", async () => {
    const ocr = vi.fn<RecognisePage>(async () => ({ items: [], view: null }));
    const w = await world({ cached: withCount(6), classes: { p1: "bol", p2: "bol" }, ocr });
    expect(await w.run()).toMatchObject({ outcome: "done", cacheHit: true });
    expect(ocr).not.toHaveBeenCalled();
  });
});

describe("executeRead — the text-layer witness (§7B A4)", () => {
  const empty = PROFILE.empty();
  const withCount = (packageCount: number) =>
    ({ ...empty, hazmat: { ...empty.hazmat, lines: [printedHazmatLineSchema.parse({ idText: "UN2735", hazardClass: "8", packageCount })] } });
  const twoReaders = { "claude-sonnet-4-6": withCount(9), "claude-sonnet-5-5": withCount(6) };
  const layer: TextLayer = { words: [
    { text: "UN2735", bbox: { x: 0.3, y: 0.4, w: 0.05, h: 0.01 } },
    { text: "6", bbox: { x: 0.05, y: 0.4, w: 0.01, h: 0.01 } },
  ] };
  const evidenceOf = (w: Awaited<ReturnType<typeof world>>) =>
    w.transitions()[1]!.p_evidence as { path: string; sources: { reader: string; value: unknown }[] }[];

  it("asks for each page's stored text layer and records the row's word on the count when every read page has one", async () => {
    const pages = [{ id: "p1", page_number: 1, path: "o/1.png", bytes: await png(200), textLayer: layer }];
    const w = await world({ pages, classes: { p1: "bol" }, documents: twoReaders });
    expect(await w.run()).toMatchObject({ outcome: "done" });
    const select = w.rec.forTable("document_pages")[0]!.ops.find((o) => o.method === "select");
    expect(String(select?.args[0])).toContain("text_layer");
    const count = evidenceOf(w).find((e) => e.path === "hazmat.lines[0].packageCount")!;
    expect(count.sources.map((s) => [s.reader, s.value])).toEqual([["passA", 9], ["passB", 6], ["textLayer", 6]]);
  });

  it("finds the row on a page read turned, by turning the text layer with it", async () => {
    // Stored sideways: the id and the count share a column; turned a quarter clockwise they share a line.
    const sideways: TextLayer = { words: [
      { text: "UN2735", bbox: { x: 0.4, y: 0.3, w: 0.01, h: 0.05 } },
      { text: "6", bbox: { x: 0.4, y: 0.05, w: 0.01, h: 0.01 } },
    ] };
    const pages = [{ id: "p1", page_number: 1, path: "o/1.png", bytes: await png(200), textLayer: sideways }];
    const w = await world({ pages, classes: { p1: "bol" }, rotations: { p1: 90 }, documents: twoReaders });
    expect(await w.run()).toMatchObject({ outcome: "done" });
    const count = evidenceOf(w).find((e) => e.path === "hazmat.lines[0].packageCount")!;
    expect(count.sources.find((s) => s.reader === "textLayer")?.value).toBe(6);
  });

  it("records none when one read page is a scan", async () => {
    const pages = [
      { id: "p1", page_number: 1, path: "o/1.png", bytes: await png(200), textLayer: layer },
      { id: "p2", page_number: 2, path: "o/2.png", bytes: await png(100), textLayer: null },
    ];
    const w = await world({ pages, classes: { p1: "bol", p2: "bol" }, documents: twoReaders });
    expect(await w.run()).toMatchObject({ outcome: "done" });
    expect(evidenceOf(w).some((e) => e.sources.some((s) => s.reader === "textLayer"))).toBe(false);
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
    const w = await world({ cached, used: 10_000_000, gate: { open: true, monthlyTokenBudget: 1 }, classes: { p1: "bol", p2: "bol" } });
    // A cache hit stops after `fetch`: no reader ran, so it has no reader's time.
    expect(await w.run()).toEqual({ outcome: "done", cacheHit: true, inputTokens: 0, outputTokens: 0, pages: 2, stageTimings: { fetch: expect.any(Number) } });
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
  it("ends a read still queued through reading — the only road 0448's state machine has to failed", async () => {
    const rec = createSupabaseRecorder({ tables: { document_reads: [{ status: "queued" }] } });
    expect(await failUnavailableRead(rec.client, ORG, READ)).toBe(true);
    expect(rec.rpcs().map((r) => (r.args as { p_to: string }).p_to)).toEqual(["reading", "failed"]);
  });
  it("leaves a read that already ended alone, and says it did nothing", async () => {
    for (const status of ["done", "failed"]) {
      const rec = createSupabaseRecorder({ tables: { document_reads: [{ status }] } });
      expect(await failUnavailableRead(rec.client, ORG, READ)).toBe(false);
      expect(rec.rpcs()).toEqual([]);
    }
  });
});
