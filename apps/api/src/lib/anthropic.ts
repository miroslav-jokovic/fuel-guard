import { createHash } from "node:crypto";
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

/**
 * What the user turn holds: plain text, or parts — text and images (ads C5a, the Checker's vision call).
 *
 * An image is BYTES we hold, never a URL: the model must see exactly the file we stored and hashed, and
 * a provider's URL (Higgsfield's CloudFront output, say) is a file somebody else can change or expire.
 * `describeUserContent` is what a ledger stores and hashes in its place — the image's sha256 and size,
 * computed here from the bytes rather than taken from the caller, so a row cannot name one image while
 * the model was shown another, and no row carries megabytes of base64.
 *
 * ⚠ The rail forces its tool (`tool_choice: {type: "tool"}`). `AI_MODELS.deep` is claude-sonnet-4-6, which
 * accepts that, with images. Claude Opus 5.5, Sonnet 5.5 and Fable 5.1 answer a forced tool_choice with a
 * 400 (claude-api skill, read 2026-11-04): moving `AI_MODELS` to one of them is a change to this function
 * (auto + strict tool), not a model-name edit.
 */
export type UserPart =
  | { type: "text"; text: string }
  | { type: "image"; format: ImageFormat; bytes: Uint8Array };
export type UserContent = string | UserPart[];
export type ImageFormat = "png" | "jpeg" | "webp";
const MEDIA_TYPE = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" } as const;

/** The Messages API's per-image ceiling (5 MB, base64 source). A larger image is the caller's to shrink, never truncated here. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type DescribedPart = { type: "text"; text: string } | { type: "image"; format: ImageFormat; sha256: string; byte_size: number };

/** The user turn as a ledger may keep it: every image replaced by its sha256 and size. */
export function describeUserContent(user: UserContent): string | DescribedPart[] {
  if (typeof user === "string") return user;
  return user.map((p) => {
    if (p.type === "text") return p;
    assertImageFits(p.bytes);
    return { type: "image", format: p.format, sha256: createHash("sha256").update(p.bytes).digest("hex"), byte_size: p.bytes.byteLength };
  });
}

/** Thrown, not trimmed: the ads rail describes the request before it writes its `started` row, so an oversized image fails with no row and no call. */
function assertImageFits(bytes: Uint8Array): void {
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error(`image of ${bytes.byteLength} bytes is over the ${MAX_IMAGE_BYTES}-byte limit`);
}

function messageContent(user: UserContent): string | Anthropic.ContentBlockParam[] {
  if (typeof user === "string") return user;
  return user.map((p) => {
    if (p.type === "text") return { type: "text", text: p.text };
    assertImageFits(p.bytes);
    return { type: "image", source: { type: "base64", media_type: MEDIA_TYPE[p.format], data: Buffer.from(p.bytes).toString("base64") } };
  });
}

export interface ForcedToolRequest<T> {
  model: string;
  system: string;
  user: UserContent;
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
    messages: [{ role: "user", content: messageContent(req.user) }],
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
