import {
  AD_HOOK_FAMILIES, AD_HOOK_FAMILY_LABELS, AD_SCENE_FAMILIES, AD_SCENE_FAMILY_LABELS, PLAN_ANGLES_MIN, PLAN_FORMATS, PLAN_FORMAT_LABELS, adsPlanEditSchema, campaignPlanSchema,
  type AdsCampaignPlanView, type AdsPlanEdit, type CampaignPlan, type CampaignState, type EvidenceItem, type PlanAngle, type PlanConcept, type PlanEvidenceKind, type PlanFormat,
} from "@silvicom/shared";

/**
 * The plan review screen's rules (ADS-PLATFORM-V2-PLAN V2c), kept apart from the screen so they can be tested
 * without it. Nothing here decides whether a plan is allowed: the door does (`plan/planDoors.ts`). This file
 * words what the door said, and reads the contract for the lists and the limits instead of restating them.
 */

/** A plan exists from the moment it waits for review; before that there is nothing to ask the server for. */
const BEFORE_A_PLAN: ReadonlySet<CampaignState> = new Set<CampaignState>(["draft", "planning"]);
export const mayHavePlan = (s: CampaignState): boolean => !BEFORE_A_PLAN.has(s);
/** The door's own rule: a plan is edited and approved only while it waits for review. */
export const planIsOpen = (s: CampaignState): boolean => s === "plan_review";

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const hookLabel = (a: Pick<PlanAngle, "hook_family">): string => sentence(AD_HOOK_FAMILY_LABELS[a.hook_family]);
export const sceneLabel = (a: Pick<PlanAngle, "scene_family">): string => sentence(AD_SCENE_FAMILY_LABELS[a.scene_family]);
/**
 * A kind of ad as ONE choice: an ad is made from a preset, and a preset is a lead and a picture together, so
 * the editor offers the pairs the carrier can make and never a lead from one with a picture from another.
 */
export const conceptKey = (c: PlanConcept): string => `${c.hook_family}+${c.scene_family}`;
export const conceptLabel = (c: PlanConcept): string => `${hookLabel(c)}, picture: ${AD_SCENE_FAMILY_LABELS[c.scene_family]}`;
/** The kinds of ad on offer for one idea: what the carrier can make, and the idea's own kind even if it no longer can. */
export function conceptOptions(available: readonly PlanConcept[], current: PlanConcept): Array<{ value: string; label: string }> {
  const offered = available.some((c) => conceptKey(c) === conceptKey(current)) ? [...available] : [current, ...available];
  return offered.map((c) => ({ value: conceptKey(c), label: available.some((a) => conceptKey(a) === conceptKey(c)) ? conceptLabel(c) : `${conceptLabel(c)} (cannot be made now)` }));
}
/** Write a chosen kind onto an idea. A key that is no known pair changes nothing. */
export function setConcept(angle: PlanAngle, key: string): void {
  const [hook, scene] = key.split("+");
  const h = AD_HOOK_FAMILIES.find((x) => x === hook), s = AD_SCENE_FAMILIES.find((x) => x === scene);
  if (h && s) { angle.hook_family = h; angle.scene_family = s; }
}

/** A format in office words (the contract's own labels); one with no label yet is shown by its key. */
export const formatLabel = (f: PlanFormat): string => (PLAN_FORMAT_LABELS as Partial<Record<PlanFormat, string>>)[f] ?? f;
/**
 * Whether an idea's format is worth a line on the screen: only where there is something to tell apart. A
 * campaign that can be made in one format, with every idea in it, says nothing by repeating it on each idea.
 * An empty list is an API that does not answer `formats` yet (the web can deploy first): nothing is shown.
 */
export const showsFormat = (available: readonly PlanFormat[], a: Pick<PlanAngle, "format">): boolean =>
  available.length > 1 || (available.length === 1 && !available.includes(a.format));
/** The formats on offer for one idea: what this campaign can be made in, and the idea's own even if it no longer can. */
export function formatOptions(available: readonly PlanFormat[], current: PlanFormat): Array<{ value: string; label: string }> {
  const offered = available.includes(current) ? [...available] : [current, ...available];
  return offered.map((f) => ({ value: f, label: available.includes(f) ? formatLabel(f) : `${formatLabel(f)} (cannot be made for this campaign)` }));
}
/** Write a chosen format onto an idea. A key that is no format changes nothing. */
export function setFormat(angle: PlanAngle, key: string): void {
  const f = PLAN_FORMATS.find((x) => x === key);
  if (f) angle.format = f;
}

/** Where a fact came from, in office words. */
export const EVIDENCE_KIND_LABEL: Record<PlanEvidenceKind, string> = {
  job: "The job", our_result: "Our earlier ads", lead_outcome: "Our earlier applicants", benchmark: "Industry figure", swipe: "A saved ad", market: "The market",
};

