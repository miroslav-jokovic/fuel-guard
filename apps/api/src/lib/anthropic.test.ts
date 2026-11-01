import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { callForcedTool, toolInputSchema, type ForcedTool, type MessagesClient } from "./anthropic.js";

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
});
