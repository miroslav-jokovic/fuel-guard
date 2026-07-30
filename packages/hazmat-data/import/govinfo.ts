/**
 * GovInfo helper (Phase H1) — resolve + fetch the official CFR legal edition for a section.
 *
 * Turns "I need the official legal text of §172.101" into: the exact GovInfo package + granule, the
 * legal PDF (what the human transcriber reads — Source B input, D5 v5), the granule XML (for the
 * optional cross-check tripwire), and a provenance record (package/granule id, edition year,
 * dateIssued, lastModified, links) that is stamped onto the dataset for audit.
 *
 * Resolution DISCOVERS rather than assumes: CFR annual packages are `CFR-{year}-title{n}-vol{v}` and
 * section granules are `CFR-{year}-title{n}-vol{v}-sec{part}-{rest}`, but the *volume* that holds a
 * part and the newest *year* published both change. So `resolveCfrSectionGranule` probes (vol 2 first
 * — Part 172's historical home), and if the id-guess misses, falls back to LISTING a volume's
 * granules and matching the section by id/title. Either way it returns the ids it actually used.
 */

import {
  GovInfoClient,
  type GranuleSummary,
  type GovInfoDownload,
} from "./govinfoClient.js";
import { HMT_SECTION, PLACARD_TABLES_SECTION, SEGREGATION_SECTION } from "./ecfr.js";

export const CFR_COLLECTION = "CFR";
export const CFR_TITLE = 49;

/** The sections GovInfo backs for HazmatGuard — the same three eCFR feeds. */
export const GOVINFO_SECTIONS = {
  hmt: HMT_SECTION, // 172.101
  placardTables: PLACARD_TABLES_SECTION, // 172.504
  segregation: SEGREGATION_SECTION, // 177.848
} as const;

export interface ResolvedGranule {
  packageId: string;
  granuleId: string;
  editionYear: number;
  volume: number;
  section: string;
  summary: GranuleSummary;
  resolvedBy: "direct" | "listing";
}

/** The audit anchor recorded on the dataset — "which official edition did this row come from". */
export interface GovInfoProvenance {
  source: "govinfo";
  collectionCode: "CFR";
  cfrTitle: number;
  section: string;
  packageId: string;
  granuleId: string;
  editionYear: number;
  volume: number;
  dateIssued: string | null;
  lastModified: string | null;
  pdfLink: string | null;
  xmlLink: string | null;
  modsLink: string | null;
  detailsLink: string | null;
  resolvedBy: "direct" | "listing";
}

export interface ResolveOptions {
  title?: number;
  /** Pin a CFR edition year; default probes the current + prior years. */
  year?: number;
  /** Volume probe order. Default [2,1,3,…] because Part 172 lives in Title-49 volume 2. */
  volumeProbeOrder?: number[];
  /** How many years back to probe when `year` is not given. Default 3. */
  maxYearsBack?: number;
  /** Injectable clock for deterministic tests (ms since epoch). Default Date.now. */
  clock?: () => number;
}

const DEFAULT_VOLUME_ORDER = [2, 1, 3, 4, 5, 6, 7, 8, 9];

/** "172.101" → "sec172-101" (the GovInfo section-granule token). */
export function sectionGranuleToken(section: string): string {
  const parts = section.split(".");
  const part = parts[0] ?? section;
  const rest = parts.slice(1).join("-");
  return rest ? `sec${part}-${rest}` : `sec${part}`;
}

export function cfrPackageId(year: number, title: number, volume: number): string {
  return `CFR-${year}-title${title}-vol${volume}`;
}
export function cfrSectionGranuleId(year: number, title: number, volume: number, section: string): string {
  return `${cfrPackageId(year, title, volume)}-${sectionGranuleToken(section)}`;
}

function yearsToProbe(opts: ResolveOptions): number[] {
  if (opts.year) return [opts.year];
  const now = opts.clock ? opts.clock() : Date.now();
  const y = new Date(now).getUTCFullYear();
  const back = Math.max(1, opts.maxYearsBack ?? 3);
  return Array.from({ length: back }, (_v, i) => y - i);
}

/** Parse the `offsetMark` cursor out of a GovInfo `nextPage` URL. */
function offsetMarkOf(nextPage: string | null): string | null {
  if (!nextPage) return null;
  try {
    return new URL(nextPage).searchParams.get("offsetMark");
  } catch {
    return null;
  }
}

/**
 * Find a section's granule inside a KNOWN package by paging its granule list and matching on id/title.
 * The robust fallback when the direct id-guess misses (e.g. an unusual granule-id format).
 */
