import { z } from "zod";
import { leafFieldPaths, parseFieldPath } from "./fieldEvidenceContract.js";
import type { DocumentProfile, DocumentSection } from "./documentReadingContract.js";

/**
 * A profile read in SECTIONS (Q-DR11): one request per section, each section's schema DERIVED from the
 * profile's, and the answers merged back into one document. Moved out of `documentReadingContract.ts` on
 * 2026-10-21 when the third profile (`compliance_paper`, UNIT-FILES-PLAN UF7b2) took that file past its
 * 500-line budget; nothing here changed. Type-only imports of the registry, so no import cycle at runtime.
 */
// ── sections (Q-DR11) ──────────────────────────────────────────────────────────────────────────────
type GroupTree = { [key: string]: GroupTree | true };

/** Group paths → a key tree. Refuses an index, a duplicate, or one group nested inside another. */
function groupTree(groups: readonly string[]): GroupTree {
  const root: GroupTree = {};
  for (const g of groups) {
    const keys = parseFieldPath(g);
    if (keys.some((k) => typeof k === "number")) throw new Error(`section group ${g} has an index`);
    let node = root;
    keys.forEach((k, i) => {
      const at = node[k as string];
      const last = i === keys.length - 1;
      if (at === true || (at !== undefined && last)) throw new Error(`section group ${g} overlaps another`);
      if (last) node[k as string] = true;
      else node = (node[k as string] ??= {}) as GroupTree;
    });
  }
  return root;
}

function pickGroups(schema: z.ZodType, tree: GroupTree, at: string): z.ZodObject {
  const obj = schema instanceof z.ZodDefault ? (schema.unwrap() as z.ZodType) : schema;
  if (!(obj instanceof z.ZodObject)) throw new Error(`section group ${at || "(root)"} is not an object`);
  const shape: Record<string, z.ZodType> = {};
  for (const [key, sub] of Object.entries(tree)) {
    const field = obj.shape[key] as z.ZodType | undefined;
    if (!field) throw new Error(`section group ${at}${key} is not a field of the profile`);
    if (sub === true) {
      shape[key] = field;
      continue;
    }
    const picked = pickGroups(field, sub, `${at}${key}.`);
    // A partly-taken object keeps the profile's "defaults to empty", so `{}` still parses.
    shape[key] = field instanceof z.ZodDefault ? picked.default(() => picked.parse({})) : picked;
  }
  return z.object(shape);
}

function sectionOf(profile: DocumentProfile, name: string): DocumentSection {
  const section = profile.sections?.find((s) => s.name === name);
  if (!section) throw new Error(`profile ${profile.version} has no section ${name}`);
  return section;
}

/**
 * Pure: one section's Zod schema, DERIVED from the profile's — the profile's own field schemas, picked
 * by the section's groups, never restated. The wire schema generated from it is what one request sends.
 */
export function sectionSchema(profile: DocumentProfile, name: string): z.ZodObject {
  return pickGroups(profile.schema, groupTree(sectionOf(profile, name).groups), "");
}

/** The sections whose groups own a field path (indexes ignored). A sound profile answers exactly one. */
export function sectionsOwning(profile: DocumentProfile, path: string): string[] {
  const keys = parseFieldPath(path).filter((k) => typeof k === "string");
  return (profile.sections ?? [])
    .filter((s) => s.groups.some((g) => parseFieldPath(g).every((k, i) => keys[i] === k)))
    .map((s) => s.name);
}

const isRecord = (v: unknown): v is Record<string, unknown> => v != null && typeof v === "object" && !Array.isArray(v);

function mergeInto(target: Record<string, unknown>, part: Record<string, unknown>, at: string): void {
  for (const [key, value] of Object.entries(part)) {
    const prior = target[key];
    if (prior === undefined) target[key] = JSON.parse(JSON.stringify(value)) as unknown; // parts are JSON answers
    else if (isRecord(prior) && isRecord(value)) mergeInto(prior, value, `${at}${key}.`);
    else throw new Error(`sections overlap at ${at}${key}`);
  }
}

/**
 * Pure: the section answers, keyed by section name, deep-merged into one document and parsed with the
 * profile schema. Refuses a missing or unknown section, a part that writes a field another section owns,
 * and two parts writing the same key — a merge that guessed would be a document nobody read.
 */
export function mergeSections(profile: DocumentProfile, parts: Readonly<Record<string, unknown>>): unknown {
  const names = (profile.sections ?? []).map((s) => s.name);
  if (names.length === 0) throw new Error(`profile ${profile.version} is not read in sections`);
  const unknown = Object.keys(parts).filter((n) => !names.includes(n));
  if (unknown.length) throw new Error(`unknown section ${unknown.join(", ")}`);
  const merged: Record<string, unknown> = {};
  for (const name of names) {
    const part = parts[name];
    if (!isRecord(part)) throw new Error(`section ${name} is missing`);
    const foreign = leafFieldPaths(part).filter((p) => !sectionsOwning(profile, p).includes(name));
    if (foreign.length) throw new Error(`section ${name} writes ${foreign.slice(0, 3).join(", ")}, which it does not own`);
    mergeInto(merged, part, "");
  }
  return profile.schema.parse(merged);
}
