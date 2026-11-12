import { describe, expect, it } from "vitest";
import { ASSISTANT_TOOL_NAMES } from "./assistantContract.js";
import { ASSISTANT_TOOL_STEP, assistantStepLabel, encodeAssistantEvent, readAssistantEvents, type AssistantStreamEvent } from "./assistantStreamContract.js";

const EVENTS: AssistantStreamEvent[] = [
  { type: "step", label: "Reading the fuel report" },
  { type: "text", delta: "Spend was\n$41,200 " },
  { type: "done", answer: "Spend was\n$41,200 in October.", pages: ["fuel.spend"], links: [] },
];

describe("the streamed answer's wire (F21 Step 2d)", () => {
  it("reads back exactly what the route wrote, however the network cuts the bytes", () => {
    const wire = EVENTS.map(encodeAssistantEvent).join("");
    // Every cut point: mid-line, mid-JSON, between the two newlines that end an event.
    for (let cut = 1; cut < wire.length; cut++) {
      const first = readAssistantEvents(wire.slice(0, cut));
      const second = readAssistantEvents(first.rest + wire.slice(cut));
      expect([...first.events, ...second.events]).toEqual(EVENTS);
      expect(second.rest).toBe("");
    }
  });

  it("keeps an unfinished event for the next chunk, skips a malformed one, and reads CRLF line ends", () => {
    expect(readAssistantEvents('data: {"type":"text","delta":"Sp')).toEqual({ events: [], rest: 'data: {"type":"text","delta":"Sp' });
    expect(readAssistantEvents('data: {not json\n\ndata: {"type":"text","delta":"a"}\r\n\r\n').events).toEqual([{ type: "text", delta: "a" }]);
  });

  it("every tool shows the office a step in words, never its own name", () => {
    for (const tool of ASSISTANT_TOOL_NAMES) {
      expect(ASSISTANT_TOOL_STEP[tool], tool).toMatch(/^[A-Z][a-z]/);
      expect(ASSISTANT_TOOL_STEP[tool]).not.toContain("_");
    }
    expect(assistantStepLabel("not_a_tool")).toBe("Reading your data");
  });
});
