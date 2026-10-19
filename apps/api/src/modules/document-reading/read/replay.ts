import { isDeepStrictEqual } from "node:util";
import { fieldEvidenceSchema, type DocumentProfileId, type FieldEvidence, type PaperAuditView } from "@silvicom/shared";
import { EVIDENCE_FOR, type OcrPage } from "../evidence/index.js";
import { auditForRead } from "../evidence/paperAudit.js";
import { ACCEPTANCE_RULE_VERSION } from "./cacheKey.js";

/**
 * A stored read judged again by today's code (READER-CORRECTNESS-PLAN RC2, D-RC2). The models are not asked:
 * a read keeps pass A's document (`result`) and, since 0487's writer, what every other witness was handed —
 * pass B's document, the OCR words, the text-layer words (`replay_inputs`). Everything downstream of the
 * models is code, so it is run again over exactly those inputs: the line pairing, the table, the row and
 * arithmetic witnesses, the acceptance rule, and the paper audit. What changed between the stored judgement
 * and today's is the diff a reader PR must show (D-RC2), and the false-accepts it may not add (D-RC3).
 *
 * The audit is not stored: `requests.ts` runs it over the stored evidence each time the read is opened, with
 * the code of the day. So "before" here is today's audit over the STORED evidence and "after" today's audit
 * over today's — the findings that move because the evidence moved. A finding that moved because a rule
 * changed already moved on every stored read the moment that rule shipped.
 *
 * A read finished before 0487's writer has no replay inputs: it cannot be judged again, and says so
 * (`replayable: false`) rather than being re-judged with pass B missing, which would make every field
 * one reader's word and every diff a false alarm.
 */
export interface StoredRead {
  id: string;
  profile: DocumentProfileId;
  result: unknown;
  evidence: unknown;
  replay_inputs: unknown;
}

interface ReplayInputs { passB: unknown | null; ocr: OcrPage[] | null; textLayer: OcrPage[] | null }

export interface FieldChange {
  path: string;
  /** What the stored judgement said, and today's — `null` where the path is absent on that side. */
  before: { status: string; value: unknown } | null;
  after: { status: string; value: unknown } | null;
}

export interface AuditChange {
  ruleId: string;
  lineIndex: number | null;
  before: { outcome: string; reason: string } | null;
  after: { outcome: string; reason: string } | null;
}

export type ReplayResult =
  | { id: string; replayable: false; why: string }
  | {
      id: string;
      replayable: true;
      evidence: FieldEvidence[];
      audit: PaperAuditView | null;
      /** Fields whose status, value or witnesses differ — the whole field shown, so the cause is visible. */
      fields: FieldChange[];
      /** Audit findings that appeared, went, or changed outcome or reason. */
      findings: AuditChange[];
      /** Whether the stored read was judged under another acceptance rule than today's. */
      ruleChanged: boolean;
    };

function inputsOf(raw: unknown): ReplayInputs | null {
  if (raw == null || typeof raw !== "object") return null;
  const r = raw as Partial<ReplayInputs>;
  return { passB: r.passB ?? null, ocr: r.ocr ?? null, textLayer: r.textLayer ?? null };
}

const keyOf = (r: { ruleId: string; lineIndex: number | null }) => `${r.ruleId}@${r.lineIndex ?? "-"}`;

/** Pure: no database, no clock, no model. */
export function replayRead(read: StoredRead): ReplayResult {
  const inputs = inputsOf(read.replay_inputs);
  if (!inputs) return { id: read.id, replayable: false, why: "finished before replay inputs were stored (0487), or a cache hit" };
  const stored = fieldEvidenceSchema.array().safeParse(read.evidence ?? []);
  if (!stored.success) return { id: read.id, replayable: false, why: "its stored evidence does not parse" };

  const evidence = EVIDENCE_FOR[read.profile](read.result, inputs.passB, ACCEPTANCE_RULE_VERSION, inputs.ocr, inputs.textLayer);
  const audit = read.profile === "shipping_document" ? auditForRead(read.result, evidence) : null;
  const storedAudit = read.profile === "shipping_document" ? auditForRead(read.result, stored.data) : null;

  const before = new Map(stored.data.map((e) => [e.path, e]));
  const after = new Map(evidence.map((e) => [e.path, e]));
  const fields: FieldChange[] = [];
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(path);
    const a = after.get(path);
    // The rule version differs on every field after a rule bump; it is reported once, not as a change.
    const same = b && a && b.status === a.status && isDeepStrictEqual(b.value, a.value) && isDeepStrictEqual(b.sources, a.sources);
    if (!same) fields.push({ path, before: b ? { status: b.status, value: b.value } : null, after: a ? { status: a.status, value: a.value } : null });
  }

  const auditBefore = new Map((storedAudit?.results ?? []).map((r) => [keyOf(r), r]));
  const auditAfter = new Map((audit?.results ?? []).map((r) => [keyOf(r), r]));
  const findings: AuditChange[] = [];
  for (const k of new Set([...auditBefore.keys(), ...auditAfter.keys()])) {
    const b = auditBefore.get(k);
    const a = auditAfter.get(k);
    if (b && a && b.outcome === a.outcome && b.reason === a.reason) continue;
    const any = (a ?? b)!;
    findings.push({
      ruleId: any.ruleId, lineIndex: any.lineIndex,
      before: b ? { outcome: b.outcome, reason: b.reason } : null,
      after: a ? { outcome: a.outcome, reason: a.reason } : null,
    });
  }

  return {
    id: read.id, replayable: true, evidence, audit, fields, findings,
    ruleChanged: stored.data.some((e) => e.ruleVersion !== ACCEPTANCE_RULE_VERSION),
  };
}
