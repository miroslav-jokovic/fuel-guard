import { readFileSync } from "node:fs";
import { AD_AGENT_MODELS, RESEARCH_TOPICS, RESEARCH_TOPIC_LABELS, checkPageReading, pageReadingSchema, type PageItem, type PageItemDrop, type PageReading } from "@silvicom/shared";
import type { ForcedTool } from "../../../../lib/anthropic.js";
import { generateWithClaude, type ClaudeGenerationDeps, type ClaudeGenerationOutcome } from "../../generations/claudeGeneration.js";
import { generationByKey } from "../../generations/generationLedger.js";

/**
 * The Researcher (ADS-PLATFORM-V2-PLAN V2r, D-AD36): from one page a recruiter saved to the swipe file, what that
 * page says it offers a driver and asks of one — each fact as a sentence with the page's own words as its quote.
 *
 * ── CODE FETCHES; THE MODEL ONLY READS; CODE CHECKS ────────────────────────────────────────────────────
 * The page was fetched by code (`research/pageFetch.ts`) from an address a person saved; the model has no tool but
 * the one it answers with, so it cannot fetch, search or follow a link. The page's text reaches it as a field of
 * a JSON object, and the prompt says it is data. Its answer goes through `checkPageReading` (shared): an item
 * whose quote is not on the page, or whose sentence states a figure its quote does not, is dropped and counted.
 * That is the defence against an instruction planted in a page as much as against a misreading — whatever the
 * model is talked into writing, only a true quote of that page survives, attributed to it.
 *
 * ── WHAT CODE CANNOT CHECK ─────────────────────────────────────────────────────────────────────────────
 * A sentence with no figure that says more than its quote ("home daily" from "home often") passes both checks.
 * How often that happens is what the fixtures measure (`researcherEval.ts`): every expected fact found, nothing
 * planted written, and no item the check had to drop. The Researcher enters the readiness registry at L0 and
 * climbs on those recordings (§4R).
 *
 * ── NO SECOND ASK ──────────────────────────────────────────────────────────────────────────────────────
 * Unlike the Strategist, a dropped item is not sent back: the kept items stand on their own, the dropped ones are
 * shown to the person with the reason, and "Read again" is theirs to press. A second ask would hand the model
 * its own wrong quote to repair, which is how a paraphrase becomes a quote.
 */
export const RESEARCHER_PROMPT_VERSION = "researcher@1";
const PROMPT = readFileSync(new URL("./prompt.v1.md", import.meta.url), "utf8");
// Twelve items of a short sentence and a quote each; the rest is the model's thinking (`wireShape` adds its headroom).
const MAX_TOKENS = 4000;

export const itemsTool: ForcedTool<PageReading> = {
  name: "write_items",
  description: "Write the facts the page states about the job it advertises, each with a quote copied from the page text.",
  schema: pageReadingSchema,
};

export function readingSheet(url: string, text: string) {
  return { page_address: url, page_text: text, topics: RESEARCH_TOPICS.map((key) => ({ key, is: RESEARCH_TOPIC_LABELS[key] })) };
}

export function buildReadRequest(url: string, text: string) {
  return { ...AD_AGENT_MODELS.researcher, system: PROMPT, user: JSON.stringify(readingSheet(url, text), null, 2), tool: itemsTool, maxTokens: MAX_TOKENS };
}

export interface ReadPageInput {
  orgId: string;
  entryId: string;
  attempt: number;
  url: string;
  text: string;
}

export type ReadPageOutcome =
  | { kind: "read"; generationId: string; kept: PageItem[]; dropped: PageItemDrop[]; replayed: boolean }
  | Exclude<ClaudeGenerationOutcome<PageReading>, { kind: "succeeded" }>;

export const readKey = (entryId: string, attempt: number): string => `swipe:${entryId}:${attempt}`;

export async function readPage(deps: ClaudeGenerationDeps, input: ReadPageInput): Promise<ReadPageOutcome> {
  const out = await generateWithClaude(deps, {
    orgId: input.orgId, agent: "researcher", idempotencyKey: readKey(input.entryId, input.attempt),
    promptVersion: RESEARCHER_PROMPT_VERSION, ...buildReadRequest(input.url, input.text),
  });
  if (out.kind !== "succeeded") return out;
  // A replayed answer is checked against the text it was WRITTEN from, read back from the ledger's copy of the
  // request — a retry of the read step fetches the page again, and the page may have changed since.
  const text = out.replayed ? await sentText(deps, input.orgId, readKey(input.entryId, input.attempt)) : input.text;
  const { kept, dropped } = checkPageReading(out.value, text);
  return { kind: "read", generationId: out.generationId, kept, dropped, replayed: out.replayed };
}

async function sentText(deps: ClaudeGenerationDeps, orgId: string, key: string): Promise<string> {
  const row = await generationByKey(deps.admin, orgId, key);
  const user = (row?.request as { user?: unknown } | undefined)?.user;
  let sheet: unknown;
  try { sheet = typeof user === "string" ? JSON.parse(user) : null; } catch { sheet = null; }
  const text = (sheet as { page_text?: unknown } | null)?.page_text;
  if (typeof text !== "string") throw new Error(`ad_generations: the request stored under ${key} holds no page text`);
  return text;
}
