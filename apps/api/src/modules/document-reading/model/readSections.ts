import { createHash } from "node:crypto";
import { DOCUMENT_PROFILES, mergeSections, sectionSchema, type ReadFailureCode } from "@silvicom/shared";
import { readWithSchema, type ModelClient, type ReadPagesInput, type ReadPagesResult, type ReadUsage } from "./readPages.js";
import { schemaHash, wireSchemaFor } from "./wireSchema.js";

/**
 * The read of a SECTIONED profile (Q-DR11, ruled 2026-10-09): one strict structured-output request per
 * section of the profile registry, all in flight at once, each answer validated with its own section
 * schema, then merged into one profile document by `mergeSections`. The API refuses the shipping
 * document as one strict schema (37 union parameters against 16 when measured, 40 at profile 1.1.0), so
 * this replaces `readPages` for it; `readPages` stays for a profile that registers no sections.
 *
 * What the caller gets is ONE result, as if one request had been made:
 *   - `ok` only when every section is ok; the document is the merge.
 *   - otherwise the first failing section by FAILURE_PRECEDENCE, then by section order. Refusal
 *     first: the model declined the content, and no retake or re-read changes that, so it is the
 *     sentence the dispatcher must see. Then max_tokens: the paper holds more than a request can
 *     write — a property of the paper. schema_invalid last: the least specific, and the one most likely
 *     to be the model's slip on a single section.
 *   - a TransientModelError (429, 5xx, timeout) from ANY section rethrows, so the queue retries the whole
 *     read: a document with one section missing is not a document. Any other error propagates as from
 *     `readPages`. The sibling requests are not cancelled — their usage is spent either way, and the SDK
 *     surface the reader injects has no abort.
 *   - usage summed over the sections; a cache figure is null when ANY section reported none, because a
 *     sum over the sections that did would be a smaller number presented as the total.
 *   - per-section provenance, and `schemaHash` = sha256 of the ordered `name:hash` lines of the section
 *     schemas — one value for the cache key (§4.6) that changes when any section's schema or the
 *     sectioning itself changes.
 */
export const FAILURE_PRECEDENCE = ["refusal", "max_tokens", "schema_invalid"] as const satisfies readonly ReadFailureCode[];
type SectionFailure = (typeof FAILURE_PRECEDENCE)[number];

export interface SectionOutcome {
  name: string;
  kind: ReadPagesResult["kind"];
  detail: string | null;
  schemaHash: string;
  usage: ReadUsage;
  model: string;
  stopReason: string | null;
}

interface SectionsProvenance {
  usage: ReadUsage;
  model: string;
  promptVersion: string;
  /** The combined hash of the ordered section schemas. */
  schemaHash: string;
  sectionHashes: Record<string, string>;
  sections: SectionOutcome[];
  stopReason: string | null;
}
export type ReadSectionsResult =
  | ({ kind: "ok"; document: unknown } & SectionsProvenance)
  | ({ kind: SectionFailure; detail: string; section: string } & SectionsProvenance);

/** sha256 over the ordered `name:hash` lines — section order is part of what was read. */
export function combinedSchemaHash(sectionHashes: readonly (readonly [string, string])[]): string {
  return createHash("sha256").update(sectionHashes.map(([n, h]) => `${n}:${h}`).join("\n")).digest("hex");
}

function sumUsage(all: readonly ReadUsage[]): ReadUsage {
  const sum = (pick: (u: ReadUsage) => number | null) =>
    all.some((u) => pick(u) == null) ? null : all.reduce((t, u) => t + (pick(u) ?? 0), 0);
  return {
    input: all.reduce((t, u) => t + u.input, 0),
    output: all.reduce((t, u) => t + u.output, 0),
    cacheRead: sum((u) => u.cacheRead),
    cacheWrite: sum((u) => u.cacheWrite),
  };
}

export async function readSections(input: ReadPagesInput, client: ModelClient): Promise<ReadSectionsResult> {
  if (input.pages.length === 0) throw new Error("readSections needs at least one page");
  const profile = DOCUMENT_PROFILES[input.profile];
  const sections = profile.sections.map((s) => ({ name: s.name, schema: sectionSchema(profile, s.name) }));
  const results = await Promise.all(sections.map((s) => readWithSchema(input, s.schema, client)));

  const outcomes: SectionOutcome[] = results.map((r, i) => ({
    name: sections[i]!.name,
    kind: r.kind,
    detail: r.kind === "ok" ? null : r.detail,
    schemaHash: r.schemaHash,
    usage: r.usage,
    model: r.model,
    stopReason: r.stopReason,
  }));
  const pairs = outcomes.map((o) => [o.name, o.schemaHash] as const);
  const base: Omit<SectionsProvenance, "stopReason"> = {
    usage: sumUsage(outcomes.map((o) => o.usage)),
    model: [...new Set(outcomes.map((o) => o.model))].join(","),
    promptVersion: input.prompt.version,
    schemaHash: combinedSchemaHash(pairs),
    sectionHashes: Object.fromEntries(pairs),
    sections: outcomes,
  };

  for (const kind of FAILURE_PRECEDENCE) {
    const failed = outcomes.find((o) => o.kind === kind);
    if (failed) return { kind, section: failed.name, detail: `section ${failed.name}: ${failed.detail}`, ...base, stopReason: failed.stopReason };
  }
  const parts = Object.fromEntries(results.map((r, i) => [sections[i]!.name, r.kind === "ok" ? r.document : null]));
  return { kind: "ok", document: mergeSections(profile, parts), ...base, stopReason: "end_turn" };
}

/** Each section's wire schema in profile order — what the gate test and the live check measure. */
export function sectionWireSchemas(profileId: ReadPagesInput["profile"]) {
  const profile = DOCUMENT_PROFILES[profileId];
  return profile.sections.map((s) => {
    const wire = wireSchemaFor(sectionSchema(profile, s.name));
    return { name: s.name, wire, hash: schemaHash(wire) };
  });
}
