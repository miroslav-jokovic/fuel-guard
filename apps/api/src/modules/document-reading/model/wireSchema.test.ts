import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DOCUMENT_PROFILES, DOCUMENT_PROFILE_IDS } from "@silvicom/shared";
import { sectionWireSchemas } from "./readSections.js";
import {
  STRUCTURED_OUTPUT_LIMITS,
  UnsupportedSchemaError,
  canonicalJson,
  schemaComplexity,
  schemaHash,
  toWireSchema,
  wireSchemaFor,
  type JsonSchema,
} from "./wireSchema.js";

const KEYWORDS_THE_API_REFUSES = ["minimum", "maximum", "minLength", "maxLength", "multipleOf", "pattern", "$schema"];

function everyKey(s: unknown, out: string[] = []): string[] {
  if (Array.isArray(s)) s.forEach((v) => everyKey(v, out));
  else if (s && typeof s === "object") {
    for (const [k, v] of Object.entries(s)) {
      out.push(k);
      // property NAMES are not keywords — only descend into their schemas
      if (k === "properties") Object.values(v as object).forEach((p) => everyKey(p, out));
      else everyKey(v, out);
    }
  }
  return out;
}

function everyObject(s: unknown, out: JsonSchema[] = []): JsonSchema[] {
  if (Array.isArray(s)) s.forEach((v) => everyObject(v, out));
  else if (s && typeof s === "object") {
    if ((s as JsonSchema).type === "object") out.push(s as JsonSchema);
    Object.values(s).forEach((v) => everyObject(v, out));
  }
  return out;
}

