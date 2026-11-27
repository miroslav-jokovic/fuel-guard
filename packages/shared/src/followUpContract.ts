import { z } from "zod";
import { recordId } from "./recordId.js";
import {
  FOLLOW_UP_CATEGORIES,
  FOLLOW_UP_SEVERITIES,
  FOLLOW_UP_SEVERITY_RANK,
  WARNING_SOURCES,
  WARNING_SUBJECTS,
  type FollowUpCategory,
} from "./followUpRules.js";

/**
 * The warning desk's wire (docs/plans/maintenance/WARNING-DESK-PLAN.md WD4/WD5): what
 * `/api/follow-ups` sends the Follow-ups page, the Route follow-ups page and the "Follow-up rules"
 * settings card, and what they send back. The rule catalogue and the derived states (`looksFixed`,
 * `warnedAfterContact`) are `followUpRules.ts`'s; this file only carries them.
 */

export const FOLLOW_UP_STATUSES = ["new", "called", "sent_to_shop", "closed"] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export const FOLLOW_UP_OUTCOMES = ["fixed", "not_a_problem"] as const;
export type FollowUpOutcome = (typeof FOLLOW_UP_OUTCOMES)[number];

/** Mirrors `follow_up_actions.action`'s CHECK (0653). `transition_follow_up` is the authority. */
export const FOLLOW_UP_ACTIONS = ["called", "no_answer", "sent_to_shop", "note", "assigned", "closed_fixed", "closed_not_a_problem"] as const;
export type FollowUpAction = (typeof FOLLOW_UP_ACTIONS)[number];

/** Actions that need a note (WD015): a note is its text; "not a problem" must say why (D-WD6). */
export const FOLLOW_UP_NOTE_REQUIRED: readonly FollowUpAction[] = ["note", "closed_not_a_problem"];

export const FOLLOW_UP_STATUS_LABELS: Record<FollowUpStatus, string> = {
  new: "New",
  called: "Driver called",
  sent_to_shop: "Sent to shop",
  closed: "Closed",
};

/** How the history reads each action — past tense, a person did it. */
export const FOLLOW_UP_ACTION_LABELS: Record<FollowUpAction, string> = {
  called: "Called the driver",
  no_answer: "Called — no answer",
  sent_to_shop: "Sent to the shop",
  note: "Note",
  assigned: "Took it",
  closed_fixed: "Closed — fixed",
  closed_not_a_problem: "Closed — not a problem",
};

export const FOLLOW_UP_CATEGORY_LABELS: Record<FollowUpCategory, string> = {
  maintenance: "Maintenance",
  safety: "Safety",
  compliance: "Compliance",
  route: "Route",
};

/**
 * Who the line says to call, and which record said so (D-WD15) — so a guess is never shown as a fact.
 * `samsara`: the driver Samsara named on the warning, or the driver Samsara has on the truck now.
 * `trailer_pairing`: the trailer's current truck (Samsara's pairing), then that truck's driver.
 */
export const FOLLOW_UP_DRIVER_SOURCES = ["samsara", "trailer_pairing"] as const;
export type FollowUpDriverSource = (typeof FOLLOW_UP_DRIVER_SOURCES)[number];
export const FOLLOW_UP_DRIVER_SOURCE_LABELS: Record<FollowUpDriverSource, string> = {
  samsara: "from Samsara",
  trailer_pairing: "trailer pairing",
};

const unitRef = z.object({ id: recordId().nullable(), number: z.string() });

export const followUpLineSchema = z.object({
  id: recordId(),
  ruleKey: z.string(),
  ruleLabel: z.string(),
  /** The rule's window, for "5 times in 3 days". */
  windowDays: z.number().int().positive(),
  category: z.enum(FOLLOW_UP_CATEGORIES),
  severity: z.enum(FOLLOW_UP_SEVERITIES),
  status: z.enum(FOLLOW_UP_STATUSES),
  outcome: z.enum(FOLLOW_UP_OUTCOMES).nullable(),
  subjectKind: z.enum(WARNING_SUBJECTS),
  /** Samsara's name for the unit or driver — shown when the roster does not know it. */
  subjectName: z.string().nullable(),
  /** False when Samsara names a unit or driver the roster has no row for ("not in roster"). */
  inRoster: z.boolean(),
  truck: unitRef.nullable(),
  trailer: unitRef.nullable(),
  driver: z
    .object({
      id: recordId().nullable(),
      name: z.string(),
      phone: z.string().nullable(),
      source: z.enum(FOLLOW_UP_DRIVER_SOURCES),
    })
    .nullable(),
  warningCount: z.number().int().nonnegative(),
  firstAt: z.string(),
  lastAt: z.string(),
  contactedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  mine: z.boolean(),
  /** Derived when the line is drawn (D-WD6), never stored. */
  looksFixed: z.boolean(),
  warnedAgain: z.boolean(),
  version: z.number().int().positive(),
});
export type FollowUpLine = z.infer<typeof followUpLineSchema>;

export const followUpListSchema = z.object({
  lines: z.array(followUpLineSchema),
  /** The categories this caller may see: all four, or Route alone for a dispatcher (D-WD13). */
  categories: z.array(z.enum(FOLLOW_UP_CATEGORIES)),
  /** Open lines per category, for the tab badges. */
  counts: z.record(z.enum(FOLLOW_UP_CATEGORIES), z.number().int().nonnegative()),
  /** The Closed filter shows at most this many, newest close first. */
  closedLimit: z.number().int().positive(),
});
export type FollowUpList = z.infer<typeof followUpListSchema>;

