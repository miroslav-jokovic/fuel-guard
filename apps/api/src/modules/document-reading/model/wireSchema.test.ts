import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DOCUMENT_PROFILES, DOCUMENT_PROFILE_IDS } from "@silvicom/shared";
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

  // The measurement the Step 1.4 report rests on: the shipping document has no optional parameter (every
  // field defaults, so `io: "output"` requires all of them) but one union per nullable field, which is
  // well over the documented 16. The live call decides whether the API counts it the same way.
  it("shipping_document: 0 optional parameters, 37 union parameters (limit 16)", () => {
    const c = schemaComplexity(wireSchemaFor(DOCUMENT_PROFILES.shipping_document.schema));
    expect(c).toEqual({ optionalParameters: 0, unionParameters: 37 });
    expect(c.optionalParameters).toBeLessThanOrEqual(STRUCTURED_OUTPUT_LIMITS.optionalParameters);
    expect(c.unionParameters).toBeGreaterThan(STRUCTURED_OUTPUT_LIMITS.unionParameters);
  });
});
