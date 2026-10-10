import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { DOCUMENT_PROFILES, emptyShippingDocument, sectionSchema } from "@silvicom/shared";
import {
  PAGES_ARE_DATA,
  READ_CHARS_PER_TOKEN,
  READ_HEADROOM,
  READ_MAX_TOKENS,
  READ_THINKING_ALLOWANCE,
  TransientModelError,
  readPages,
  type ModelClient,
  type ReadPagesInput,
} from "./readPages.js";
import { readModels } from "./models.js";
import { schemaHash, wireSchemaFor } from "./wireSchema.js";
import { worstCaseShippingDocument } from "./worstCaseShippingDocument.js";

const INPUT: ReadPagesInput = {
  profile: "shipping_document",
  pages: [
    { base64: "AAAA", mediaType: "image/png" },
    { base64: "BBBB", mediaType: "image/jpeg" },
  ],
  model: "claude-sonnet-4-6",
  prompt: { version: "test-1", system: "You are a transcription tool." },
};

function message(over: Partial<Anthropic.Message>): Anthropic.Message {
  return {
    id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-4-6",
    content: [], stop_reason: "end_turn", stop_sequence: null, stop_details: null, container: null,
    usage: { input_tokens: 5000, output_tokens: 900, cache_read_input_tokens: 120, cache_creation_input_tokens: 0 },
    ...over,
  } as Anthropic.Message;
}
const text = (t: string) => [{ type: "text", text: t, citations: null }] as Anthropic.Message["content"];

/** A fake client that records every request and answers with `respond`. */
function fakeClient(respond: () => Anthropic.Message | Promise<Anthropic.Message>) {
  const sent: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client: ModelClient = { messages: { create: async (p) => { sent.push(p); return respond(); } } };
  return { client, sent };
}
const failing = (err: unknown) => fakeClient(() => { throw err; });
const apiError = (status: number, type: string) =>
  Anthropic.APIError.generate(status, { type: "error", error: { type, message: type } }, type, new Headers());

describe("readPages — the request it sends", () => {
  it("sends structured outputs with the GENERATED schema, the pages as base64 images, and no sampling", async () => {
    const { client, sent } = fakeClient(() => message({ content: text(JSON.stringify(emptyShippingDocument())) }));
    await readPages(INPUT, client);
    const req = sent[0]!;
    expect(req.output_config).toEqual({ format: { type: "json_schema", schema: wireSchemaFor(DOCUMENT_PROFILES.shipping_document.schema) } });
    for (const banned of ["temperature", "top_p", "top_k", "tools", "tool_choice", "thinking", "stop_sequences"]) {
      expect(req).not.toHaveProperty(banned);
    }
    expect(req.max_tokens).toBe(READ_MAX_TOKENS);
    expect(req.system).toBe(INPUT.prompt.system);
    expect(req.model).toBe("claude-sonnet-4-6");
    const content = req.messages[0]!.content as Anthropic.ContentBlockParam[];
    expect(content).toEqual([
      { type: "text", text: "Page 1 of 2:" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
      { type: "text", text: "Page 2 of 2:" },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "BBBB" } },
      { type: "text", text: PAGES_ARE_DATA },
    ]);
  });

  it("refuses an empty page list before spending a call", async () => {
    const { client, sent } = fakeClient(() => message({}));
    await expect(readPages({ ...INPUT, pages: [] }, client)).rejects.toThrow(/at least one page/);
    expect(sent).toHaveLength(0);
  });
});