/** The facts a part of the plan rests on, in the order it cites them. An id the pack does not hold is left out. */
export function factsFor(view: Pick<AdsCampaignPlanView, "evidence">, ids: readonly string[]): EvidenceItem[] {
  const byId = new Map(view.evidence.map((e) => [e.id, e]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

export const authorLine = (v: Pick<AdsCampaignPlanView, "author_kind" | "author_name" | "version">): string =>
  v.author_kind === "agent" ? `Version ${v.version}, written by the planning agent` : `Version ${v.version}, edited by ${v.author_name ?? "a person"}`;

/** A copy the form may change without touching what the screen shows. */
export const editablePlan = (p: CampaignPlan): CampaignPlan => ({
  audience: p.audience, audience_evidence: [...p.audience_evidence],
  angles: p.angles.map((a) => ({ ...a, evidence: [...a.evidence] })),
});

/** An angle may be removed only while more than the fewest a plan may hold remain. */
export const canRemoveAngle = (p: CampaignPlan): boolean => p.angles.length > PLAN_ANGLES_MIN;

/** What is sent: every text trimmed, on the version the person had open. Null when the contract would refuse it. */
export function editFrom(draft: CampaignPlan, basedOn: number): AdsPlanEdit | null {
  const parsed = adsPlanEditSchema.safeParse({ based_on_version: basedOn, plan: draft });
  return parsed.success ? parsed.data : null;
}

/** The contract's own objections to a draft, by field (`audience`, `angles.0.idea`): too short, too long. */
export function draftErrors(draft: CampaignPlan): Record<string, string> {
  const parsed = campaignPlanSchema.safeParse(draft);
  const out: Record<string, string> = {};
  if (parsed.success) return out;
  for (const issue of parsed.error.issues) {
    const key = issue.path.join(".");
    out[key] ??= issue.code === "too_big" ? "This is too long. Shorten it." : issue.code === "too_small" ? "Write a little more here." : "This cannot be saved as it is.";
  }
  return out;
}

/** `angle 2 idea` → "Idea 2, what the ad leads with"; `audience` → "Who the ads speak to". */
function whereWords(where: string): string {
  if (where === "audience") return "Who the ads speak to";
  const m = /^angle (\d+)(?: (idea|proof|why))?$/.exec(where);
  if (!m) return where;
  const part = m[2] === "idea" ? ", what the ad leads with" : m[2] === "proof" ? ", what makes it true" : m[2] === "why" ? ", why this idea" : "";
  return `Idea ${m[1]}${part}`;
}

const CLAIM: Record<string, string> = {
  money_not_in_brief: "names pay the opening does not offer", quantity_not_in_brief: "names a number the opening does not state",
  age_not_in_brief: "names an age the opening does not state", term_not_in_brief: "promises something the opening does not offer",
  unrecognised_number: "holds a number with nothing saying what it counts", forbidden_wording: "uses wording an employment ad may not use",
  foreign_unit: "uses a unit the opening does not use",
};

interface Finding { kind: string; where: string; id?: string; other?: string; format?: string; finding?: string; text?: string; message?: string }

/**
 * The door's refusal of an edit (422 `plan_refused`), one sentence per finding in office words. A finding of a
 * kind this screen does not know falls back to the door's own sentence, so a new rule is never shown as nothing.
 */
export function planRefusalLines(detail: unknown): string[] {
  const d = (detail ?? {}) as { findings?: unknown; off_schema?: unknown };
  const findings = (Array.isArray(d.findings) ? d.findings : []) as Finding[];
  const lines = findings.map((f) => {
    const where = whereWords(String(f.where ?? ""));
    switch (f.kind) {
      case "claim": return `${where} ${CLAIM[f.finding ?? ""] ?? "says something the opening does not support"}${f.text ? ` ("${f.text}")` : ""}.`;
      case "same_kind": return `${where} leads with the same thing and shows the same picture as ${whereWords(String(f.other ?? "")).toLowerCase()}. Change one of them.`;
      case "no_job_evidence": return `${where} rests on no fact of the job.`;
      case "unknown_evidence": return `${where} rests on a fact that is not in this plan's list.`;
      case "format_not_built": return `${where} is a ${f.format ? formatLabel(f.format as PlanFormat).toLowerCase() : "format"}, which cannot be made for this campaign. Choose another format.`;
      case "concept_not_available": return `${where} is a kind of ad with no enabled preset. Choose another kind, or enable its preset in Settings.`;
      default: return f.message ?? `${where} cannot be saved as it is.`;
    }
  });
  return lines.length > 0 ? lines : typeof d.off_schema === "string" ? ["The plan is incomplete. Fill every part of it."] : [];
}
