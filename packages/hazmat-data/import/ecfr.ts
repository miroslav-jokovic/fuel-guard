/**
 * eCFR importer (Phase H1, deliverable 2) — orchestration over the fetch client.
 *
 * Official-sources-only (D5 v5). This module turns "I want dataset v1" into the concrete steps of
 * getting the raw regulatory XML from the eCFR versioner API and handing it to the parser. It owns:
 *   - point-in-time DATE resolution (which day's text to pin),
 *   - the CURRENCY poll used by RELEASING.md step 1 (has Title 49 changed since our last release?),
 *   - the raw-XML FETCH for the three sections the engine needs.
 *
 * It does NOT parse. Parsing §172.101 into `HmtEntry` rows is `parseHmt.ts`, a separate deliverable
 * that must be built against a captured real fixture (see `captureFixtures.ts`) — never a guessed
 * XML structure. `importFromEcfr()` wires the two together and, until the parser lands, fails loudly
 * with a message that says exactly what is missing.
 */

import { EcfrClient, type TitleSummary } from "./ecfrClient.js";
import { parseHmtSection } from "./parseHmt.js";
import type { HmtEntry } from "../src/schema.js";

/** Title 49 — Transportation. The HMR (49 CFR) lives in Subchapter C. */
export const HMT_TITLE = 49;
/** §172.101 — the Hazardous Materials Table itself. */
export const HMT_SECTION = "172.101";
/** §172.504 — the general placarding tables (Table 1 / Table 2 membership, §172.504(e)). */
export const PLACARD_TABLES_SECTION = "172.504";
/** §177.848 — the segregation grid, §177.848(d). */
export const SEGREGATION_SECTION = "177.848";

/** The resolved point-in-time context for one import run. */
export interface ImportContext {
  title: number;
  /** The date pinned for every `full/{date}` request this run — recorded on the dataset for audit. */
  date: string;
  summary: TitleSummary;
}

/**
 * Resolve WHICH day's text to import. Uses the title's `up_to_date_as_of` (the date its content is
 * current as of), falling back to `latest_issue_date`. Both come straight from titles.json, so the
 * date is always one the versioner can serve.
 */
export async function resolveImportContext(client: EcfrClient = new EcfrClient()): Promise<ImportContext> {
  const summary = await client.getTitleSummary(HMT_TITLE);
  const date = summary.up_to_date_as_of ?? summary.latest_issue_date;
  if (!date) {
    throw new Error(`Title ${HMT_TITLE} has neither up_to_date_as_of nor latest_issue_date — cannot pin a date.`);
  }
  return { title: HMT_TITLE, date, summary };
}

/** The result of a currency poll. */
export interface UpdateCheck {
  changed: boolean;
  latestAmendedOn: string | null;
  previous: string | null;
}

/**
 * RELEASING.md step 1: has Title 49 been amended since the date our last shipped dataset recorded?
 * Title-level and cheap — one titles.json call. `changed === false` means stop; nothing to do.
 */
export async function checkTitleForUpdate(
  knownAmendedOn: string | null,
  client: EcfrClient = new EcfrClient(),
): Promise<UpdateCheck> {
  const summary = await client.getTitleSummary(HMT_TITLE);
  return {
    changed: summary.latest_amended_on !== knownAmendedOn,
    latestAmendedOn: summary.latest_amended_on,
    previous: knownAmendedOn,
  };
}

/**
 * Precise, section-level currency: the newest amendment date for one section (e.g. "172.101").
 * Sharper than the title-level poll — lets a release re-verify ONLY the sections that actually moved
 * instead of re-transcribing the fuel set every time an unrelated part of Title 49 changes.
 */
export async function latestSectionAmendment(
  section: string,
  client: EcfrClient = new EcfrClient(),
): Promise<string | null> {
  const part = section.split(".")[0] ?? section;
  const { content_versions } = await client.getVersions(HMT_TITLE, { part });
  const dates = content_versions
    .filter((v) => v.identifier === section && !v.removed)
    .map((v) => v.amendment_date)
    .sort();
  return dates.at(-1) ?? null;
}

/** Fetch the raw §172.101 XML — the HMT table, the parser's input. */
export function fetchHmtXml(ctx: ImportContext, client: EcfrClient = new EcfrClient()): Promise<string> {
  return client.getFullXml(ctx.date, ctx.title, { section: HMT_SECTION });
}

/** Fetch the raw §172.504 XML — the placarding tables. */
export function fetchPlacardTablesXml(ctx: ImportContext, client: EcfrClient = new EcfrClient()): Promise<string> {
  return client.getFullXml(ctx.date, ctx.title, { section: PLACARD_TABLES_SECTION });
}

/** Fetch the raw §177.848 XML — the segregation grid. */
export function fetchSegregationXml(ctx: ImportContext, client: EcfrClient = new EcfrClient()): Promise<string> {
  return client.getFullXml(ctx.date, ctx.title, { section: SEGREGATION_SECTION });
}

/**
 * The top-level importer: resolve date → fetch §172.101 XML → parse into HmtEntry rows.
 *
 * Both halves are complete: the fetch client and `parseHmtSection` (built + frozen against a captured
 * §172.101 fixture). It rejects loudly on malformed/empty XML rather than returning wrong rows — the
 * fail-closed posture the module is built on (H1.6): no data ships except through the reviewed pipeline.
 */
export async function importHmtEntries(client: EcfrClient = new EcfrClient()): Promise<HmtEntry[]> {
  const ctx = await resolveImportContext(client);
  const xml = await fetchHmtXml(ctx, client);
  return parseHmtSection(xml);
}
