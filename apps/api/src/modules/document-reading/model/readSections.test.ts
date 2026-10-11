import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { DOCUMENT_PROFILES, sectionSchema } from "@silvicom/shared";
import { TransientModelError, type ModelClient, type ReadPagesInput } from "./readPages.js";
import { FAILURE_PRECEDENCE, combinedSchemaHash, readSections, sectionWireSchemas } from "./readSections.js";
import { worstCaseShippingDocument } from "./worstCaseShippingDocument.js";

/** Q-DR11 (ruled 2026-10-09): one strict request per section, in parallel, merged into one result. */
const P = DOCUMENT_PROFILES.shipping_document;
const INPUT: ReadPagesInput = {
  profile: "shipping_document",
  pages: [{ base64: "AAAA", mediaType: "image/png" }],
  model: "claude-sonnet-4-6",
  prompt: { version: "test-1", system: "You are a transcription tool." },
};
const DOC = worstCaseShippingDocument();
const slice = (name: string) => sectionSchema(P, name).parse(DOC);

/** Which section a request is for — read off the top-level keys of the schema it sends. */
function sectionOf(req: Anthropic.MessageCreateParamsNonStreaming): string {
  const keys = Object.keys((req.output_config?.format as unknown as { schema: { properties: object } }).schema.properties);
  const found = sectionWireSchemas("shipping_document").find((s) => Object.keys(s.wire.properties as object).join() === keys.join());
  if (!found) throw new Error(`no section has keys ${keys.join()}`);
  return found.name;
}

function message(over: Partial<Anthropic.Message>): Anthropic.Message {
  return {
    id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-4-6",
    content: [], stop_reason: "end_turn", stop_sequence: null, stop_details: null, container: null,
    usage: { input_tokens: 3000, output_tokens: 400, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 },
    ...over,
  } as Anthropic.Message;
}
const answer = (name: string) => message({ content: [{ type: "text", text: JSON.stringify(slice(name)), citations: null }] });

/** A fake client answering each section with `respond(section)`; `override` replaces one section's answer. */
function fakeClient(override: Record<string, () => Anthropic.Message> = {}) {
  const started: string[] = [];
  const client: ModelClient = {
    messages: {
      create: async (req) => {
        const name = sectionOf(req);
        started.push(name);
        return (override[name] ?? (() => answer(name)))();
      },
    },
  };
  return { client, started };
}

describe("readSections — every section ok → one merged document", () => {
  it("returns the merged profile document, one request per section", async () => {
    const { client, started } = fakeClient();
    const r = await readSections(INPUT, client);
    expect(r.kind).toBe("ok");
    expect(r.kind === "ok" && r.document).toEqual(DOC);
    expect([...started].sort()).toEqual(["identity", "lines", "load"]);
  });

  it("sums usage over the sections and records each section's hash and the combined hash", async () => {
    const r = await readSections(INPUT, fakeClient().client);
    expect(r.usage).toEqual({ input: 9000, output: 1200, cacheRead: 300, cacheWrite: 0 });
    const wires = sectionWireSchemas("shipping_document");
    expect(r.sectionHashes).toEqual(Object.fromEntries(wires.map((w) => [w.name, w.hash])));
    expect(r.schemaHash).toBe(combinedSchemaHash(wires.map((w) => [w.name, w.hash] as const)));
    expect(r.sections.map((s) => [s.name, s.kind])).toEqual([["identity", "ok"], ["load", "ok"], ["lines", "ok"]]);
    expect([r.model, r.promptVersion, r.stopReason]).toEqual(["claude-sonnet-4-6", "test-1", "end_turn"]);
  });

  it("records a cache figure as null when any section reported none", async () => {
    const noCache = () =>
      message({
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: null, cache_creation_input_tokens: null } as Anthropic.Usage,
        content: [{ type: "text", text: JSON.stringify(slice("load")), citations: null }],
      });
    const r = await readSections(INPUT, fakeClient({ load: noCache }).client);
    expect(r.usage).toMatchObject({ input: 6001, cacheRead: null, cacheWrite: null });
  });

  it("issues every request before any answers — the sections run concurrently", async () => {
    const started: string[] = [];
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const client: ModelClient = {
      messages: {
        create: async (req) => {
          const name = sectionOf(req);
          started.push(name);
          if (started.length === P.sections.length) open();
          await gate; // a sequential reader never opens it, and the test times out
          return answer(name);
        },
      },
    };
    const r = await readSections(INPUT, client);
    expect(r.kind).toBe("ok");
    expect(started).toHaveLength(3);
  }, 2_000);
});

describe("readSections — one section's failure is the read's failure", () => {
  it("one section refused → refusal naming the section, no document", async () => {
    const refused = () => message({ stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber", explanation: null } });
    const r = await readSections(INPUT, fakeClient({ lines: refused }).client);
    expect(r).toMatchObject({ kind: "refusal", section: "lines", detail: "section lines: refused (cyber)", stopReason: "refusal" });
    expect(r).not.toHaveProperty("document");
    expect(r.usage.input).toBe(9000);
  });

  it("one section's answer off-schema → schema_invalid naming the section and the path", async () => {
    const bad = () => message({ content: [{ type: "text", text: JSON.stringify({ ...slice("identity"), parties: 7 }), citations: null }] });
    const r = await readSections(INPUT, fakeClient({ identity: bad }).client);
    expect(r).toMatchObject({ kind: "schema_invalid", section: "identity" });
    expect(r.kind !== "ok" && r.detail).toMatch(/^section identity: .*parties/);
  });

  it("several sections failing → the first by precedence (refusal, max_tokens, schema_invalid), not by order", async () => {
    expect(FAILURE_PRECEDENCE).toEqual(["refusal", "max_tokens", "schema_invalid"]);
    const r = await readSections(
      INPUT,
      fakeClient({
        identity: () => message({ content: [{ type: "text", text: "not json", citations: null }] }),
        load: () => message({ stop_reason: "max_tokens" }),
        lines: () => message({ stop_reason: "refusal" }),
      }).client,
    );
    expect(r).toMatchObject({ kind: "refusal", section: "lines" });
    const r2 = await readSections(
      INPUT,
      fakeClient({
        identity: () => message({ content: [{ type: "text", text: "not json", citations: null }] }),
        lines: () => message({ stop_reason: "max_tokens" }),
      }).client,
    );
    expect(r2).toMatchObject({ kind: "max_tokens", section: "lines" });
  });

  it("a transient error in any one section rethrows for the queue", async () => {
    const overloaded = Anthropic.APIError.generate(529, { type: "error", error: { type: "overloaded_error", message: "x" } }, "x", new Headers());
    const p = readSections(INPUT, fakeClient({ load: () => { throw overloaded; } }).client);
    await expect(p).rejects.toBeInstanceOf(TransientModelError);
    await expect(p).rejects.toMatchObject({ status: 529, cause: overloaded });
  });

  it("refuses an empty page list before spending a call", async () => {
    const { client, started } = fakeClient();
    await expect(readSections({ ...INPUT, pages: [] }, client)).rejects.toThrow(/at least one page/);
    expect(started).toEqual([]);
  });
});

describe("combinedSchemaHash — order and names are part of it", () => {
  it("changes when the sections are reordered or renamed", () => {
    const base = combinedSchemaHash([["a", "1"], ["b", "2"]]);
    expect(combinedSchemaHash([["b", "2"], ["a", "1"]])).not.toBe(base);
    expect(combinedSchemaHash([["a", "1"], ["c", "2"]])).not.toBe(base);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
  });
});