describe("wireSchemaFor — the profile schema as structured outputs accepts it", () => {
  it.each(DOCUMENT_PROFILE_IDS)("%s: no keyword the API refuses survives", (id) => {
    const keys = everyKey(wireSchemaFor(DOCUMENT_PROFILES[id].schema));
    expect(keys.filter((k) => KEYWORDS_THE_API_REFUSES.includes(k))).toEqual([]);
  });

  it.each(DOCUMENT_PROFILE_IDS)("%s: every object is closed and lists every property as required", (id) => {
    const objects = everyObject(wireSchemaFor(DOCUMENT_PROFILES[id].schema));
    expect(objects.length).toBeGreaterThan(5);
    for (const o of objects) {
      expect(o.additionalProperties).toBe(false);
      expect([...(o.required as string[])].sort()).toEqual(Object.keys(o.properties as object).sort());
    }
  });

  it("is the Zod output schema with only the $schema URI and the safe-integer bounds removed", () => {
    const zodJson = JSON.stringify(z.toJSONSchema(DOCUMENT_PROFILES.shipping_document.schema, { io: "output" }));
    const stripped = JSON.parse(
      zodJson
        .replace(/"\$schema":"[^"]*",/, "")
        .replaceAll(`,"minimum":-${Number.MAX_SAFE_INTEGER}`, "")
        .replaceAll(`,"maximum":${Number.MAX_SAFE_INTEGER}`, ""),
    );
    expect(wireSchemaFor(DOCUMENT_PROFILES.shipping_document.schema)).toEqual(stripped);
  });

  it("does not mutate the schema it is given", () => {
    const input: JsonSchema = { $schema: "x", type: "object", properties: { n: { type: "integer", minimum: -Number.MAX_SAFE_INTEGER } }, required: ["n"], additionalProperties: false };
    const before = JSON.stringify(input);
    toWireSchema(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("toWireSchema — a real constraint is refused, never silently dropped", () => {
  it("throws on a bound that is not Zod's safe-integer artefact", () => {
    expect(() => wireSchemaFor(z.object({ n: z.number().int().min(0) }))).toThrow(UnsupportedSchemaError);
  });
  it("throws on a string length constraint", () => {
    expect(() => wireSchemaFor(z.object({ s: z.string().max(12) }))).toThrow(/maxLength/);
  });
  it("throws on minItems above 1, accepts 0 and 1", () => {
    expect(() => wireSchemaFor(z.object({ a: z.array(z.string()).min(2) }))).toThrow(/minItems/);
    expect(() => wireSchemaFor(z.object({ a: z.array(z.string()).min(1) }))).not.toThrow();
  });
  it("throws on an open object", () => {
    expect(() => toWireSchema({ type: "object", properties: {}, additionalProperties: true })).toThrow(/additionalProperties/);
    expect(() => toWireSchema({ type: "object", properties: {} })).toThrow(/additionalProperties/);
  });
  it("names the path of the offending keyword", () => {
    expect(() => wireSchemaFor(z.object({ outer: z.object({ s: z.string().min(3) }) }))).toThrow("/properties/outer/properties/s");
  });
});

describe("schemaHash — stable across key order, sensitive to content", () => {
  it("is the same for the same schema built twice", () => {
    const a = schemaHash(wireSchemaFor(DOCUMENT_PROFILES.shipping_document.schema));
    const b = schemaHash(wireSchemaFor(DOCUMENT_PROFILES.shipping_document.schema));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
  });
  it("ignores object key order", () => {
    expect(schemaHash({ type: "string", description: "x" })).toBe(schemaHash({ description: "x", type: "string" }));
  });
  it("keeps array order — required and enum order are meaning", () => {
    expect(canonicalJson({ enum: ["a", "b"] })).not.toBe(canonicalJson({ enum: ["b", "a"] }));
  });
  it("changes when the schema changes", () => {
    const base = wireSchemaFor(DOCUMENT_PROFILES.shipping_document.schema);
    const changed = wireSchemaFor(DOCUMENT_PROFILES.shipping_document.schema.extend({ extra: z.string().nullable().default(null) }));
    expect(schemaHash(changed)).not.toBe(schemaHash(base));
  });
});

describe("schemaComplexity — measured against the documented compilation limits", () => {
  it("counts nullable fields as unions and absent-from-required as optional, at every depth", () => {
    const s = toWireSchema({
      type: "object", additionalProperties: false, required: ["a", "o"],
      properties: {
        a: { anyOf: [{ type: "string" }, { type: "null" }] },
        b: { type: ["number", "null"] },
        o: { type: "object", additionalProperties: false, required: [], properties: { c: { type: "string" } } },
      },
    });
    expect(schemaComplexity(s)).toEqual({ optionalParameters: 2, unionParameters: 2 });
  });

  it("counts a list whose items are a union as one union, a list of objects as none", () => {
    const s = wireSchemaFor(z.object({ a: z.array(z.string().nullable()), o: z.array(z.object({ n: z.string() })) }));
    expect(schemaComplexity(s)).toEqual({ optionalParameters: 0, unionParameters: 1 });
  });

  // The measurement the Step 1.4 report rests on: the shipping document has no optional parameter (every
  // field defaults, so `io: "output"` requires all of them) but one union per nullable field, which is
  // well over the documented 16 — 37 at profile 1.0.0, refused live with 400 (Q-DR11); 40 at 1.1.0. This
  // is why the profile is read in sections (below), and it stays pinned so the whole-document count is
  // never mistaken for one that a single request could send.
  it("shipping_document whole: 0 optional parameters, 40 union parameters (limit 16)", () => {
    const c = schemaComplexity(wireSchemaFor(DOCUMENT_PROFILES.shipping_document.schema));
    expect(c).toEqual({ optionalParameters: 0, unionParameters: 40 });
    expect(c.optionalParameters).toBeLessThanOrEqual(STRUCTURED_OUTPUT_LIMITS.optionalParameters);
    expect(c.unionParameters).toBeGreaterThan(STRUCTURED_OUTPUT_LIMITS.unionParameters);
  });
});

/**
 * Q-DR11's gate: every section of every sectioned profile, as the wire schema `readSections` sends, is
 * under the documented per-request limits — so a field added later that breaks a section fails here,
 * not as a 400 on a read. STRICTLY under 16 unions: the docs say "at most 16", and one live probe on
 * 2026-10-09 had a FLAT object of 16 nullable strings accepted, but nothing measures 16 for a nested
 * schema of real size, and the grammar-size limit is a second, unpublished one (the "16 nullable + 21
 * optional" variant was refused as "The compiled grammar is too large") — so 16 is not assumed to pass.
 * Optional parameters: at most 24.
 */
describe("profile sections — each one request the API will compile", () => {
  const sectioned = DOCUMENT_PROFILE_IDS.filter((id) => (DOCUMENT_PROFILES[id] as { sections?: unknown }).sections);
  it("has at least one sectioned profile to check", () => {
    expect(sectioned).toContain("shipping_document");
  });
  it.each(sectioned.flatMap((id) => sectionWireSchemas(id).map((s) => [id, s.name, s.wire] as const)))(
    "%s/%s: unions < 16, optional <= 24",
    (_id, _name, wire) => {
      const c = schemaComplexity(wire);
      expect(c.unionParameters).toBeLessThan(STRUCTURED_OUTPUT_LIMITS.unionParameters);
      expect(c.optionalParameters).toBeLessThanOrEqual(STRUCTURED_OUTPUT_LIMITS.optionalParameters);
    },
  );
  it("shipping_document's measured packing: identity 15, load 12, lines 13 unions; none optional", () => {
    const counts = sectionWireSchemas("shipping_document").map((s) => [s.name, schemaComplexity(s.wire)]);
    expect(Object.fromEntries(counts)).toEqual({
      identity: { optionalParameters: 0, unionParameters: 15 },
      load: { optionalParameters: 0, unionParameters: 12 },
      lines: { optionalParameters: 0, unionParameters: 13 },
    });
  });
  it("the sections' unions add up to the whole document's — none is lost or counted twice", () => {
    const total = sectionWireSchemas("shipping_document").reduce((t, s) => t + schemaComplexity(s.wire).unionParameters, 0);
    expect(total).toBe(schemaComplexity(wireSchemaFor(DOCUMENT_PROFILES.shipping_document.schema)).unionParameters);
  });
});
