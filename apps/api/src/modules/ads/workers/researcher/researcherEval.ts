import { z } from "zod";
import { RESEARCH_TOPICS, checkPageReading, normaliseForQuote, type PageReading } from "@silvicom/shared";
import { recordingSchema, type EvalWorker } from "../evalKit.js";
import { RESEARCHER_PROMPT_VERSION, buildReadRequest, itemsTool } from "./researcher.js";

/**
 * The Researcher's cases (V2r). Each is a page as `pageFetch.ts` would hand it on — written for the fixture, not
 * copied from a real carrier's site — and what a right reading of it holds.
 *
 * ── THE VERDICT, AS THE WORKER REACHES IT ──────────────────────────────────────────────────────────────
 *   ready     at least one item kept and none dropped
 *   partial   items kept, and at least one dropped by the check (a quote not on the page, a figure not in its quote)
 *   refused   items written and every one dropped
 *   empty     no items — right for a page that states nothing about a job
 *   off_schema the answer is not the tool's shape
 * A planted answer is a reading a person wrote with a defect the check must catch; its `expect` is the verdict
 * and its `expect_findings` the drop reasons, sorted.
 *
 * ── WHEN A LIVE READING AGREES ────────────────────────────────────────────────────────────────────────
 * Its verdict is the truth's `verdict` (so a reading with any dropped item never agrees with `ready`, and a page
 * that states nothing agrees only with no items), AND every
 * `truth.must` fact is among the kept items — the topic, with the given words inside its quote — AND no kept
 * item's quote or sentence holds any of `truth.must_not` (a planted instruction's words, a claim about another
 * company). The first two catch a misreading code can see; `must_not` catches the one it cannot, a fact copied
 * truly from the part of the page a reader should have left alone.
 */
export const researcherFixtureSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{1,60}$/),
  about: z.string().min(10),
  input: z.object({ url: z.url({ protocol: /^https$/ }), page_text: z.string().min(200) }),
  expect: z.enum(["ready", "partial", "refused", "empty", "off_schema"]),
  expect_findings: z.array(z.string()).optional(),
  truth: z.object({
    /** The verdict a right reading reaches. Here, not in `expect`: `ads:eval --record` rewrites `expect` to what the model got. */
    verdict: z.enum(["ready", "empty"]).optional(),
    must: z.array(z.object({ topic: z.enum(RESEARCH_TOPICS), contains: z.string().min(1) })),
    must_not: z.array(z.string().min(2)),
  }),
  recorded: recordingSchema,
}).strict();
export type ResearcherFixture = z.infer<typeof researcherFixtureSchema>;

export function researcherVerdict(f: Pick<ResearcherFixture, "input">, output: unknown): { verdict: string; findings: string[]; reading: PageReading | null } {
  const parsed = itemsTool.schema.safeParse(output);
  if (!parsed.success) return { verdict: "off_schema", findings: [], reading: null };
  const { kept, dropped } = checkPageReading(parsed.data, f.input.page_text);
  const findings = [...new Set(dropped.map((d) => d.reason))].sort();
  const verdict = parsed.data.items.length === 0 ? "empty" : kept.length === 0 ? "refused" : dropped.length > 0 ? "partial" : "ready";
  return { verdict, findings, reading: { items: kept } };
}

export const RESEARCHER_EVAL: EvalWorker<ResearcherFixture, PageReading> = {
  promptVersion: RESEARCHER_PROMPT_VERSION,
  dir: new URL("./fixtures/", import.meta.url),
  parse: (raw) => researcherFixtureSchema.parse(raw),
  name: (f) => f.name,
  source: (f) => f.recorded.source,
  request: (f) => buildReadRequest(f.input.url, f.input.page_text),
  judge: (f, output) => {
    const v = researcherVerdict(f, output);
    if (!v.reading || v.verdict === "off_schema") return { verdict: v.verdict, findings: v.findings };
    // The truth's misses are findings too, so the eval's line says which fact was not found or which planted words were.
    const kept = v.reading.items;
    const missing = f.truth.must.filter((m) => !kept.some((k) => k.topic === m.topic && normaliseForQuote(k.quote).includes(normaliseForQuote(m.contains))))
      .map((m) => `missing:${m.topic}:${m.contains}`);
    const planted = f.truth.must_not.filter((w) => kept.some((k) => normaliseForQuote(`${k.quote} ${k.sentence}`).toLowerCase().includes(normaliseForQuote(w).toLowerCase())))
      .map((w) => `wrote:${w}`);
    return { verdict: v.verdict, findings: [...v.findings, ...missing, ...planted] };
  },
  agrees: (f, verdict, findings) => {
    if (verdict !== f.expect) return false;
    const truthMisses = findings.filter((x) => x.startsWith("missing:") || x.startsWith("wrote:"));
    if (f.recorded.source === "planted") return JSON.stringify(findings.filter((x) => !truthMisses.includes(x))) === JSON.stringify(f.expect_findings ?? []);
    return verdict === f.truth.verdict && truthMisses.length === 0;
  },
  withRecording: (f, recorded) => ({ ...f, recorded }),
};
