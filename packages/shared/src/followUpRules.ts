/**
 * The warning desk's rule catalogue (docs/plans/maintenance/WARNING-DESK-PLAN.md D-WD10–D-WD12).
 *
 * ── THE ONE PLACE A DEFAULT IS DECIDED ───────────────────────────────────────────────────────────
 * A rule says which Samsara warnings count, how many times a problem must repeat before a person
 * follows it up (the "Nth time"), over how many days, and where the line sorts. The database stores
 * only an admin's override (`follow_up_rules`, 0653); every default is computed here — the fixed
 * kinds below, and one kind per Samsara alert configuration whose default is DERIVED from its trigger
 * type ids. A configuration added in Samsara tomorrow therefore arrives with a sensible default and
 * nothing to code; a copied list of configuration ids would be a second source of truth.
 *
 * ── WHERE EVERY NUMBER COMES FROM ────────────────────────────────────────────────────────────────
 * Each default was run against the live account's last 30 days (plan §1.6): together they open ≈ 22
 * follow-ups per working day — one person's list, with room. The trigger ids are Samsara's
 * (GET /alerts/configurations; developers.samsara.com/reference/getconfigurations).
 *
 * Pure: no clock, no I/O.
 */

export const FOLLOW_UP_CATEGORIES = ["maintenance", "safety", "compliance", "route"] as const;
export type FollowUpCategory = (typeof FOLLOW_UP_CATEGORIES)[number];

export const FOLLOW_UP_SEVERITIES = ["urgent", "high", "normal"] as const;
export type FollowUpSeverity = (typeof FOLLOW_UP_SEVERITIES)[number];

export const WARNING_SOURCES = ["alert", "safety", "dvir", "atis", "lamp", "hos"] as const;
export type WarningSource = (typeof WARNING_SOURCES)[number];

export const WARNING_SUBJECTS = ["truck", "trailer", "driver"] as const;
export type WarningSubject = (typeof WARNING_SUBJECTS)[number];

export interface FollowUpRule {
  key: string;
  label: string;
  source: WarningSource;
  subject: WarningSubject;
  enabled: boolean;
  /** Open a follow-up at this many warnings… */
  thresholdCount: number;
  /** …inside this many days. */
  windowDays: number;
  /**
   * For a warning that is a STATE rather than an event (an open defect, an engine lamp): it counts
   * only once it has been active this long. 0 = counts as soon as it happens.
   */
  minActiveHours: number;
  /** An episode shorter than this is not a warning at all (the ATIS lamp's own 10-minute definition). */
  minDurationMinutes: number;
  category: FollowUpCategory;
  severity: FollowUpSeverity;
}