async function findSectionGranuleByListing(
  client: GovInfoClient,
  packageId: string,
  section: string,
  maxPages = 60,
): Promise<GranuleSummary | null> {
  const token = sectionGranuleToken(section); // sec172-101
  const dashed = token.replace(/^sec/, ""); // 172-101
  let offsetMark: string | null = "*";
  for (let page = 0; page < maxPages && offsetMark; page++) {
    const res = await client.getGranules(packageId, { pageSize: 100, offsetMark });
    for (const g of res.granules) {
      const idHit = g.granuleId.includes(token) || g.granuleId.includes(dashed);
      const titleHit = typeof g.title === "string" && g.title.includes(section);
      if (idHit || titleHit) {
        return client.getGranuleSummary(packageId, g.granuleId);
      }
    }
    offsetMark = offsetMarkOf(res.nextPage);
  }
  return null;
}

/**
 * Resolve the official CFR package + granule for a section. Fast path is one call (direct granule
 * probe, vol 2, newest year); the listing fallback only runs if the id-guess misses.
 */
export async function resolveCfrSectionGranule(
  client: GovInfoClient,
  section: string,
  opts: ResolveOptions = {},
): Promise<ResolvedGranule> {
  const title = opts.title ?? CFR_TITLE;
  const vols = opts.volumeProbeOrder ?? DEFAULT_VOLUME_ORDER;
  const years = yearsToProbe(opts);

  for (const year of years) {
    // Fast path: guess the granule id directly, vol by vol.
    for (const volume of vols) {
      const packageId = cfrPackageId(year, title, volume);
      const granuleId = cfrSectionGranuleId(year, title, volume, section);
      const summary = await client.tryGetGranuleSummary(packageId, granuleId);
      if (summary) {
        return { packageId, granuleId, editionYear: year, volume, section, summary, resolvedBy: "direct" };
      }
    }
    // Fallback: for any volume package that exists this year, list + match.
    for (const volume of vols) {
      const packageId = cfrPackageId(year, title, volume);
      const pkg = await client.tryGetPackageSummary(packageId);
      if (!pkg) continue;
      const summary = await findSectionGranuleByListing(client, packageId, section);
      if (summary) {
        return { packageId, granuleId: summary.granuleId, editionYear: year, volume, section, summary, resolvedBy: "listing" };
      }
    }
  }

  throw new Error(
    `Could not resolve CFR granule for §${section} in Title ${title} across years ${years.join(", ")}. ` +
      `Run import/govinfoSmoke.ts with a real GOVINFO_API_KEY to inspect the live package/granule ids, ` +
      `then pass { year, volumeProbeOrder } if the scheme has changed.`,
  );
}

function link(download: GovInfoDownload | undefined, key: keyof GovInfoDownload): string | null {
  return download?.[key] ?? null;
}

/** Build the audit provenance record from a resolved granule. Time is stamped by the caller. */
export function toProvenance(resolved: ResolvedGranule): GovInfoProvenance {
  const s = resolved.summary;
  return {
    source: "govinfo",
    collectionCode: "CFR",
    cfrTitle: titleFromPackageId(resolved.packageId),
    section: resolved.section,
    packageId: resolved.packageId,
    granuleId: resolved.granuleId,
    editionYear: resolved.editionYear,
    volume: resolved.volume,
    dateIssued: typeof s.dateIssued === "string" ? s.dateIssued : null,
    lastModified: typeof s.lastModified === "string" ? s.lastModified : null,
    pdfLink: link(s.download, "pdfLink"),
    xmlLink: link(s.download, "xmlLink"),
    modsLink: link(s.download, "modsLink"),
    detailsLink: typeof s.detailsLink === "string" ? s.detailsLink : null,
    resolvedBy: resolved.resolvedBy,
  };
}

/** The title is embedded in the package id (CFR-YYYY-titleNN-volV); parse it back for the record. */
function titleFromPackageId(packageId: string): number {
  const m = /title(\d+)/.exec(packageId);
  return m && m[1] ? Number(m[1]) : CFR_TITLE;
}

// ── content fetchers (the three roles) ─────────────────────────────────────────

/** The official legal PDF bytes — what the human transcriber reads (Source B input). */
export function fetchLegalPdfBytes(client: GovInfoClient, resolved: ResolvedGranule): Promise<Uint8Array> {
  return client.getGranuleContentBytes(resolved.packageId, resolved.granuleId, "pdf");
}

/** The granule XML — the independent rendering used by the optional cross-check tripwire. */
export function fetchGranuleXml(client: GovInfoClient, resolved: ResolvedGranule): Promise<string> {
  return client.getGranuleContent(resolved.packageId, resolved.granuleId, "xml");
}

/** The MODS metadata (structured bibliographic record) — extra provenance if needed. */
export function fetchGranuleMods(client: GovInfoClient, resolved: ResolvedGranule): Promise<string> {
  return client.getGranuleContent(resolved.packageId, resolved.granuleId, "mods");
}
