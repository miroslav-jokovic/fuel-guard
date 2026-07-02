import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "../env.js";

/** JSON schema for the forced tool — mirrors shared `aiOutputSchema`. */
const ASSESSMENT_TOOL = {
  name: "report_assessment",
  description: "Report a fuel-transaction risk assessment.",
  input_schema: {
    type: "object" as const,
    properties: {
      risk_score: { type: "integer", minimum: 0, maximum: 100 },
      risk_level: { type: "string", enum: ["low", "medium", "high", "critical"] },
      location_assessment: {
        type: "object",
        properties: {
          plausible: { type: "boolean" },
          reason: { type: "string" },
          implied_speed_mph: { type: ["number", "null"] },
        },
        required: ["plausible", "reason", "implied_speed_mph"],
      },
      summary: { type: "string" },
      recommended_action: {
        type: "string",
        enum: ["monitor", "investigate", "contact_driver", "block_card", "none"],
      },
      contributing_factors: { type: "array", items: { type: "string" } },
      needs_deeper_review: { type: "boolean" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
    required: [
      "risk_score",
      "risk_level",
      "location_assessment",
      "summary",
      "recommended_action",
      "contributing_factors",
      "needs_deeper_review",
      "confidence",
    ],
  },
};

export interface ModelResult {
  json: unknown;
  usage: { input: number; output: number };
}

let client: Anthropic | null = null;
function getClient(env: Env): Anthropic {
  if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

/** The shared Anthropic client (for agentic tool-use flows like Ask-your-data). */
export const anthropicClient = getClient;

/** Call Claude, forcing the assessment tool, and return its structured (unvalidated) input. */
export async function callClaude(
  env: Env,
  model: string,
  system: string,
  userText: string,
): Promise<ModelResult> {
  const resp = await getClient(env).messages.create({
    model,
    max_tokens: 1024,
    system,
    tools: [ASSESSMENT_TOOL],
    tool_choice: { type: "tool", name: ASSESSMENT_TOOL.name },
    messages: [{ role: "user", content: userText }],
  });
  const block = resp.content.find((b) => b.type === "tool_use");
  return {
    json: block && block.type === "tool_use" ? block.input : null,
    usage: { input: resp.usage.input_tokens, output: resp.usage.output_tokens },
  };
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
