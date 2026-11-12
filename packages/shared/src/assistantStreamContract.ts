import type { AssistantAnswerLink, AssistantToolName } from "./assistantContract.js";

/**
 * Ask AI's streamed answer (F21 Step 2d, decided 2026-11-12 on the eval's timing, PLAN §6).
 *
 * ── WHY, AND WHY PROGRESS AS WELL AS TEXT ───────────────────────────────────────────────────────────
 * Measured on production (Haiku 5.5, `medium`, 23 questions): median 7.3 s, p90 15.9 s, slowest
 * 20.3 s. The bar for building this was a median over ~5 s. Most of that wait is BEFORE the first word:
 * every answer with two or more tool rounds took 10–20 s, the time spent reading reports. Streaming the
 * text alone would leave the reader looking at a spinner for most of it, so the stream also says what
 * is being read, one `step` per tool call, in the office's words.
 *
 * ── THE WIRE ────────────────────────────────────────────────────────────────────────────────────────
 * `POST /api/ai/ask` with `Accept: text/event-stream` answers as Server-Sent Events, one JSON event
 * per `data:` line. The same route without that header answers JSON as before, so an older web keeps
 * working while the two deploy apart. The web reads with `fetch` and a reader, not `EventSource`: the
 * request is a POST with a bearer header, and `EventSource` can send neither. A refusal BEFORE the model
 * is reached (400, 403, the 429 budget refusal) is still a JSON status: nothing was streamed yet.
 *
 * Events, in order:
 *   · `step` — a tool is being read. Text streamed before it was the model thinking aloud ahead of the
 *     tool call, not the answer, so the reader drops that draft.
 *   · `text` — the next piece of the answer's words.
 *   · `done` — the whole answer and its links, the same object the JSON route returns. It is the
 *     record: the streamed text is a preview of it, and the turn shows `answer` from here.
 *   · `error` — the model failed after the stream began; the composer offers a retry, as for a 503.
 */
export type AssistantStreamEvent =
  | { type: "step"; label: string }
  | { type: "text"; delta: string }
  | { type: "done"; answer: string; pages: string[]; links: AssistantAnswerLink[] }
  | { type: "error"; message: string };

export const ASSISTANT_STREAM_TYPE = "text/event-stream";

/**
 * What the reader sees while a tool runs. A `Record` over every tool, so a new tool cannot ship
 * without one (typecheck). The office's words, not the tool's name.
 */
export const ASSISTANT_TOOL_STEP: Record<AssistantToolName, string> = {
  fleet_summary: "Reading the fleet's alerts",
  top_risk: "Reading flagged fills",
  odometer_accuracy: "Checking odometer readings",
  count_signal: "Counting alerts",
  fuel_report: "Reading the fuel report",
  fuel_economics: "Reading fuel spend and MPG",
  fuel_ranking: "Ranking fuel figures",
  spend_trend: "Reading the spend trend",
  ifta_report: "Reading the IFTA report",
  declined_summary: "Reading declined fills",
  card_holds: "Reading fuel card holds",
  telematics_coverage: "Checking telematics coverage",
  import_activity: "Checking fuel imports",
  driver_performance: "Reading driver performance",
  idling_summary: "Reading idling",
  idle_report: "Reading the idling report",
  fleet_now: "Reading the live fleet",
  loads_by_truck: "Reading loads",
  fleet_roster: "Reading the roster",
  driver_file_expirations: "Reading driver files",
  annual_inspections_due: "Reading annual inspections",
  recruiting_counts: "Reading the applicant pipeline",
  maintenance_cost: "Reading repair costs",
  finance_report: "Reading the fleet report",
  income_statement: "Reading the income statement",
  open_view: "Opening the page",
};

/** The step a tool call shows; a name outside the catalogue (refused by the loop) reads generically. */
export function assistantStepLabel(tool: string): string {
  return (ASSISTANT_TOOL_STEP as Record<string, string>)[tool] ?? "Reading your data";
}

/** One event as the route writes it: a `data:` line and the blank line that ends an SSE event. */
export function encodeAssistantEvent(e: AssistantStreamEvent): string {
  return `data: ${JSON.stringify(e)}\n\n`;
}

/**
 * The complete events in what has arrived so far, and the unfinished tail to keep for the next chunk.
 * A network chunk can end mid-event, or mid-line, so only text up to the last blank line is read. A
 * line that is not well-formed JSON is skipped rather than ending the answer: `done` is the record.
 */
export function readAssistantEvents(buffer: string): { events: AssistantStreamEvent[]; rest: string } {
  const normalised = buffer.replace(/\r\n/g, "\n");
  const end = normalised.lastIndexOf("\n\n");
  if (end < 0) return { events: [], rest: normalised };
  const events: AssistantStreamEvent[] = [];
  for (const block of normalised.slice(0, end).split("\n\n")) {
    const data = block
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) continue;
    try {
      const e = JSON.parse(data) as AssistantStreamEvent;
      if (e && typeof e === "object" && typeof e.type === "string") events.push(e);
    } catch {
      /* a malformed event is skipped; `done` carries the whole answer */
    }
  }
  return { events, rest: normalised.slice(end + 2) };
}