/** The fixed kinds — the sources that are not Samsara alert configurations. */
export const FIXED_RULES: readonly FollowUpRule[] = [
  // Trailer tire losing air: 20 follow-ups / 30 days at 3 in 7 (§1.2). Samsara: lamp on > 10 min.
  { key: "atis", label: "Trailer tire losing air (ATIS lamp)", source: "atis", subject: "trailer", enabled: true,
    thresholdCount: 3, windowDays: 7, minActiveHours: 0, minDurationMinutes: 10, category: "maintenance", severity: "normal" },
  { key: "safety_serious", label: "Serious driving event", source: "safety", subject: "driver", enabled: true,
    thresholdCount: 1, windowDays: 1, minActiveHours: 0, minDurationMinutes: 0, category: "safety", severity: "high" },
  { key: "safety_other", label: "Repeated driving events", source: "safety", subject: "driver", enabled: true,
    thresholdCount: 3, windowDays: 7, minActiveHours: 0, minDurationMinutes: 0, category: "safety", severity: "normal" },
  { key: "hos_driving", label: "Hours of service — driving limit broken", source: "hos", subject: "driver", enabled: true,
    thresholdCount: 1, windowDays: 1, minActiveHours: 0, minDurationMinutes: 0, category: "compliance", severity: "high" },
  { key: "hos_unsubmitted", label: "Hours of service — logs not submitted", source: "hos", subject: "driver", enabled: true,
    thresholdCount: 3, windowDays: 7, minActiveHours: 0, minDurationMinutes: 0, category: "compliance", severity: "normal" },
  // 44 of 46 open defects were older than 3 days on 2026-11-26 — "reported and never fixed".
  { key: "dvir_open", label: "Defect reported and not fixed", source: "dvir", subject: "truck", enabled: true,
    thresholdCount: 1, windowDays: 30, minActiveHours: 48, minDurationMinutes: 0, category: "maintenance", severity: "normal" },
  { key: "lamp_stop", label: "Red STOP lamp on", source: "lamp", subject: "truck", enabled: true,
    thresholdCount: 1, windowDays: 30, minActiveHours: 0, minDurationMinutes: 0, category: "maintenance", severity: "urgent" },
  { key: "lamp_amber", label: "Check-engine lamp on for days", source: "lamp", subject: "truck", enabled: true,
    thresholdCount: 1, windowDays: 30, minActiveHours: 72, minDurationMinutes: 0, category: "maintenance", severity: "normal" },
];

/**
 * Safety behaviours serious enough to follow up the FIRST time (D-WD11). Everything else counts
 * toward `safety_other`. Names are Samsara's `behaviorLabels[].label`.
 */
export const SERIOUS_SAFETY_BEHAVIOURS: ReadonlySet<string> = new Set([
  "Crash", "RanRedLight", "ForwardCollisionWarning", "SevereSpeeding", "Drowsy", "MobileUsage",
  "NoSeatbelt", "ObstructedCamera", "DidNotYield",
]);

/** HOS violation types that are a broken driving limit (`hos_driving`); `unsubmittedLogs` is its own. */
export const HOS_DRIVING_TYPES: ReadonlySet<string> = new Set([
  "shiftDrivingHours", "shiftHours", "cycleHoursOn", "restbreakMissed",
]);

/** Severity order for sorting and for raising a line (never lowering it). */
export const FOLLOW_UP_SEVERITY_RANK: Record<FollowUpSeverity, number> = { urgent: 0, high: 1, normal: 2 };

export function higherSeverity(a: FollowUpSeverity, b: FollowUpSeverity): FollowUpSeverity {
  return FOLLOW_UP_SEVERITY_RANK[a] <= FOLLOW_UP_SEVERITY_RANK[b] ? a : b;
}

/** A Samsara alert configuration as the rule card needs it. */
export interface AlertConfigurationSummary {
  id: string;
  name: string;
  isEnabled: boolean;
  triggerTypeIds: number[];
}

/**
 * Trigger ids whose alerts are OFF by default, each with the reason (plan §1.6):
 * 1019 idling (owner ruling — the idle module's), 1003 temperature (reefer, 0 incidents), 5016
 * towing-zone geofence (real-time, already pushed to the driver and the role), 5033/5039/1023 safety
 * behaviours (read directly as safety events — counting the alert too would double them), 5005 DVIR
 * submitted (read directly as defects), 1013/1021/1022 engine on/off and movement on their own.
 */
const OFF_BY_DEFAULT = new Set([1019, 1003, 5016, 5017, 5033, 5039, 1023, 5005, 1013, 1021, 1022]);
/** Trigger ids that are about the driver rather than the truck: speed (1000, 5022), low fuel (1005). */
const DRIVER_TRIGGERS = new Set([1000, 5022, 1005]);
/** Out of route (1027) is the dispatch-shared category (D-WD13). */
const ROUTE_TRIGGERS = new Set([1027]);
const SAFETY_TRIGGERS = new Set([1000, 5022]);
/** Panic button (1034) is urgent the first time; a disconnected dashcam (1012/1046/1045) once. */
const URGENT_ONCE = new Set([1034]);
const ONCE = new Set([1034, 1012, 1046, 1045]);

