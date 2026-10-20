/**
 * One truck's or trailer's file (UNIT-FILES-PLAN D-UF1). PURE: the API rollup and the unit's page
 * read the same function, so the Vehicles list and the truck's own page cannot disagree.
 *
 * The engine (`fileEngine.ts`) dates and judges; this wrapper decides the three things that are
 * about a UNIT and no other subject:
 *
 *   - which items APPLY — by unit type (IFTA is a tractor's) and by ownership (a title for an owned
 *     unit, a lease for a leased one). Unknown ownership is its own answer (D-UF11), not "missing".
 *   - what EVIDENCE each item has — the unit's own current certification first, else a fleet paper
 *     filed on the organization (D-UF6), else, for a paper-only item, the scan itself.
 *   - what McLeod's typed date says when no paper exists — shown beside the item, never counted as
 *     evidence (D-UF3). A date with nothing behind it is what an auditor writes up.
 */
import {
  buildFile,
  fileAttention,
  fileDateState,
  fileGroups,
  type FileAttentionItem,
  type FileEvidence,
  type FileGroupSummary,
  type FileItem,
  type FileItemState,
  type FileSummary,
} from "./fileEngine.js";
import {
  EQUIPMENT_GROUPS,
  EQUIPMENT_GROUP_LABELS,
  EQUIPMENT_ITEMS,
  type EquipmentGroup,
  type EquipmentItemSpec,
  type OwnershipType,
  type UnitDateColumn,
  type UnitSubjectType,
} from "./equipmentFileCatalogue.js";

/** A current `certifications` row, narrowed to what the file reads. */
export interface UnitCertInput {
  kind: string;
  issuedAt: string | null;
  expiresAt: string | null;
  documentId: string | null;
}

/** A filed original `documents` row — the unit's own, or one a certification cites. */
export interface UnitDocumentInput {
  id: string;
  kind: string;
  /** When the paper says it was made, if the uploader said; else when it was filed. */
  datedAt: string;
}

export interface UnitFileInput {
  subjectType: UnitSubjectType;
  ownership: OwnershipType | null;
  today: string;
  /** The unit's own current certifications. */
  certs: readonly UnitCertInput[];
  /** The organization's current certifications of fleet-wide kinds (D-UF6). */
  fleetCerts: readonly UnitCertInput[];
  /** The unit's own originals, plus any original a certification above cites. */
  documents: readonly UnitDocumentInput[];
  /** McLeod's typed dates from the unit row (D-UF3). */
  unitDates: Partial<Record<UnitDateColumn, string | null>>;
  expiringWithinDays?: number;
}

export interface UnitFileItem extends FileItem<EquipmentItemSpec> {
  /**
   * McLeod's date for this fact when NO paper is on file (D-UF3): the item stays `missing`, and this
   * says what the typed date would mean. Null when a paper exists or McLeod has no date.
   */
  dateOnly: { goodUntil: string; state: FileItemState } | null;
  /** True when the evidence is the fleet's paper on the organization, not the unit's own. */
  fleetWide: boolean;
}

export interface UnitFileSummary extends FileSummary<EquipmentItemSpec> {
  items: UnitFileItem[];
  /** Items that would apply if the unit's ownership were known (D-UF11) — not counted either way. */
  ownershipUnknown: EquipmentItemSpec[];
}

/** Which catalogue items this unit is asked for, and which wait on its ownership. */
export function unitFileSpecs(subjectType: UnitSubjectType, ownership: OwnershipType | null): {
  specs: EquipmentItemSpec[];
  ownershipUnknown: EquipmentItemSpec[];
} {
  const forUnit = EQUIPMENT_ITEMS.filter((i) => i.subjects.includes(subjectType));
  if (ownership === null) {
    return { specs: forUnit.filter((i) => !i.ownership), ownershipUnknown: forUnit.filter((i) => i.ownership) };
  }
  return { specs: forUnit.filter((i) => !i.ownership || i.ownership.includes(ownership)), ownershipUnknown: [] };
}

function certEvidence(c: UnitCertInput): FileEvidence {
  return { expiresAt: c.expiresAt, issuedAt: c.issuedAt, occurredOn: null, coversUntil: null, documentId: c.documentId };
}

/**
 * The newest-expiring match among `certs` — two current rows can satisfy one item (a registration and
 * an IRP cab card are both "registration"), and the one that runs longest is the unit's standing.
 */
function bestCert(spec: EquipmentItemSpec, certs: readonly UnitCertInput[]): UnitCertInput | undefined {
  return certs
    .filter((c) => spec.evidenceKinds.includes(c.kind))
    .sort((a, b) => (b.expiresAt ?? "").localeCompare(a.expiresAt ?? ""))[0];
}

/** Build one unit's file. `today` is a parameter, so a file can be rendered "as at" an audit date. */
export function buildUnitFile(input: UnitFileInput): UnitFileSummary {
  const { specs, ownershipUnknown } = unitFileSpecs(input.subjectType, input.ownership);
  const fromFleet = new Set<string>();

  const evidenceFor = (spec: EquipmentItemSpec): FileEvidence | undefined => {
    if (spec.source === "document") {
      // The newest scan of the kind: a re-filed title replaces the old one in the file's eyes, and
      // both stay on file (documents are append-only).
      const doc = input.documents
        .filter((d) => spec.evidenceKinds.includes(d.kind))
        .sort((a, b) => b.datedAt.localeCompare(a.datedAt))[0];
      return doc ? { expiresAt: null, issuedAt: null, occurredOn: doc.datedAt, coversUntil: null, documentId: doc.id } : undefined;
    }
    const own = bestCert(spec, input.certs);
    if (own) return certEvidence(own);
    const fleet = spec.fleetWide ? bestCert(spec, input.fleetCerts) : undefined;
    if (fleet) {
      fromFleet.add(spec.key);
      return certEvidence(fleet);
    }
    return undefined;
  };

  const file = buildFile<EquipmentItemSpec>({
    today: input.today,
    expiringWithinDays: input.expiringWithinDays,
    specs,
    evidenceFor,
    documentIds: new Set(input.documents.map((d) => d.id)),
    // A fleet policy alone is not the unit's file having been started.
    nothingFiled: input.certs.length === 0 && input.documents.length === 0,
  });

  const items: UnitFileItem[] = file.items.map((item) => {
    const column = item.spec.unitDateColumn;
    const typed = column ? input.unitDates[column] ?? null : null;
    return {
      ...item,
      fleetWide: fromFleet.has(item.spec.key),
      dateOnly:
        item.state === "missing" && typed
          ? { goodUntil: typed.slice(0, 10), state: fileDateState(typed, input.today, input.expiringWithinDays) }
          : null,
    };
  });
  return { ...file, items, ownershipUnknown };
}

export type UnitAttentionItem = FileAttentionItem<EquipmentGroup>;
export type UnitGroupSummary = FileGroupSummary<EquipmentGroup>;

export function unitAttention(file: UnitFileSummary, today: string): UnitAttentionItem[] {
  return fileAttention<EquipmentItemSpec, EquipmentGroup>(file, today);
}

export function unitGroups(file: UnitFileSummary): UnitGroupSummary[] {
  return fileGroups<EquipmentItemSpec, EquipmentGroup>(file, EQUIPMENT_GROUPS, EQUIPMENT_GROUP_LABELS);
}
