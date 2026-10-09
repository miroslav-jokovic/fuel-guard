import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * The JSON schema the reader sends as `output_config.format` (D-DR8), GENERATED from the profile's Zod
 * schema — never hand-mirrored, which is the copy F-DR7 found at `vision.ts:52` ("mirrors
 * bolFieldsSchema"). Zod 4's `z.toJSONSchema(schema, { io: "output" })` already gives most of what
 * structured outputs require: every object closed with `additionalProperties: false`, and — because
 * every ShippingDocument field has a default — every property in `required`, so the schema has no
 * optional parameters at all. Three things it emits that the API does not accept, and this pure
 * transform handles each one deliberately rather than passing them through:
 *
 *   - `$schema` (the draft URI) — not a keyword the API lists; dropped at the root.
 *   - `minimum` / `maximum` on every `z.number().int()`, set to ±Number.MAX_SAFE_INTEGER — Zod's own
 *     artefact for "a JS-safe integer", not a constraint anybody wrote. The API refuses numeric
 *     constraints with a 400, so these two exact values are dropped. Any OTHER bound is a real rule
 *     the API cannot enforce and this function THROWS on it: dropping it silently would let a profile
 *     author believe the model is held to a range it is not (the Zod re-validation on receipt would
 *     still catch the value, but as a failed read, not as the configuration error it is).
 *   - any other keyword the API documents as unsupported (`minLength`, `maxLength`, `multipleOf`,
 *     `exclusiveMinimum`, `exclusiveMaximum`, `maxItems`, `minItems` above 1, `pattern`) — thrown, for
 *     the same reason. None occurs in a profile today; the test pins that.
 *
 * `default` is kept: the API lists it as supported, and it tells the model what "not printed" is.
 * The SDK ships its own `transformJSONSchema` (`@anthropic-ai/sdk/lib/transform-json-schema`), but it
 * folds every keyword it does not recognise — `default` and the safe-integer bounds included — into
 * the field's `description` text, which would put `{default: null, minimum: -9007199254740991}` into
 * the model's instructions for forty fields. A visible, tested twenty lines beat that.
 */
export type JsonSchema = { [key: string]: unknown };

const SAFE_BOUNDS: Readonly<Record<string, number>> = {
  minimum: -Number.MAX_SAFE_INTEGER,
  maximum: Number.MAX_SAFE_INTEGER,
};
const REFUSED_KEYWORDS = [
  "minimum", "maximum", "minLength", "maxLength", "multipleOf", "exclusiveMinimum", "exclusiveMaximum",
  "maxItems", "pattern", "uniqueItems", "patternProperties", "propertyNames", "if", "then", "else", "not",
] as const;

export class UnsupportedSchemaError extends Error {
  constructor(readonly path: string, readonly keyword: string, readonly value: unknown) {
    super(`profile schema at ${path || "/"} uses "${keyword}": ${JSON.stringify(value)}, which structured outputs cannot enforce`);
    this.name = "UnsupportedSchemaError";
  }
}

/** Pure: a Zod-generated JSON schema → the schema the Messages API accepts. Never mutates its input. */
export function toWireSchema(schema: JsonSchema, path = ""): JsonSchema {
  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "$schema" && path === "") continue;
    if (key in SAFE_BOUNDS && value === SAFE_BOUNDS[key]) continue;
    if ((REFUSED_KEYWORDS as readonly string[]).includes(key)) throw new UnsupportedSchemaError(path, key, value);
    if (key === "minItems" && value !== 0 && value !== 1) throw new UnsupportedSchemaError(path, key, value);
    if (key === "additionalProperties" && value !== false) throw new UnsupportedSchemaError(path, key, value);
    out[key] = transformChild(key, value, `${path}/${key}`);
  }
  if (out.type === "object" && out.additionalProperties !== false) {
    throw new UnsupportedSchemaError(path, "additionalProperties", out.additionalProperties ?? "(absent)");
  }
  return out;
}

function transformChild(key: string, value: unknown, path: string): unknown {
  if (key === "properties" || key === "$defs" || key === "definitions") {
    return Object.fromEntries(
      Object.entries(value as Record<string, JsonSchema>).map(([k, v]) => [k, toWireSchema(v, `${path}/${k}`)]),
    );
  }
  if (key === "items" && isSchema(value)) return toWireSchema(value, path);
  if ((key === "anyOf" || key === "allOf" || key === "oneOf") && Array.isArray(value)) {
    return value.map((v, i) => toWireSchema(v as JsonSchema, `${path}/${i}`));
  }
  return value;
}

function isSchema(v: unknown): v is JsonSchema {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The profile's Zod schema → its wire schema. `io: "output"` so defaults make every key required. */
export function wireSchemaFor(schema: z.ZodType): JsonSchema {
  return toWireSchema(z.toJSONSchema(schema, { io: "output" }) as JsonSchema);
}

/** Key-sorted JSON (arrays keep their order — `required` and `enum` order is meaning, not noise). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isSchema(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** sha256 of the canonical wire schema — stored on every read and in the cache key (§4.6). */
export function schemaHash(wire: JsonSchema): string {
  return createHash("sha256").update(canonicalJson(wire)).digest("hex");
}

/**
 * The API's documented compilation limits for one request's strict schemas (structured-outputs docs,
 * "Schema complexity limits", read 2026-10-09): at most 24 optional parameters and at most 16
 * parameters with union types (`anyOf` or a type array). A nullable field is a union. Counted over
 * every property at every depth, an array's item schema once — the docs say "total parameters across
 * all strict schemas" without saying whether nested properties count, so this counts the strict
 * reading. It is a MEASUREMENT for the record and the report; the API is the arbiter (a schema over a
 * limit is a 400, which `readPages` lets propagate as the configuration error it is).
 */
export const STRUCTURED_OUTPUT_LIMITS = { optionalParameters: 24, unionParameters: 16 } as const;

export function schemaComplexity(wire: JsonSchema): { optionalParameters: number; unionParameters: number } {
  let optionalParameters = 0;
  let unionParameters = 0;
  const visit = (s: JsonSchema): void => {
    const props = isSchema(s.properties) ? (s.properties as Record<string, JsonSchema>) : {};
    const required = new Set(Array.isArray(s.required) ? (s.required as string[]) : []);
    for (const [name, p] of Object.entries(props)) {
      if (!required.has(name)) optionalParameters++;
      if (Array.isArray(p.anyOf) || Array.isArray(p.type)) unionParameters++;
    }
    const children = [...Object.values(props), ...(isSchema(s.items) ? [s.items] : [])];
    for (const branch of [...children, ...((s.anyOf as JsonSchema[] | undefined) ?? [])]) visit(branch);
  };
  visit(wire);
  return { optionalParameters, unionParameters };
}
