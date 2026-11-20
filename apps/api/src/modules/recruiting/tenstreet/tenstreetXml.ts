import { DOMParser, XMLSerializer, type Element as XmlElement } from "@xmldom/xmldom";
import type { TsNode } from "@silvicom/shared";

/**
 * A Tenstreet post's XML, made safe before anything keeps it (TENSTREET-INTAKE-PLAN TS2, D-TS10; ADS-PLATFORM-V2-PLAN
 * Q-APX29 (a), ruled 2026-11-20). The one place the post is read as XML; everything after reads `TsNode`s
 * (`leadFromTenstreet`, shared).
 *
 * ── HOSTILE INPUT (D-TS10) ───────────────────────────────────────────────────────────────────────
 * The body is refused when it is over `TENSTREET_MAX_BYTES`, carries a DOCTYPE (no entity expansion, no external
 * entity), is not well-formed, or its root is not `TenstreetData`. A refusal names a reason, never the body.
 *
 * ── REMOVED BEFORE ANYTHING IS KEPT (D-TS4, D-TS5) ──────────────────────────────────────────────
 * Every `GovernmentID` element (the SSN — in `PersonalData` and again in each `ProviderVerifiedData` record in the
 * samples) and every `EqualEmploymentOpportunityData` block (the EEO self-identification answers) is taken out of
 * the document, wherever it sits. `cleaned` is the document serialised AFTER the removal: it is what the receiver
 * seals into the one-year log, so the log never holds either. `removed` counts what was taken out, for the log row.
 * `EeoCategory` inside `JobRequisitionData` is the JOB's classification, not the person's, and stays.
 */

export const TENSTREET_MAX_BYTES = 2 * 1024 * 1024;
const REMOVE = new Set(["GovernmentID", "EqualEmploymentOpportunityData"]);

export type TenstreetXml =
  | { ok: true; root: TsNode; cleaned: string; removed: { government_id: number; eeo: number } }
  | { ok: false; reason: "too_large" | "doctype" | "not_xml" | "not_tenstreet" };

function elementsOf(e: XmlElement): XmlElement[] {
  const out: XmlElement[] = [];
  for (let i = 0; i < e.childNodes.length; i++) {
    const n = e.childNodes.item(i);
    if (n && n.nodeType === 1) out.push(n as XmlElement);
  }
  return out;
}

function strip(e: XmlElement, removed: { government_id: number; eeo: number }): void {
  for (const c of elementsOf(e)) {
    const name = c.localName ?? c.nodeName;
    if (REMOVE.has(name)) {
      e.removeChild(c);
      if (name === "GovernmentID") removed.government_id += 1;
      else removed.eeo += 1;
    } else strip(c, removed);
  }
}

function toNode(e: XmlElement): TsNode {
  const attrs: Record<string, string> = {};
  for (let i = 0; i < e.attributes.length; i++) {
    const a = e.attributes.item(i);
    if (a) attrs[a.localName ?? a.name] = a.value;
  }
  let text = "";
  for (let i = 0; i < e.childNodes.length; i++) {
    const n = e.childNodes.item(i);
    if (n && (n.nodeType === 3 || n.nodeType === 4)) text += n.nodeValue ?? "";
  }
  return { name: e.localName ?? e.nodeName, attrs, text, children: elementsOf(e).map(toNode) };
}

export function readTenstreetXml(body: string): TenstreetXml {
  if (Buffer.byteLength(body, "utf8") > TENSTREET_MAX_BYTES) return { ok: false, reason: "too_large" };
  if (/<!DOCTYPE/i.test(body) || /<!ENTITY/i.test(body)) return { ok: false, reason: "doctype" };
  let failed = false;
  let doc: ReturnType<DOMParser["parseFromString"]>;
  try {
    // xmldom 0.9 throws a ParseError on a fatal error and calls `onError` on the rest; either is "not XML".
    doc = new DOMParser({ onError: () => { failed = true; } }).parseFromString(body, "text/xml");
  } catch {
    return { ok: false, reason: "not_xml" };
  }
  const root = doc.documentElement;
  if (failed || !root) return { ok: false, reason: "not_xml" };
  if ((root.localName ?? root.nodeName) !== "TenstreetData") return { ok: false, reason: "not_tenstreet" };
  const removed = { government_id: 0, eeo: 0 };
  strip(root, removed);
  return { ok: true, root: toNode(root), cleaned: new XMLSerializer().serializeToString(doc), removed };
}