export function alertRuleKey(configurationId: string): string {
  return `alert:${configurationId}`;
}

/**
 * The derived default for one Samsara alert configuration. A configuration Samsara reports as
 * disabled is off here too — there is nothing to collect.
 */
export function alertRuleDefault(config: AlertConfigurationSummary): FollowUpRule {
  const ids = config.triggerTypeIds;
  const any = (set: Set<number>) => ids.some((id) => set.has(id));
  const once = any(ONCE);
  return {
    key: alertRuleKey(config.id),
    label: config.name,
    source: "alert",
    subject: any(DRIVER_TRIGGERS) ? "driver" : "truck",
    // On when at least one trigger is one the desk counts: "battery below 12 V AND engine off" is a
    // battery alert, even though engine-off on its own is not worth a call.
    enabled: config.isEnabled && ids.some((id) => !OFF_BY_DEFAULT.has(id)),
    thresholdCount: once ? 1 : 3,
    windowDays: 7,
    minActiveHours: 0,
    minDurationMinutes: 0,
    category: any(ROUTE_TRIGGERS) ? "route" : any(SAFETY_TRIGGERS) ? "safety" : "maintenance",
    severity: any(URGENT_ONCE) ? "urgent" : "normal",
  };
}

/** An admin's stored override, as `follow_up_rules` holds it. */
export interface FollowUpRuleOverride {
  ruleKey: string;
  enabled: boolean;
  thresholdCount: number;
  windowDays: number;
  minActiveHours: number;
  category: FollowUpCategory;
  severity: FollowUpSeverity;
}

/**
 * Every rule in force for an org: the fixed kinds plus one per alert configuration, each with the
 * admin's override applied where there is one. An override for a configuration Samsara no longer
 * lists is dropped — there is nothing left for it to count.
 */
export function resolveFollowUpRules(
  configs: readonly AlertConfigurationSummary[],
  overrides: readonly FollowUpRuleOverride[],
): FollowUpRule[] {
  const byKey = new Map(overrides.map((o) => [o.ruleKey, o]));
  const defaults = [...FIXED_RULES, ...configs.map(alertRuleDefault)];
  return defaults.map((rule) => {
    const o = byKey.get(rule.key);
    if (!o) return { ...rule };
    return {
      ...rule,
      enabled: o.enabled,
      thresholdCount: o.thresholdCount,
      windowDays: o.windowDays,
      minActiveHours: o.minActiveHours,
      category: o.category,
      severity: o.severity,
    };
  });
}

/** One warning as the evaluator reads it (a row of `samsara_warnings`, camel-cased). */
export interface DeskWarning {
  kind: string;
  subjectKind: WarningSubject;
  vehicleSamsaraId: string | null;
  trailerSamsaraId: string | null;
  driverSamsaraId: string | null;
  unitName: string | null;
  driverName: string | null;
  label: string;
  happenedAt: string;
  endedAt: string | null;
  stillActive: boolean;
}

/** The Samsara id a warning is ABOUT, for its rule's subject. null = it cannot be followed up. */
export function warningSubjectId(w: Pick<DeskWarning, "subjectKind" | "vehicleSamsaraId" | "trailerSamsaraId" | "driverSamsaraId">): string | null {
  if (w.subjectKind === "trailer") return w.trailerSamsaraId;
  if (w.subjectKind === "driver") return w.driverSamsaraId;
  return w.vehicleSamsaraId;
}

/** The display name of what a warning is about. */
export function warningSubjectName(w: Pick<DeskWarning, "subjectKind" | "unitName" | "driverName">): string | null {
  return w.subjectKind === "driver" ? w.driverName : w.unitName;
}

const HOUR = 3_600_000;
const MINUTE = 60_000;

