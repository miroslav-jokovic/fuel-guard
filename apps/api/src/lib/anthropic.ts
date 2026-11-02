import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Env } from "../env.js";

let client: Anthropic | null = null;
function getClient(env: Env): Anthropic {
  if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

/** The shared Anthropic client (for agentic tool-use flows like Ask-your-data). */
export const anthropicClient = getClient;

/**
 * The generic forced-tool call (ads A4; RA1.8's "the tool schema becomes an argument").
 *
 * The tool's JSON schema is DERIVED from the caller's Zod schema (`z.toJSONSchema`), never written
 * beside it — the copy this replaced, `callClaude`'s `ASSESSMENT_TOOL`, was a hand mirror of
 * `aiOutputSchema` ("mirrors shared aiOutputSchema"), the drift F-DR7 found in the document reader.
 * And the model's answer is parsed with that same Zod schema before anyone sees it: `value` exists
 * only on `kind: "ok"`, so a caller cannot use an unvalidated output by forgetting a check.
 *
 * WHY `callClaude` WAS RETIRED, NOT RESHAPED (decision, 2026-11-01): it had no caller —
 * `git grep "callClaude("` found only its definition (its one caller, the anomaly-verification AI, was retired in 991a830), so
 * there was nothing to keep compatible, and keeping it beside this would have left two ways to force
 * a tool, one of them unvalidated. `callClaudeText` stays: the weekly digest calls it.
 *
 * Not strict structured outputs: a forced tool accepts ordinary JSON-schema keywords, so this does not
 * need the document reader's `toWireSchema` refusals. Budget, provenance and replay are NOT here —
 * they belong to the caller's module (ads: `modules/ads/generations/`), which decides whether this
 * call may happen at all and records that it did.
 */
export interface ForcedTool<T> {
  name: string;
  description: string;
  schema: z.ZodType<T>;
}

export interface ToolUsage {
  input: number;
  output: number;
}

export type ForcedToolResult<T> =
  | { kind: "ok"; value: T; usage: ToolUsage; requestId: string }
  /** The model answered, but not in the tool's shape. `raw` is kept as evidence, never as a value. */
  | { kind: "off_schema"; raw: unknown; issues: string[]; usage: ToolUsage; requestId: string }
  /** No tool_use block at all (a refusal, or max_tokens hit first). */
  | { kind: "no_tool_use"; stopReason: string | null; usage: ToolUsage; requestId: string };

/** The one method used, so a test can hand in a fake without an SDK instance. */
export type MessagesClient = { messages: Pick<Anthropic["messages"], "create"> };

export interface ForcedToolRequest<T> {
  model: string;
  system: string;
  user: string;
  tool: ForcedTool<T>;
  maxTokens: number;
}

/** The input_schema sent for `tool` — exported so a caller can hash exactly what the model saw. */
export function toolInputSchema(tool: ForcedTool<unknown>): Anthropic.Tool.InputSchema {
  const { $schema: _draft, ...schema } = z.toJSONSchema(tool.schema, { io: "output" }) as Record<string, unknown>;
  return { ...schema, type: "object" } as Anthropic.Tool.InputSchema;
}

export async function callForcedTool<T>(client: MessagesClient, req: ForcedToolRequest<T>): Promise<ForcedToolResult<T>> {
  const resp = await client.messages.create({
    model: req.model,
    max_tokens: req.maxTokens,
    system: req.system,
    tools: [{ name: req.tool.name, description: req.tool.description, input_schema: toolInputSchema(req.tool) }],
    tool_choice: { type: "tool", name: req.tool.name },
    messages: [{ role: "user", content: req.user }],
  });
  const usage = { input: resp.usage.input_tokens, output: resp.usage.output_tokens };
  const block = resp.content.find((b) => b.type === "tool_use" && b.name === req.tool.name);
  if (!block || block.type !== "tool_use") return { kind: "no_tool_use", stopReason: resp.stop_reason ?? null, usage, requestId: resp.id };
  const parsed = req.tool.schema.safeParse(block.input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return { kind: "off_schema", raw: block.input, issues, usage, requestId: resp.id };
  }
  return { kind: "ok", value: parsed.data, usage, requestId: resp.id };
}

/** Free-form text completion (no forced tool) — used for the weekly digest narrative. */
export async function callClaudeText(env: Env, model: string, system: string, userText: string): Promise<string> {
  const resp = await getClient(env).messages.create({
    model,
    max_tokens: 1200,
    system,
    messages: [{ role: "user", content: userText }],
  });
  return resp.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}
