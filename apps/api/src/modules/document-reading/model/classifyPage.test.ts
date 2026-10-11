import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { PAGE_CLASSES, PAGE_ROTATIONS } from "@silvicom/shared";
import { TransientModelError, type ModelClient } from "./readPages.js";
import { buildClassifyRequest, classifyPage, classifySchema, CLASSIFY_PROMPT } from "./classifyPage.js";
import { wireSchemaFor } from "./wireSchema.js";

/**
 * P2's one model call per page. What must hold: the answer is the closed class set and the four right
 * angles, mapped back to numbers; anything off the schema leaves the page unclassified rather than
 * guessed; a transient failure is thrown for the queue, like the reader's.
 */
const IMAGE = { base64: "QQ==", mediaType: "image/webp" as const };
const answer = (text: string, over: Partial<Anthropic.Message> = {}): Anthropic.Message => ({
  id: "m", type: "message", role: "assistant", model: "claude-haiku-4-5",
  content: [{ type: "text", text, citations: null }], stop_reason: "end_turn", stop_sequence: null, stop_details: null, container: null,
  usage: { input_tokens: 700, output_tokens: 15, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, ...over,
} as Anthropic.Message);
const client = (m: () => Anthropic.Message): ModelClient => ({ messages: { create: async () => m() } });

describe("classifyPage", () => {
  it("asks with the classifier's prompt, one image, structured outputs and no sampling parameters", () => {
    const req = buildClassifyRequest(IMAGE, "claude-haiku-4-5");
    expect(req).toMatchObject({ model: "claude-haiku-4-5", system: CLASSIFY_PROMPT.system, output_config: { format: { type: "json_schema", schema: wireSchemaFor(classifySchema) } } });
    expect(req).not.toHaveProperty("temperature");
    expect(req).not.toHaveProperty("tool_choice");
    const content = req.messages[0]!.content as { type: string }[];
    expect(content.filter((c) => c.type === "image")).toHaveLength(1);
  });

  it("offers exactly PAGE_CLASSES and the PAGE_ROTATIONS on the wire", () => {
    const props = (wireSchemaFor(classifySchema) as { properties: Record<string, { enum: unknown[] }> }).properties;
    expect(props.pageClass!.enum).toEqual([...PAGE_CLASSES]);
    expect(props.rotation!.enum.map(Number)).toEqual([...PAGE_ROTATIONS]);
  });

  it("returns the class and the turn as a number, with the usage and the model that served it", async () => {
    const r = await classifyPage(IMAGE, "claude-haiku-4-5", client(() => answer('{"pageClass":"bol","rotation":"270"}')));
    expect(r).toEqual({ kind: "ok", pageClass: "bol", rotation: 270, model: "claude-haiku-4-5", usage: { input: 700, output: 15, cacheRead: 0, cacheWrite: 0 } });
  });

  it("leaves the page unclassified — never a guess — on a refusal, a non-JSON or an off-schema answer", async () => {
    for (const m of [
      () => answer("", { stop_reason: "refusal" }),
      () => answer("not json"),
      () => answer('{"pageClass":"invoice","rotation":"0"}'),
      () => answer('{"pageClass":"bol","rotation":"45"}'),
      // A refusal or a truncation is not an answer even when its text happens to parse.
      () => answer('{"pageClass":"bol","rotation":"0"}', { stop_reason: "refusal" }),
      () => answer('{"pageClass":"bol","rotation":"0"}', { stop_reason: "max_tokens" }),
    ]) {
      expect(await classifyPage(IMAGE, "m", client(m))).toMatchObject({ kind: "unclassified", usage: { input: 700 } });
    }
  });

  it("throws a transient failure for the queue to retry", async () => {
    const c: ModelClient = { messages: { create: async () => { throw new Anthropic.InternalServerError(529, undefined, "overloaded", new Headers()); } } };
    await expect(classifyPage(IMAGE, "m", c)).rejects.toBeInstanceOf(TransientModelError);
  });
});
