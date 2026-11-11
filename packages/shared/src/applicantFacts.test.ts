import { describe, expect, it } from "vitest";
import { z } from "zod";
import { driverApplicationObject } from "./applicationContract.js";
import {
  applicantIntakeLicenceSchema,
  applicantIntakeSchema,
  partOneCorrectionSchema,
} from "./applicantScreeningContract.js";
import { APPLICANT_IDENTITY_KEYS } from "./applicantIdentity.js";
import { PART_ONE_COMPOSED_KEYS } from "./applicationComposition.js";
import { PART_ONE_ANSWER_KEYS, partOneAnswerSchema } from "./applicantPartOneAnswerContract.js";
import {
  APPLICANT_FACTS,
  NOT_APPLICANT_FACTS,
  OFF_CONTRACT_FACTS,
  partOneKeyThrough,
  type ApplicantFact,
} from "./applicantFacts.js";

/**
 * D-AM7's parity, from the contracts' side (APPLICATION-FIX-PLAN F1). The packet's side is
 * `apps/api/.../packet/applicantFactsPacket.test.ts`, because the packet's lines live in the api.
 *
 * ⚠ The paths are WALKED out of the Zod schemas, never listed here: a list in this test would be a
 * third copy that agrees with the catalogue by construction and proves nothing.
 */

type Def = { type?: string; innerType?: z.ZodType; in?: z.ZodType; out?: z.ZodType; element?: z.ZodType };
const defOf = (s: unknown): Def => ((s as { _zod?: { def?: Def } })?._zod?.def ?? {}) as Def;

/** Strip the wrappers that do not change WHAT is stored — optional, nullable, default, a transform's input. */
function unwrap(schema: z.ZodType): z.ZodType {
  let at = schema;
  for (;;) {
    const d = defOf(at);
    if (["optional", "nullable", "default", "prefault", "catch", "readonly"].includes(d.type ?? "")) at = d.innerType!;
    else if (d.type === "pipe") at = defOf(d.in).type === "transform" ? d.out! : d.in!;
    else return at;
  }
}

function paths(prefix: string, schema: z.ZodType, out: string[] = []): string[] {
  const at = unwrap(schema);
  const d = defOf(at);
  if (d.type === "object") {
    for (const [k, v] of Object.entries((at as z.ZodObject).shape)) paths(prefix ? `${prefix}.${k}` : k, v as z.ZodType, out);
  } else if (d.type === "array") {
    const el = unwrap(d.element!);
    if (defOf(el).type === "object") paths(`${prefix}[]`, el, out);
    else out.push(`${prefix}[]`);
  } else out.push(prefix);
  return out;
}

const CONTRACT_PATHS = [
  ...paths("application", driverApplicationObject),
  ...paths("intake", applicantIntakeSchema),
  ...paths("intake.licences[]", applicantIntakeLicenceSchema),
];
const FACT_PATHS = APPLICANT_FACTS.map((f) => f.path);
const byPath = new Map(APPLICANT_FACTS.map((f) => [f.path, f]));

