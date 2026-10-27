import { describe, expect, it } from "vitest";
import { lineCut, scriptMismatch, type Word } from "./bracketTrim";

/** "Ready.[0-0.26] Click[0.98-1.04] it,[1.04-1.28]" → Words. */
const words = (s: string): Word[] =>
  [...s.matchAll(/(\S+)\[([\d.]+)-([\d.]+)\]/g)].map((m) => ({ w: m[1] ?? "", start: Number(m[2]), end: Number(m[3]) }));

/**
 * Takes measured on 2026-10-27, each one a line the films' pause-shape trim damaged: its words
 * (words.py) and its silences (silencedetect -50dB, 0.10 s). The cut must land on the silence beside
 * the line's first and last word.
 */
describe("lineCut", () => {
  it("keeps a short opening phrase the pause-shape trim took for Ready", () => {
    const cut = lineCut(
      words("ready.[0-0.26] Click[0.98-1.04] it,[1.04-1.28] and[1.68-1.76] the[1.76-1.84] map[1.84-2.02] flies[2.02-2.36] to[2.36-2.6] the[2.6-2.72] truck[2.72-3.0] and[3.0-3.22] opens[3.22-3.5] its[3.5-3.7] card.[3.7-4.02] Okay.[4.78-5.1]"),
      [[0.368, 0.911], [1.326, 1.661], [4.135, 4.883], [5.165, 5.408]],
      5.408,
    );
    expect(cut.span).toEqual([0.911, 4.135]);
    expect(cut.heard).toBe("Click it, and the map flies to the truck and opens its card.");
    expect(cut.room).toEqual([0.26, 4.78]);
  });

  it("keeps a one-word opening when the take begins 'Get ready.'", () => {
    const cut = lineCut(
      words("Get[0.0-0.06] ready.[0.06-0.28] Now,[1.1-1.24] calculate.[1.82-1.98] OK.[2.92-3.28]"),
      [[0.357, 0.989], [1.254, 1.611], [2.163, 3.035], [3.456, 3.59]],
      3.59,
    );
    expect(cut.span).toEqual([0.989, 2.163]);
    expect(cut.heard).toBe("Now, calculate.");
  });

  it("keeps a list's last items, and ends the line when Whisper did not hear Okay", () => {
    const cut = lineCut(
      words("ready.[0.0-0.2] These[1.04-1.22] counts[1.22-1.58] doing,[3.76-4.08] moving,[4.74-5.12] stopped,[5.48-5.96] parked[6.68-6.86] or[6.86-7.52] offline.[7.52-7.94]"),
      [[0.31, 1.038], [4.194, 4.751], [5.233, 5.521], [6.085, 6.489], [7.001, 7.366], [8.115, 8.948]],
      9.2,
    );
    expect(cut.span).toEqual([1.038, 8.115]);
  });

  it("cuts halfway when the reader ran Ready straight into the line, never at the silence before Ready", () => {
    // The lead-in silence [0, 0.1] is the only silence before the line; cutting there keeps "Ready.".
    // A tick at 1.3-1.4 splits the pause before Okay; the cut is the FIRST silence after the line.
    const cut = lineCut(words("Ready.[0.1-0.5] Drums.[0.6-1.0] Okay.[1.6-1.9]"), [[0, 0.1], [1.1, 1.3], [1.4, 1.55]], 2.0);
    expect(cut.span).toEqual([0.55, 1.1]);
  });

  it("refuses a take with no Ready at the start", () => {
    expect(() => lineCut(words("Loads[0.2-0.5] come[0.5-0.7] Okay.[1.6-1.9]"), [], 2)).toThrow(/no "Ready\." heard/);
  });
});

describe("scriptMismatch", () => {
  it("passes numbers spelled for the voice and written as digits by Whisper", () => {
    expect(scriptMismatch("For example, load D F two oh four one eight.", "For example, load DF20418.")).toBeNull();
    expect(scriptMismatch("Truck ten forty-two will be free there this afternoon.", "Truck 1042 will be free there this afternoon.")).toBeNull();
  });

  it("passes one misheard proper noun in a long line", () => {
    expect(
      scriptMismatch(
        "Loads come from McLeod. The tabs split them by where they are: in transit, upcoming, uncovered and delivered.",
        "Loads come from a cloud. The tabs split them by where they are. In transit, upcoming, uncovered and delivered.",
      ),
    ).toBeNull();
  });

  it("fails a line that lost its opening words", () => {
    expect(scriptMismatch("All trucks brings everyone back.", "brings everyone back.")).toMatch(/opens on "brings"/);
  });

  it("fails a line that lost its closing words", () => {
    expect(scriptMismatch("These counts split the fleet: moving, stopped, parked or offline.", "These counts split the fleet: moving.")).toMatch(
      /closes on "moving"/,
    );
  });

  it("fails a line with a stray clause inside it", () => {
    expect(scriptMismatch("Click one to show only those trucks.", "Click one ready to show the only trucks okay those trucks.")).toMatch(/agree/);
  });
});
