/**
 * One Samsara driver document, read into the row the `samsara` collector stages
 * (DOCUMENT-READER-PLAN Step 0.1, migration 0445).
 *
 * The shape is Samsara's `GET /fleet/documents` item as measured on this carrier's account
 * 2026-10-08: `{id, createdAtTime, updatedAtTime, state, documentType{id,name}, driver{id,name},
 * vehicle{id,name,externalIds}, route{id}, routeStop{id,name}, fields[{label, type, value}]}`, where a
 * photo field's value is `{photoValue: [{id, url}]}`, a text field's `{stringValue}`, and an unfilled
 * field's `{}`. `state` was `required` (assigned, not yet submitted) on 29 of 32 and `submitted` on 3.
 *
 * ── THREE RULES, EACH ONE A WAY THIS COULD QUIETLY GO WRONG ─────────────────────────────────────
 * 1. **A photo's url is dropped, its id kept.** The url is a vendor link on s3.samsara.com with its own
 *    expiry; storing it would be storing a promise (plan D-DR9). Intake re-fetches the document for a
 *    fresh url and copies the bytes into our bucket.
 * 2. **A malformed item is refused, never half-read.** No id, no type name or an unparseable time
 *    returns null and the collector counts it. A row with an invented `created_at` would sort as the
 *    newest BOL in the dispatcher's picker; a row with no id cannot be refreshed in place.
 * 3. **"Load #" is read by label, exactly.** The call forms carry a field labelled `Load #`; the BOL
 *    type does not (plan Q-DR3). Matching looser ("load", "load number") would pick up "Can I make it
 *    to the next stop" style labels a carrier edits at will. Whitespace is trimmed; an empty value is
 *    null.
 *
 * Pure: no clock, no I/O.
 */

export interface SamsaraDocumentField {
  label: string;
  type: string;
  /** Text and choice values as Samsara sent them; null for photo fields and empty values. */
  value: unknown;
  /** Photo ids, for photo fields only. */
  photoIds?: string[];
}

export interface SamsaraDocumentRow {
  samsara_document_id: string;
  document_type_id: string | null;
  document_type_name: string;
  state: string | null;
  samsara_driver_id: string | null;
  driver_name: string | null;
  samsara_vehicle_id: string | null;
  vehicle_name: string | null;
  route_stop_id: string | null;
  route_stop_name: string | null;
  load_ref: string | null;
  photo_ids: string[];
  photo_count: number;
  fields: SamsaraDocumentField[];
  samsara_created_at: string;
  samsara_updated_at: string;
}

/** The label Samsara's call forms use for the McLeod order number. Matched exactly, after trimming. */
export const SAMSARA_LOAD_REF_LABEL = "Load #";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const iso = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
};

function photoIdsOf(value: Obj | null): string[] {
  const photos = value?.photoValue;
  if (!Array.isArray(photos)) return [];
  return photos.map((p) => str(obj(p)?.id)).filter((id): id is string => id !== null);
}

/** The field's scalar value, whatever key Samsara put it under; photo fields have none. */
function scalarOf(type: string, value: Obj | null): unknown {
  if (type === "photo" || !value) return null;
  const keys = Object.keys(value);
  // Measured 2026-10-08: 151 of 187 non-photo fields arrived as `{}` — a form the driver has not
  // filled yet (`state: "required"`). Empty is null, never an object that reads as an answer.
  if (keys.length === 0) return null;
  return keys.length === 1 ? value[keys[0]!] : value;
}

export function parseSamsaraDocument(raw: unknown): SamsaraDocumentRow | null {
  const d = obj(raw);
  if (!d) return null;
  const id = str(d.id);
  const type = obj(d.documentType);
  const typeName = str(type?.name);
  const created = iso(d.createdAtTime);
  const updated = iso(d.updatedAtTime) ?? created;
  if (!id || !typeName || !created || !updated) return null;

  const fields: SamsaraDocumentField[] = [];
  const photoIds: string[] = [];
  let loadRef: string | null = null;
  for (const f of Array.isArray(d.fields) ? d.fields : []) {
    const field = obj(f);
    if (!field) continue;
    const label = typeof field.label === "string" ? field.label : "";
    const fieldType = typeof field.type === "string" ? field.type : "";
    const value = obj(field.value);
    if (fieldType === "photo") {
      const ids = photoIdsOf(value);
      photoIds.push(...ids);
      fields.push({ label, type: fieldType, value: null, photoIds: ids });
      continue;
    }
    const scalar = scalarOf(fieldType, value);
    fields.push({ label, type: fieldType, value: scalar });
    if (label.trim() === SAMSARA_LOAD_REF_LABEL && typeof scalar === "string" && scalar.trim() !== "") {
      loadRef = scalar.trim();
    }
  }

  const driver = obj(d.driver);
  const vehicle = obj(d.vehicle);
  const stop = obj(d.routeStop);
  return {
    samsara_document_id: id,
    document_type_id: str(type?.id),
    document_type_name: typeName,
    state: str(d.state),
    samsara_driver_id: str(driver?.id),
    driver_name: str(driver?.name),
    samsara_vehicle_id: str(vehicle?.id),
    vehicle_name: str(vehicle?.name),
    route_stop_id: str(stop?.id),
    route_stop_name: str(stop?.name),
    load_ref: loadRef,
    photo_ids: photoIds,
    photo_count: photoIds.length,
    fields,
    samsara_created_at: created,
    samsara_updated_at: updated,
  };
}