describe("readPages — every stop reason is a typed outcome", () => {
  it("end_turn with a valid document → ok, with usage, model, prompt version and schema hash", async () => {
    const doc = worstCaseShippingDocument();
    const { client } = fakeClient(() => message({ content: text(JSON.stringify(doc)), model: "claude-sonnet-4-6-20260101" }));
    const r = await readPages(INPUT, client);
    expect(r).toEqual({
      kind: "ok", document: doc, stopReason: "end_turn",
      usage: { input: 5000, output: 900, cacheRead: 120, cacheWrite: 0 },
      model: "claude-sonnet-4-6-20260101", promptVersion: "test-1",
      schemaHash: schemaHash(wireSchemaFor(DOCUMENT_PROFILES.shipping_document.schema)),
    });
  });

  it("joins text blocks and skips thinking blocks (Opus 5.5 always thinks)", async () => {
    const json = JSON.stringify(emptyShippingDocument());
    const content = [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "text", text: json.slice(0, 40), citations: null },
      { type: "text", text: json.slice(40), citations: null },
    ] as Anthropic.Message["content"];
    const r = await readPages(INPUT, fakeClient(() => message({ content })).client);
    expect(r.kind).toBe("ok");
  });

  it("refusal → refusal with its category, never parsed", async () => {
    const { client } = fakeClient(() =>
      message({ stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber", explanation: null }, content: text("{}") }),
    );
    const r = await readPages(INPUT, client);
    expect(r).toMatchObject({ kind: "refusal", detail: "refused (cyber)", stopReason: "refusal", usage: { input: 5000, output: 900 } });
    expect(r).not.toHaveProperty("document");
  });

  it("max_tokens → max_tokens, never parsed even when the truncated text happens to be valid JSON", async () => {
    const { client } = fakeClient(() => message({ stop_reason: "max_tokens", content: text(JSON.stringify(emptyShippingDocument())) }));
    const r = await readPages(INPUT, client);
    expect(r).toMatchObject({ kind: "max_tokens", stopReason: "max_tokens" });
    expect(r).not.toHaveProperty("document");
  });

  it("malformed JSON → schema_invalid", async () => {
    const r = await readPages(INPUT, fakeClient(() => message({ content: text('{"identity": {"bolNumber": "12') })).client);
    expect(r).toMatchObject({ kind: "schema_invalid", detail: "answer is not JSON", usage: { output: 900 } });
  });

  it("JSON that does not match the profile → schema_invalid naming the path, not the value", async () => {
    const bad = emptyShippingDocument() as unknown as { hazmat: { lines: unknown[] } };
    bad.hazmat.lines = [{ ...worstCaseShippingDocument().hazmat.lines[0], pg: "IV", psn: "SECRET-VALUE" }];
    const r = await readPages(INPUT, fakeClient(() => message({ content: text(JSON.stringify(bad)) })).client);
    expect(r.kind).toBe("schema_invalid");
    expect(r.kind !== "ok" && r.detail).toMatch(/hazmat\.lines\.0\.pg/);
    expect(r.kind !== "ok" && r.detail).not.toMatch(/SECRET-VALUE/);
  });

  it("an empty answer → schema_invalid", async () => {
    const r = await readPages(INPUT, fakeClient(() => message({ content: [] })).client);
    expect(r.kind).toBe("schema_invalid");
  });

  it("an unexpected stop reason (tool_use, pause_turn) → schema_invalid, never parsed", async () => {
    for (const stop_reason of ["tool_use", "pause_turn"] as const) {
      const r = await readPages(INPUT, fakeClient(() => message({ stop_reason, content: text(JSON.stringify(emptyShippingDocument())) })).client);
      expect(r).toMatchObject({ kind: "schema_invalid", detail: `unexpected stop_reason ${stop_reason}` });
    }
  });

  it("records absent cache figures as null, not 0", async () => {
    const usage = { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: null, cache_creation_input_tokens: null } as Anthropic.Usage;
    const r = await readPages(INPUT, fakeClient(() => message({ usage, content: text(JSON.stringify(emptyShippingDocument())) })).client);
    expect(r.usage).toEqual({ input: 1, output: 2, cacheRead: null, cacheWrite: null });
  });
});

describe("readPages — transient errors are rethrown for the queue, never swallowed", () => {
  it.each([
    ["429 rate limit", apiError(429, "rate_limit_error"), 429],
    ["529 overloaded", apiError(529, "overloaded_error"), 529],
    ["500 api error", apiError(500, "api_error"), 500],
    ["503 unavailable", apiError(503, "api_error"), 503],
    ["408 request timeout", apiError(408, "timeout_error"), 408],
    ["client timeout", new Anthropic.APIConnectionTimeoutError(), null],
    ["connection reset", new Anthropic.APIConnectionError({ message: "ECONNRESET" }), null],
  ])("%s → TransientModelError", async (_name, err, status) => {
    const p = readPages(INPUT, failing(err).client);
    await expect(p).rejects.toBeInstanceOf(TransientModelError);
    await expect(p).rejects.toMatchObject({ status, cause: err });
  });

  it.each([
    ["400 bad request (e.g. a schema the API will not compile)", apiError(400, "invalid_request_error")],
    ["401 bad key", apiError(401, "authentication_error")],
    ["404 retired model", apiError(404, "not_found_error")],
    ["caller abort", new Anthropic.APIUserAbortError()],
    ["a plain bug", new TypeError("boom")],
  ])("%s → propagates unchanged, not retried", async (_name, err) => {
    const p = readPages(INPUT, failing(err).client);
    await expect(p).rejects.toBe(err);
  });
});

describe("READ_MAX_TOKENS — sized from the worst case, not 2,048", () => {
  // Per REQUEST (Q-DR11): the shipping document is read in sections, so the largest one section's slice
  // of the fixture is what one answer must hold.
  it("covers the 12-line fixture's largest section at the stated ratio, headroom and thinking allowance", () => {
    const P = DOCUMENT_PROFILES.shipping_document;
    const chars = Math.max(
      ...P.sections.map((s) => JSON.stringify(sectionSchema(P, s.name).parse(worstCaseShippingDocument()), null, 2).length),
    );
    const derived = Math.ceil(chars / READ_CHARS_PER_TOKEN) * READ_HEADROOM + READ_THINKING_ALLOWANCE;
    expect(worstCaseShippingDocument().hazmat.lines).toHaveLength(12);
    expect(READ_MAX_TOKENS).toBeGreaterThanOrEqual(derived);
    // Within one rounding step of the derivation: a budget far above it is a guess, not a measurement.
    expect(READ_MAX_TOKENS - derived).toBeLessThan(2_000);
  });
  it("stays under the SDK's non-streaming ceiling (ten minutes at 128k tokens/hour)", () => {
    expect((60 * 60 * READ_MAX_TOKENS) / 128_000).toBeLessThanOrEqual(600);
  });
});

describe("readModels — the reader's pins, falling back to the hazmat aliases", () => {
  const hazmat = { HAZMAT_MODEL_A: "claude-sonnet-4-6", HAZMAT_MODEL_B: "claude-haiku-4-5" };
  it("falls back to the hazmat pins when DOC_READ_MODEL_* is unset", () => {
    expect(readModels({ ...hazmat, DOC_READ_MODEL_A: undefined, DOC_READ_MODEL_B: undefined })).toEqual({ A: "claude-sonnet-4-6", B: "claude-haiku-4-5" });
  });
  it("DOC_READ_MODEL_* wins, each independently", () => {
    expect(readModels({ ...hazmat, DOC_READ_MODEL_A: "claude-sonnet-5-5", DOC_READ_MODEL_B: undefined })).toEqual({ A: "claude-sonnet-5-5", B: "claude-haiku-4-5" });
  });
});
