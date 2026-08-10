import { DOMParser, type Element as XmlElement, type Node as XmlNode } from "@xmldom/xmldom";

/**
 * XML primitives shared by every EFS SOAP operation: escaping, element walking, the envelope builder,
 * and the lossy element→value mapper the transaction feeds are built on.
 *
 * Deliberately knows nothing about EFS itself — no operation names, no field names, no faults. Fault
 * classification and session handling live in `efsSoapSession.ts`; the card document model lives in
 * `efsCardXml.ts`. This file is the only place that touches `@xmldom/xmldom` directly for the feeds.
 */

export type SoapValue = string | null | Record<string, unknown> | SoapValue[];

export function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** Element name without its namespace prefix. EFS responses are inconsistently prefixed, so nothing
 *  downstream may match on the raw `nodeName`. */
export function localName(node: XmlNode): string {
  return (node as XmlElement).localName ?? node.nodeName.split(":").pop() ?? node.nodeName;
}

export function childElements(element: XmlElement): XmlElement[] {
  const children: XmlElement[] = [];
  for (let i = 0; i < element.childNodes.length; i++) {
    const node = element.childNodes.item(i);
    if (node && node.nodeType === 1) children.push(node as XmlElement);
  }
  return children;
}

export function findDescendant(root: XmlElement, wanted: string): XmlElement | null {
  for (const child of childElements(root)) {
    if (localName(child) === wanted) return child;
    const nested = findDescendant(child, wanted);
    if (nested) return nested;
  }
  return null;
}

/** Every direct child with this local name — always an array, including length 0 and 1.
 *
 *  This is the counterpart to `elementToValue`'s collapsing behaviour and the correct tool whenever a
 *  repeated element is SEMANTIC rather than incidental. See the warning on `elementToValue`. */
export function collectElements(parent: XmlElement, name: string): XmlElement[] {
  return childElements(parent).filter((child) => localName(child) === name);
}

/**
 * XML → plain JS for the transaction feeds.
 *
 * ⚠ This collapses repeated elements into an array ONLY when there are two or more: one `<infos>`
 * record parses as a bare record, and zero means the key is absent entirely. That is harmless for the
 * feeds, which read named scalars out of the result and normalise through `asRecords`. It is NOT safe
 * for the card document, where an `<infos>` record IS a driver assignment and losing one deletes it —
 * so `efsCardXml.ts` uses `collectElements` and never calls this. Do not "fix" the shape here; the
 * feeds depend on it.
 */
export function elementToValue(element: XmlElement): SoapValue {
  if (element.getAttribute("xsi:nil") === "true" || element.getAttribute("nil") === "true") return null;
  const children = childElements(element);
  if (children.length === 0) return (element.textContent ?? "").trim() || null;
  const record: Record<string, unknown> = {};
  for (const child of children) {
    const key = localName(child);
    const value = elementToValue(child);
    const previous = record[key];
    record[key] = previous === undefined ? value : Array.isArray(previous) ? [...previous, value] : [previous, value];
  }
  return record;
}

export function asRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((v): v is Record<string, unknown> => !!v && typeof v === "object");
  return value && typeof value === "object" ? [value as Record<string, unknown>] : [];
}

export function textValue(value: unknown): string | null {
  if (value == null) return null;
  if (Array.isArray(value)) return textValue(value[0]);
  if (typeof value === "object") return null;
  const text = String(value).trim();
  return text || null;
}

/** Parse without interpreting: `null` when the input is not usable XML. SOAP Faults are well-formed
 *  XML and are therefore the CALLER's business — see `parseSoap` in efsSoapSession.ts. */
export function parseXml(xml: string): XmlElement | null {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (!doc.documentElement || findDescendant(doc.documentElement, "parsererror")) return null;
  return doc.documentElement;
}

export interface SoapEnvelopeInput {
  /** WS-Security UsernameToken if applicable — see buildWsSecurityUsernameTokenHeader. */
  wsSecurityHeader?: string;
  /** The inner operation XML — depends on WSDL. Pass as an already-serialized string. */
  operationBody: string;
  /** Optional additional headers (e.g. session tokens some servers require). */
  extraHeaders?: string[];
}

/** Build a well-formed SOAP 1.1 envelope. When we upgrade to 1.2 (unlikely for a legacy EFS
 *  webservice), swap the namespaces here. */
export function buildSoapEnvelope(input: SoapEnvelopeInput): string {
  const headerParts = [input.wsSecurityHeader, ...(input.extraHeaders ?? [])].filter(Boolean);
  const header =
    headerParts.length > 0 ? `<soap:Header>${headerParts.join("")}</soap:Header>` : "";
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
    header +
    `<soap:Body>${input.operationBody}</soap:Body>` +
    `</soap:Envelope>`
  );
}

export type { XmlElement, XmlNode };
