import { describe, expect, it } from "vitest";
import { creativeCheckGrid, type AdCheckRow } from "./creativeChecks.js";

/**
 * The review screen's grid of D-AD12's three checks (E3). The fixtures are the literal shapes compose writes
 * (`compose/composeCreative.ts`, `finish`/`stop`): a ready creative, a copy refusal, a render refusal, and a visual
 * failure after every attempt.
 */
const pass = (check: string) => ({ check, verdict: "pass", reason: "Looks right here." });
const fail = (check: string, reason: string) => ({ check, verdict: "fail", reason });
const cell = (rows: AdCheckRow[], format: string, language: string, check: string) =>
  rows.find((r) => r.format === format && r.language === language)!.cells.find((c) => c.check === check)!;

describe("creativeCheckGrid", () => {
  it("a ready creative passed all three checks in every format and both languages", () => {
    const checks = {
      copy: { ok: true }, render: { ok: true },
      visual: { ok: true, attempt: 1, results: { "1:1": [pass("no_glyphs")], "4:5": [pass("no_glyphs"), { check: "people_policy_met", verdict: "not_applicable", reason: "No people." }] } },
      visual_attempts: [],
    };
    const g = creativeCheckGrid(checks, ["1:1", "4:5"]);
    expect(g.readable && g.rows.map((r) => `${r.format}/${r.language}`)).toEqual(["1:1/en", "1:1/es", "4:5/en", "4:5/es"]);
    expect(g.rows.flatMap((r) => r.cells.map((c) => c.verdict))).toEqual(Array(12).fill("passed"));
  });

  it("a copy refusal fails the copy check only in the language it was found in, and nothing after it ran", () => {
    const g = creativeCheckGrid({ copy: { ok: false, findings: [{ kind: "too_long", language: "es", slot: "headline" }] } }, ["1:1"]);
    expect(cell(g.rows, "1:1", "es", "copy").verdict).toBe("failed");
    expect(cell(g.rows, "1:1", "en", "copy").verdict).toBe("passed");
    expect(cell(g.rows, "1:1", "en", "render").verdict).toBe("not_run");
    expect(cell(g.rows, "1:1", "en", "visual").verdict).toBe("not_run");
  });

  it("a copy refusal that names no language fails the copy check everywhere, rather than claiming one passed", () => {
    const g = creativeCheckGrid({ copy: { ok: false } }, ["1:1"]);
    expect(g.rows.map((r) => r.cells[0]!.verdict)).toEqual(["failed", "failed"]);
  });

  it("a render refusal fails the format and language compose stopped at, and shows a row for it with no image yet", () => {
    const g = creativeCheckGrid({ copy: { ok: true }, render: { ok: false, format: "9:16", language: "es", findings: [{ kind: "low_contrast" }] }, visual_attempts: [] }, []);
    expect(g.rows.map((r) => `${r.format}/${r.language}`)).toEqual(["9:16/en", "9:16/es"]);
    expect(cell(g.rows, "9:16", "es", "render").verdict).toBe("failed");
    expect(cell(g.rows, "9:16", "en", "render").verdict).toBe("not_run");
  });

  it("a visual failure after every attempt carries the checker's own sentences from the last attempt", () => {
    const checks = {
      copy: { ok: true }, render: { ok: true }, visual: { ok: false },
      visual_attempts: [
        { attempt: 1, visual: { "1:1": [fail("no_glyphs", "Letters on the trailer.")] } },
        { attempt: 2, visual: { "1:1": [fail("no_foreign_logos", "A logo on the cab door."), pass("no_glyphs")] } },
      ],
    };
    const c = cell(creativeCheckGrid(checks, []).rows, "1:1", "en", "visual");
    expect(c).toEqual({ check: "visual", verdict: "failed", reasons: ["A logo on the cab door."] });
  });

  it("a creative still being made has every check not run, never passed", () => {
    const g = creativeCheckGrid(null, ["1:1"]);
    expect(g.rows.flatMap((r) => r.cells.map((c) => c.verdict))).toEqual(Array(6).fill("not_run"));
  });

  it("a body it cannot read is unreadable, never a grid of passes", () => {
    expect(creativeCheckGrid({ copy: { ok: "yes" } }, ["1:1"])).toEqual({ readable: false, rows: [] });
  });
});