describe("the applicant fact catalogue (D-AM1)", () => {
  it("walks a real contract, so the parity below is not vacuous", () => {
    // A walker that stopped at the first wrapper would report no paths and pass every check.
    expect(CONTRACT_PATHS.length).toBeGreaterThan(90);
    expect(CONTRACT_PATHS).toContain("application.employers[].reason_for_leaving");
    expect(CONTRACT_PATHS).toContain("intake.licences[].expires_on");
  });

  it("has an entry, or a declared reason it is not a fact, for every key of both contracts", () => {
    const missing = CONTRACT_PATHS.filter((p) => !byPath.has(p) && !(p in NOT_APPLICANT_FACTS));
    expect(missing).toEqual([]);
  });

  it("names no path that neither contract has", () => {
    const contract = new Set(CONTRACT_PATHS);
    const stale = [...FACT_PATHS, ...Object.keys(NOT_APPLICANT_FACTS)].filter(
      (p) => !contract.has(p) && !OFF_CONTRACT_FACTS.includes(p),
    );
    expect(stale).toEqual([]);
  });

  it("lists each fact once and never both as a fact and as not one", () => {
    expect(new Set(FACT_PATHS).size).toBe(FACT_PATHS.length);
    expect(FACT_PATHS.filter((p) => p in NOT_APPLICANT_FACTS)).toEqual([]);
  });

  it("gives every fact a packet place or the reason it has none", () => {
    const silent = APPLICANT_FACTS.filter((f) => {
      const p = f.packet;
      if (Array.isArray(p)) return p.length === 0;
      if ("notPrinted" in p) return p.notPrinted.trim() === "";
      return false;
    });
    expect(silent.map((f) => f.path)).toEqual([]);
  });

  it("sends every Part 1 fact the filing composes to an application fact that exists", () => {
    const through = APPLICANT_FACTS.flatMap((f) =>
      !Array.isArray(f.packet) && "through" in f.packet ? [[f.path, f.packet.through] as const] : [],
    );
    expect(through.length).toBeGreaterThan(5);
    for (const [from, to] of through) {
      expect(from.startsWith("intake."), from).toBe(true);
      expect(byPath.has(to), `${from} → ${to}`).toBe(true);
    }
  });

  it("only sends a fact to the identity correction if that correction owns it", () => {
    const identity = APPLICANT_FACTS.filter((f) => f.office === "identity").map((f) => f.path);
    for (const p of identity) {
      const key = p.replace(/^(application|intake)\./, "");
      expect(APPLICANT_IDENTITY_KEYS as readonly string[], p).toContain(key);
    }
    // ...and every key it owns says so, so the drawer cannot offer DOB as a draft edit again (F0, E1).
    for (const key of APPLICANT_IDENTITY_KEYS) expect(byPath.get(`application.${key}`)?.office).toBe("identity");
  });

  it("only sends a fact to the Part 1 correction if that correction takes it", () => {
    const correctable = new Set(paths("", partOneCorrectionSchema).map((p) => p.replace(/^licences\[\]/, "licences[]")));
    const partOne = APPLICANT_FACTS.filter((f) => f.office === "part_one");
    for (const f of partOne) {
      if (f.path.startsWith("intake.")) {
        const key = f.path.slice("intake.".length);
        const corrected = correctable.has(key) || correctable.has(key.replace("licences[].", "licences[]."));
        // The Part 1 correction writes `state_code`/`licence_number`/`expires_on`/`agency` per licence.
        expect(corrected, f.path).toBe(true);
      } else {
        const top = f.path.slice("application.".length).split(/[.[]/)[0]!;
        expect(PART_ONE_COMPOSED_KEYS as readonly string[], f.path).toContain(top);
      }
    }
  });

  /** F3 (Q-AM13): one Part 1 answer at a time, for what the whole-set correction does not carry. */
  it("only sends a fact to the one-answer Part 1 correction if that correction takes it", () => {
    for (const f of APPLICANT_FACTS.filter((x) => x.office === "part_one_answer")) {
      const key = f.path.startsWith("intake.")
        ? f.path.slice("intake.".length).replace(/\[\]$/, "")
        : partOneKeyThrough(f.path);
      expect(PART_ONE_ANSWER_KEYS as readonly string[], f.path).toContain(key);
    }
    // ...and every key it takes is a fact that says so, so a key cannot be writable and off the card.
    for (const key of PART_ONE_ANSWER_KEYS) {
      expect(APPLICANT_FACTS.find((f) => f.path.replace(/\[\]$/, "") === `intake.${key}`)?.office, key).toBe("part_one_answer");
    }
  });

  it("requires a note on exactly the catalogue's statements, and on nothing else", () => {
    const statements = APPLICANT_FACTS.filter((f) => f.rule === "statement" && f.path.startsWith("intake."))
      .map((f) => f.path.slice("intake.".length)).sort();
    const noted = partOneAnswerSchema.options.filter((o) => "note" in o.shape).map((o) => o.shape.key.value).sort();
    expect(noted).toEqual(statements);
    // An application fact that is a statement is one composed from a Part 1 statement.
    for (const f of APPLICANT_FACTS.filter((x) => x.rule === "statement" && x.path.startsWith("application."))) {
      expect(statements, f.path).toContain(partOneKeyThrough(f.path));
    }
  });

  it("names the reason for every fact the office cannot correct yet (F3's list)", () => {
    const shut = APPLICANT_FACTS.filter((f): f is ApplicantFact & { office: { none: string } } => typeof f.office === "object");
    for (const f of shut) expect(f.office.none.trim(), f.path).not.toBe("");
    // A snapshot of the gap, so closing one (F3) or opening one is a visible change to this test.
    expect(shut.map((f) => f.path)).toMatchInlineSnapshot(`
      [
        "ssn",
      ]
    `);
  });
});
