import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AD_AGENT_MODELS, AI_MODELS, AI_MODEL_PROFILES } from "@silvicom/shared";
import { callForcedTool, toolInputSchema, toolInstruction, wireShape, type ForcedTool, type MessagesClient } from "./anthropic.js";

const tool: ForcedTool<{ headline: string; lines: string[] }> = {
  name: "write_copy",
  description: "Fill the preset's copy slots.",
  schema: z.object({ headline: z.string().min(1), lines: z.array(z.string()) }),
};

function fakeClient(content: unknown[], stop_reason = "tool_use") {
  const create = vi.fn(async (_body: unknown) => ({ id: "msg_1", content, stop_reason, usage: { input_tokens: 120, output_tokens: 30 } }));
  return { client: { messages: { create } } as unknown as MessagesClient, create };
}
const req = { model: "claude-haiku-4-5", system: "sys", user: "brief", tool, maxTokens: 512 };

describe("callForcedTool", () => {
  it("forces the caller's tool, with a schema derived from its Zod schema", async () => {
    const { client, create } = fakeClient([{ type: "tool_use", id: "t1", name: "write_copy", input: { headline: "H", lines: [] } }]);
    await callForcedTool(client, req);
    const body = create.mock.calls[0]![0] as { tool_choice: unknown; tools: Array<{ name: string; input_schema: Record<string, unknown> }> };
    expect(body.tool_choice).toEqual({ type: "tool", name: "write_copy" });
    expect(body.tools[0]!.input_schema).toEqual(toolInputSchema(tool));
    expect(body.tools[0]!.input_schema).toMatchObject({ type: "object", required: ["headline", "lines"] });
    expect(body.tools[0]!.input_schema).not.toHaveProperty("$schema");
  });

  it("returns a value only when the answer parses against the schema", async () => {
    const ok = fakeClient([{ type: "tool_use", id: "t1", name: "write_copy", input: { headline: "Home weekly", lines: ["a"] } }]);
    expect(await callForcedTool(ok.client, req)).toEqual({
      kind: "ok", value: { headline: "Home weekly", lines: ["a"] }, usage: { input: 120, output: 30 }, requestId: "msg_1",
    });
  });

  it("an off-schema answer is evidence, not a value", async () => {
    const bad = fakeClient([{ type: "tool_use", id: "t1", name: "write_copy", input: { headline: "" } }]);
    const r = await callForcedTool(bad.client, req);
    expect(r.kind).toBe("off_schema");
    expect(r).not.toHaveProperty("value");
    expect(r.kind === "off_schema" && r.issues.length).toBeGreaterThan(0);
    expect(r.usage).toEqual({ input: 120, output: 30 });
  });

  it("no tool_use block is reported with the stop reason", async () => {
    const none = fakeClient([{ type: "text", text: "I can't help with that." }], "end_turn");
    expect(await callForcedTool(none.client, req)).toMatchObject({ kind: "no_tool_use", stopReason: "end_turn" });
  });

  it("a provider refusal is its own kind, with the provider's category, and never a value", async () => {
    const create = vi.fn(async (_body: unknown) => ({
      id: "msg_2", content: [], stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber", explanation: "x" }, usage: { input_tokens: 9, output_tokens: 0 },
    }));
    const r = await callForcedTool({ messages: { create } } as unknown as MessagesClient, req);
    expect(r).toEqual({ kind: "refused", category: "cyber", usage: { input: 9, output: 0 }, requestId: "msg_2" });
  });
});

type Body = { model: string; system: string; max_tokens: number; tool_choice: unknown; output_config?: unknown };
const answer = [{ type: "tool_use", id: "t1", name: "write_copy", input: { headline: "H", lines: [] } }];
const sent = async (over: Partial<typeof req> & { effort?: "low" | "high" }) => {
  const { client, create } = fakeClient(answer);
  await callForcedTool(client, { ...req, ...over });
  return create.mock.calls[0]![0] as Body;
};

describe("the request shape follows the model's profile", () => {
  it("a forced-tool model is sent exactly the caller's system prompt and token limit", async () => {
    const body = await sent({ model: "claude-sonnet-4-6" });
    expect(body.tool_choice).toEqual({ type: "tool", name: "write_copy" });
    expect(body.system).toBe("sys");
    expect(body.max_tokens).toBe(512);
    expect(body).not.toHaveProperty("output_config");
  });

  it.each(["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-2"])("%s is never sent a forced tool", async (model) => {
    const body = await sent({ model });
    expect(body.tool_choice).toEqual({ type: "auto", disable_parallel_tool_use: true });
    expect(body.system).toBe(`sys\n\n${toolInstruction("write_copy")}`);
    expect(body.max_tokens).toBe(512 + AI_MODEL_PROFILES[model]!.thinkingHeadroom);
    expect(AI_MODEL_PROFILES[model]!.thinkingHeadroom).toBeGreaterThan(0);
  });

  it("effort is sent only when the request names one", async () => {
    expect((await sent({ model: "claude-opus-5-5", effort: "high" })).output_config).toEqual({ effort: "high" });
    expect(await sent({ model: "claude-opus-5-5" })).not.toHaveProperty("output_config");
  });

  it("a model with no profile is refused before any call", async () => {
    const { client, create } = fakeClient(answer);
    await expect(callForcedTool(client, { ...req, model: "claude-unknown-9" })).rejects.toThrow(/no profile/);
    expect(create).not.toHaveBeenCalled();
    expect(() => wireShape({ ...req, model: "claude-unknown-9" })).toThrow(/no profile/);
  });

  it("every model the product names has a profile, so no caller of this function can be refused in production", () => {
    for (const [use, model] of Object.entries(AI_MODELS)) expect(AI_MODEL_PROFILES[model], use).toBeDefined();
  });

  it("a forced-tool profile adds nothing to the request", () => {
    for (const [model, p] of Object.entries(AI_MODEL_PROFILES)) if (p.forcedTool) expect(p.thinkingHeadroom, model).toBe(0);
  });

  it("every ads agent names a model that has a profile", () => {
    for (const [agent, m] of Object.entries(AD_AGENT_MODELS)) expect(AI_MODEL_PROFILES[m.model], agent).toBeDefined();
  });
});