/**
 * Does this warning count toward its rule at `nowMs`? An episode shorter than the rule's minimum is
 * not a warning; a state warning counts only once it has been active long enough.
 */
export function warningCounts(rule: FollowUpRule, w: Pick<DeskWarning, "happenedAt" | "endedAt" | "stillActive">, nowMs: number): boolean {
  const start = Date.parse(w.happenedAt);
  const end = w.stillActive || !w.endedAt ? nowMs : Date.parse(w.endedAt);
  if (rule.minDurationMinutes > 0 && end - start < rule.minDurationMinutes * MINUTE) return false;
  if (rule.minActiveHours > 0 && (!w.stillActive || nowMs - start < rule.minActiveHours * HOUR)) return false;
  return true;
}

export type FollowUpDecision =
  | { open: false }
  | { open: true; firstAt: string; lastAt: string; count: number; activeCount: number };

/**
 * Should a NEW follow-up open for one (rule, subject)? `warnings` are the subject's warnings of this
 * rule, `countFrom` the moment counting starts again (the last closed follow-up's close, or null).
 * Opens when, inside any window of `windowDays` ending at the newest counting warning, at least
 * `thresholdCount` counting warnings happened. Pure.
 */
export function decideOpen(
  rule: FollowUpRule,
  warnings: readonly DeskWarning[],
  countFrom: string | null,
  nowMs: number,
): FollowUpDecision {
  if (!rule.enabled) return { open: false };
  const fromMs = countFrom ? Date.parse(countFrom) : -Infinity;
  const counting = warnings
    .filter((w) => Date.parse(w.happenedAt) > fromMs && warningCounts(rule, w, nowMs))
    .sort((a, b) => Date.parse(a.happenedAt) - Date.parse(b.happenedAt));
  if (counting.length === 0) return { open: false };
  const newestWarning = counting[counting.length - 1];
  if (!newestWarning) return { open: false };
  const newest = Date.parse(newestWarning.happenedAt);
  // A state rule (defect, lamp) is judged on what is active NOW, however old; an event rule on the
  // window ending at its newest warning, which must itself be inside the window from now.
  const windowMs = rule.windowDays * 24 * HOUR;
  if (rule.minActiveHours === 0 && nowMs - newest > windowMs) return { open: false };
  const inWindow = counting.filter((w) => Date.parse(w.happenedAt) > newest - windowMs);
  const first = inWindow[0];
  if (!first || inWindow.length < rule.thresholdCount) return { open: false };
  return {
    open: true,
    firstAt: first.happenedAt,
    lastAt: newestWarning.happenedAt,
    count: inWindow.length,
    activeCount: inWindow.filter((w) => w.stillActive).length,
  };
}

/** Severity a line should carry given its warnings (D-WD12) — never lower than the rule's. */
export function warningSeverity(rule: FollowUpRule, warnings: readonly DeskWarning[], nowMs: number): FollowUpSeverity {
  let sev = rule.severity;
  for (const w of warnings) {
    if (w.kind.startsWith("safety") && w.label.split(", ").includes("Crash")) sev = higherSeverity(sev, "urgent");
    if (rule.key === "atis") {
      const end = w.stillActive || !w.endedAt ? nowMs : Date.parse(w.endedAt);
      if (end - Date.parse(w.happenedAt) >= 4 * HOUR) sev = higherSeverity(sev, "high");
    }
  }
  return sev;
}

/** "Looks fixed — confirm": nothing still active and a quiet day since the last warning (D-WD6). */
export function looksFixed(activeCount: number, lastAt: string, nowMs: number): boolean {
  return activeCount === 0 && nowMs - Date.parse(lastAt) >= 24 * HOUR;
}

/** "Warned again after the call": a warning newer than the last contact (D-WD6). */
export function warnedAfterContact(lastAt: string, contactedAt: string | null): boolean {
  return contactedAt !== null && Date.parse(lastAt) > Date.parse(contactedAt);
}