export const followUpWarningSchema = z.object({
  id: recordId(),
  source: z.enum(WARNING_SOURCES),
  label: z.string(),
  happenedAt: z.string(),
  endedAt: z.string().nullable(),
  stillActive: z.boolean(),
  unitName: z.string().nullable(),
  driverName: z.string().nullable(),
  samsaraUrl: z.string().nullable(),
  /** A safety event with video: the id the video endpoint takes. */
  videoEventId: z.string().nullable(),
  /** Samsara's coaching state for a safety event, read back as Samsara holds it (D-WD8). */
  coachingState: z.string().nullable(),
});
export type FollowUpWarning = z.infer<typeof followUpWarningSchema>;

export const followUpActionRowSchema = z.object({
  id: recordId(),
  action: z.enum(FOLLOW_UP_ACTIONS),
  note: z.string().nullable(),
  actorName: z.string(),
  at: z.string(),
});
export type FollowUpActionRow = z.infer<typeof followUpActionRowSchema>;

export const followUpDetailSchema = z.object({
  line: followUpLineSchema,
  /** The caller works this line's category (manage on the section behind its screen); else read-only. */
  canAct: z.boolean(),
  warnings: z.array(followUpWarningSchema),
  actions: z.array(followUpActionRowSchema),
});
export type FollowUpDetail = z.infer<typeof followUpDetailSchema>;

export const followUpActionRequestSchema = z
  .object({
    action: z.enum(FOLLOW_UP_ACTIONS),
    note: z.string().max(2000).nullish(),
    version: z.number().int().positive(),
  })
  .refine((b) => !FOLLOW_UP_NOTE_REQUIRED.includes(b.action) || (b.note ?? "").trim().length > 0, {
    message: "This needs a note.",
    path: ["note"],
  });
export type FollowUpActionRequest = z.infer<typeof followUpActionRequestSchema>;

/**
 * A safety event's video (D-WD7): a fresh signed link, fetched on the click and never stored (≈ 8 h
 * life), or — for a crash, whose video Samsara's Sensitive Assets setting blurs for API tokens — the
 * link to open it in Samsara instead.
 */
export const followUpVideoSchema = z.discriminatedUnion("restricted", [
  z.object({ restricted: z.literal(false), urls: z.array(z.object({ url: z.string(), input: z.string().nullable() })) }),
  z.object({ restricted: z.literal(true), samsaraUrl: z.string().nullable() }),
]);
export type FollowUpVideo = z.infer<typeof followUpVideoSchema>;

// ── rules (admin only, D-WD10) ──────────────────────────────────────────────────────────────────
const ruleSettings = {
  enabled: z.boolean(),
  thresholdCount: z.number().int().min(1).max(50),
  windowDays: z.number().int().min(1).max(30),
  minActiveHours: z.number().int().min(0).max(720),
  category: z.enum(FOLLOW_UP_CATEGORIES),
  severity: z.enum(FOLLOW_UP_SEVERITIES),
};
export const followUpRuleSaveSchema = z.object(ruleSettings);
export type FollowUpRuleSave = z.infer<typeof followUpRuleSaveSchema>;

export const followUpRuleViewSchema = z.object({
  key: z.string(),
  label: z.string(),
  source: z.enum(WARNING_SOURCES),
  subject: z.enum(WARNING_SUBJECTS),
  ...ruleSettings,
  /** True when an admin's override is stored; "Reset to default" removes it. */
  overridden: z.boolean(),
  defaults: z.object(ruleSettings),
  /** The Samsara alert configuration this rule counts, for `alert:<id>` rules. */
  samsara: z.object({ id: z.string(), name: z.string(), isEnabled: z.boolean() }).nullable(),
});
export type FollowUpRuleView = z.infer<typeof followUpRuleViewSchema>;

export const followUpRulesSchema = z.object({
  rules: z.array(followUpRuleViewSchema),
  /** Samsara could not be asked for its alert configurations (no token, or it failed): only the fixed kinds are listed. */
  samsaraUnavailable: z.boolean(),
});
export type FollowUpRules = z.infer<typeof followUpRulesSchema>;

// ── the list's order (D-WD12) ───────────────────────────────────────────────────────────────────
/**
 * Urgent → high → normal, then "warned again after the call", then the oldest problem first — the one
 * that has waited longest is the one to call about. Closed lines: newest close first. Pure.
 */
export function compareFollowUps(
  a: Pick<FollowUpLine, "severity" | "warnedAgain" | "firstAt" | "status" | "closedAt">,
  b: Pick<FollowUpLine, "severity" | "warnedAgain" | "firstAt" | "status" | "closedAt">,
): number {
  if (a.status === "closed" && b.status === "closed") return Date.parse(b.closedAt ?? "") - Date.parse(a.closedAt ?? "");
  const sev = FOLLOW_UP_SEVERITY_RANK[a.severity] - FOLLOW_UP_SEVERITY_RANK[b.severity];
  if (sev !== 0) return sev;
  if (a.warnedAgain !== b.warnedAgain) return a.warnedAgain ? -1 : 1;
  return Date.parse(a.firstAt) - Date.parse(b.firstAt);
}

/** "5 times in 3 days" — the days the warnings actually span, never more than the rule's window. */
export function followUpTimesLabel(count: number, firstAt: string, lastAt: string): string {
  const days = Math.max(1, Math.ceil((Date.parse(lastAt) - Date.parse(firstAt)) / 86_400_000));
  const times = count === 1 ? "once" : `${count} times`;
  return count === 1 ? times : `${times} in ${days} ${days === 1 ? "day" : "days"}`;
}
