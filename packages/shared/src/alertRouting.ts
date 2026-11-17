import { z } from "zod";
import { EDITABLE_ROLES, effectiveSectionAccess, isEditableRole, resolveSectionAccess, rolesThatCanView, type AppSection, type SectionClaim, type SectionOverrides } from "./auth.js";
import type { UserRole } from "./constants.js";
import type { NotificationCategory } from "./notificationsContract.js";
import { alertTextQuietSchema } from "./alertTexts.js";
import { SURFACES } from "./surfaceCatalogue.js";
import { surfaceAllowed, type SurfaceClaim, type SurfaceOverrides } from "./surfaces.js";

/**
 * Alert routing — which alert goes to whom, by bell, email or text
 * (`docs/plans/notifications/NOTIFICATION-ROUTING-PLAN.md` D-NR1..D-NR3, built first for home time:
 * `docs/plans/dispatch-loads/HOME-TIME-PLAN.md` §3.6, D-HT14, D-HT15).
 *
 * ── ONE CATALOGUE, AND THE DEFAULTS LIVE IN IT ──────────────────────────────────────────────────
 * `ALERT_CATALOGUE` is the list of alerts an office can route. Each entry carries its DEFAULT routes,
 * and an alert with no saved row in `notification_routes` (0598) uses them — so a default is written
 * once, here, and an org that never opened the page is not frozen on the defaults of the day it was
 * created. The Settings page, the resolver and the senders all read this list.
 *
 * It starts with home time's three. The alerts that existed before (fuel, DQ, finance …) keep their
 * own audiences until the routing plan moves each one here (its NR3); adding one is an entry, not a
 * migration — `notification_routes.alert` is checked against this list by the API, not by a CHECK.
 *
 * ── WHO A ROUTE CAN NAME ────────────────────────────────────────────────────────────────────────
 * A role, a person, or a RELATION the sender works out per event: whoever marked the home time, or the
 * dispatcher who runs the truck's fleet. A relation resolves to one person or to nobody.
 *
 * Only people who can VIEW the alert's section receive it (Q-NR2, ruled 2026-11-13 for these alerts):
 * an alert is a request to act, and the link in it opens a page of that section.
 *
 * ── "CAN VIEW" IS THE CARRIER'S ANSWER, NOT THE SHIPPED MATRIX'S (Q-HT8, 2026-11-13) ────────────
 * A carrier changes who can open a section on the Permissions page, for a role and for one person.
 * Measured on production the day home time's alerts were finished: the Fleet Manager role had
 * Dispatch taken away, and the default routes escalated every overstay to exactly that role — an email
 * about a page its one holder could not open, and nobody else told. So every member here carries the
 * section claim their own token would (`AlertMember.sections`), and every question below is asked
 * with `resolveSectionAccess`, the function the API's gates ask.
 */

export const ALERT_CHANNELS = ["bell", "email", "sms"] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];
export const ALERT_CHANNEL_LABELS: Record<AlertChannel, string> = { bell: "Dashboard", email: "Email", sms: "Text" };

export const ALERT_RELATIONS = ["marked_by", "truck_dispatcher", "order_dispatcher"] as const;
export type AlertRelation = (typeof ALERT_RELATIONS)[number];
export const ALERT_RELATION_LABELS: Record<AlertRelation, string> = {
  marked_by: "Whoever marked the home time",
  truck_dispatcher: "The truck's dispatcher",
  // LUMPER-REVISED-RC-PLAN Q-LRC5 (ruled 2026-11-13): the McLeod order's `operations_user`, through the
  // office's link from that McLeod login to a 360 account (`tms_dispatchers.user_id`).
  order_dispatcher: "The order's dispatcher",
};

/** The three ways `notification_routes.recipient_kind` names a recipient (0598's CHECK). */
export const ALERT_RECIPIENT_KINDS = ["role", "user", "relation"] as const;
export type AlertRecipientKind = (typeof ALERT_RECIPIENT_KINDS)[number];

/** One switch: this recipient, this channel, on or off. A `user` row that is off removes a person their role would include. */
export const alertRouteSchema = z.object({
  recipientKind: z.enum(ALERT_RECIPIENT_KINDS),
  recipientKey: z.string().min(1).max(80),
  channel: z.enum(ALERT_CHANNELS),
  enabled: z.boolean(),
});
export type AlertRoute = z.infer<typeof alertRouteSchema>;

export interface AlertDefinition {
  /** The alert's key — its bell category too, so a person's own mute and the route name one thing. */
  key: NotificationCategory;
  label: string;
  /** One sentence for the Settings page: when it fires. */
  description: string;
  /** Where to go, as the last line of the email and the text. */
  action: string;
  /**
   * Whose pages the alert is about: only people who can view this section receive it. Null for an alert
   * whose page no section holds — then `surface` alone says who may receive it.
   */
  section: AppSection | null;
  /**
   * The SCREEN the alert's link opens, when that screen is granted on its own (a `surfaceCatalogue` key).
   * Only people who can open it receive the alert — the same answer the screen's own guard and its API
   * give (`surfaceAllowed`), the carrier's role and per-person changes included. LUMPER-REVISED-RC-PLAN
   * D-LRC11: Lumper fees is worked by dispatch AND billing and no section holds both, so a section could
   * only ever name half of the people the page is for.
   */
  surface?: string;
  /** The word for several events in an email's subject ("3 drivers"). */
  plural?: string;
  /** The relations this alert can resolve; a route naming another relation reaches nobody. */
  relations: readonly AlertRelation[];
  defaults: readonly AlertRoute[];
}

const on = (recipientKind: AlertRecipientKind, recipientKey: string, channel: AlertChannel): AlertRoute => ({ recipientKind, recipientKey, channel, enabled: true });
/** Whoever marked it, and the truck's dispatcher, on the dashboard (D-HT15's first two columns). */
const HOME_TIME_BASE: readonly AlertRoute[] = [on("relation", "marked_by", "bell"), on("relation", "truck_dispatcher", "bell")];
/**
 * …and the fleet manager role by dashboard and email, for the two that mean something went wrong
 * (owner's ruling Q-HT3, 2026-11-13). A default audience, the carrier's to change on the page — not a
 * permission, which is why it is a role named here and not a set derived from the matrix.
 */
const HOME_TIME_ESCALATED: readonly AlertRoute[] = [...HOME_TIME_BASE, on("role", "fleet_manager", "bell"), on("role", "fleet_manager", "email")];

const HOME_TIME_ACTION = "Open the Dispatch board in Silvicom 360, Home time tab.";
const HOME_TIME_RELATIONS = ["marked_by", "truck_dispatcher"] as const satisfies readonly AlertRelation[];

/**
 * Lumper fees (LUMPER-REVISED-RC-PLAN D-LRC4, D-LRC6, D-LRC7): one alert per row of D-LRC4's "who is
 * reminded" column, so each can be routed on its own. The daily run (`apps/api/src/modules/mcleod/
 * lumper/lumperReminders.ts`) sends each person one bell item, one email and — when an admin switches
 * Text on — one text per alert per day, listing all their loads. The DEFAULT people are the plan's:
 * the order's dispatcher for the revised RC, accounting for billing, and admins on the dashboard as
 * the "chosen people" until the carrier names others on Settings › Notifications.
 */
const LUMPER_RELATIONS = ["order_dispatcher"] as const satisfies readonly AlertRelation[];
const LUMPER_ACTION = "Open Dispatch > Lumper fees in Silvicom 360.";
const LUMPER_SURFACE = "dispatch.lumper-cases";

export const ALERT_CATALOGUE = [
  {
    key: "home_time_return_due",
    label: "Home time ending",
    description: "A driver on home time is due back within the warning window.",
    action: HOME_TIME_ACTION,
    section: "dispatch",
    relations: HOME_TIME_RELATIONS,
    defaults: HOME_TIME_BASE,
  },
  {
    key: "home_time_overdue",
    label: "Home time overstayed",
    description: "A driver is past the return time and nobody has marked him back. Repeats daily, up to seven times.",
    action: HOME_TIME_ACTION,
    section: "dispatch",
    relations: HOME_TIME_RELATIONS,
    defaults: HOME_TIME_ESCALATED,
  },
  {
    key: "home_time_truck_limit",
    label: "Truck at home too long",
    description: "A truck has been at its driver's home longer than the limit.",
    action: HOME_TIME_ACTION,
    section: "dispatch",
    relations: HOME_TIME_RELATIONS,
    defaults: HOME_TIME_ESCALATED,
  },
  {
    key: "lumper_rc_waiting",
    label: "Revised RC missing",
    description: "We paid a lumper and the broker's revised rate confirmation is not on file. Weekdays at 8:00, one message listing every such load.",
    action: LUMPER_ACTION,
    section: null,
    surface: LUMPER_SURFACE,
    plural: "loads",
    relations: LUMPER_RELATIONS,
    defaults: [on("relation", "order_dispatcher", "bell"), on("relation", "order_dispatcher", "email"), on("role", "admin", "bell")],
  },
  {
    key: "lumper_rc_missing_billed",
    label: "Invoiced without the revised RC",
    description: "A load was invoiced with its lumper, but the revised rate confirmation is not on file, so the broker can still refuse to pay it. Weekdays at 8:00.",
    action: LUMPER_ACTION,
    section: null,
    surface: LUMPER_SURFACE,
    plural: "loads",
    relations: LUMPER_RELATIONS,
    defaults: [
      on("relation", "order_dispatcher", "bell"),
      on("relation", "order_dispatcher", "email"),
      on("role", "accountant", "bell"),
      on("role", "accountant", "email"),
      on("role", "admin", "bell"),
    ],
  },
  {
    key: "lumper_billing_gap",
    label: "Lumper not billed in full",
    description: "We paid a lumper and the invoice left it out, or billed less than we paid. Weekdays at 8:00, until it is re-billed or closed with a reason.",
    action: LUMPER_ACTION,
    section: null,
    surface: LUMPER_SURFACE,
    plural: "loads",
    relations: LUMPER_RELATIONS,
    defaults: [on("role", "accountant", "bell"), on("role", "accountant", "email"), on("role", "admin", "bell"), on("role", "admin", "email")],
  },
] as const satisfies readonly AlertDefinition[];

export type AlertKey = (typeof ALERT_CATALOGUE)[number]["key"];
export const ALERT_KEYS = ALERT_CATALOGUE.map((a) => a.key) as AlertKey[];
export const isAlertKey = (v: unknown): v is AlertKey => typeof v === "string" && (ALERT_KEYS as string[]).includes(v);
export const alertDefinition = (key: AlertKey): AlertDefinition => ALERT_CATALOGUE.find((a) => a.key === key)!;

/** The routes in force for an alert: the carrier's saved rows, or the catalogue's defaults when it has saved none. */
export function routesInForce(key: AlertKey, saved: readonly AlertRoute[]): readonly AlertRoute[] {
  return saved.length > 0 ? saved : alertDefinition(key).defaults;
}

export interface AlertMember {
  userId: string;
  role: UserRole;
  /**
   * The member's section claim — their role's saved changes with their own over them, as
   * `custom_access_token_hook` mints it (`alertMemberSections`). Absent = nothing saved: the shipped matrix.
   */
  sections?: SectionClaim;
  /** The member's SCREEN claim, built the same way (`memberSurfaceClaim`). Absent = nothing saved. */
  surfaces?: SurfaceClaim;
}

/**
 * The claim a member's token would carry, from the carrier's two override tables: the role's rows with
 * the person's own over them. Empty for a role whose access cannot be edited (admin, driver) — the
 * hook mints none for them, and a stray row must not colour their answer.
 */
export function alertMemberSections(role: UserRole, roleOverrides: SectionOverrides, userClaim: SectionClaim | undefined): SectionClaim {
  if (!isEditableRole(role)) return {};
  return { ...(roleOverrides[role] ?? {}), ...(userClaim ?? {}) };
}

/** Can this member open the alert's section, on the carrier's own answer? */
export const alertMemberCanView = (m: AlertMember, section: AppSection): boolean => resolveSectionAccess(m.role, section, m.sections ?? null) !== "none";
/** …and manage it — the people an alert addressed to nobody falls back to. */
export const alertMemberCanManage = (m: AlertMember, section: AppSection): boolean => resolveSectionAccess(m.role, section, m.sections ?? null) === "manage";

const surfaceOf = (key: string) => {
  const s = SURFACES.find((x) => x.key === key);
  if (!s) throw new Error(`alert routing: no screen "${key}" in the catalogue`);
  return s;
};

/**
 * May this member receive the alert at all: they can view its section (when it has one) AND open its
 * screen (when it names one), on the carrier's own answers. Every reader of "who can receive" asks
 * this — the resolver, the Settings page and "My alerts" — so none of them can disagree.
 */
export function alertMemberCanReceive(m: AlertMember, def: Pick<AlertDefinition, "section" | "surface">): boolean {
  if (def.section && !alertMemberCanView(m, def.section)) return false;
  if (def.surface && !surfaceAllowed(surfaceOf(def.surface), m.role, m.sections ?? null, m.surfaces ?? null)) return false;
  return true;
}

/**
 * Who an event that resolved to nobody goes to instead (a failure, said in the log): whoever MANAGES the
 * alert's section; for an alert with no section, the admins who can open its screen — the plan's "the
 * reminder then goes to the chosen admins only" (LUMPER-REVISED-RC-PLAN §4).
 */
export function alertMemberIsFallback(m: AlertMember, def: Pick<AlertDefinition, "section" | "surface">): boolean {
  if (!alertMemberCanReceive(m, def)) return false;
  return def.section ? alertMemberCanManage(m, def.section) : m.role === "admin";
}

/**
 * The ROLES that can receive an alert: those whose members can view its section and open its screen by
 * the ROLE's own answers (the carrier's change, else the shipped one). A person given either by name is
 * reached as a person, not through their role.
 */
export function alertRolesFor(def: Pick<AlertDefinition, "section" | "surface">, roleOverrides: SectionOverrides, roleSurfaces: SurfaceOverrides = {}): UserRole[] {
  const all = def.section ? [...new Set<UserRole>([...rolesThatCanView(def.section), ...EDITABLE_ROLES])] : (["admin", ...EDITABLE_ROLES] as UserRole[]);
  return all.filter((role) => {
    if (def.section && effectiveSectionAccess(role, def.section, roleOverrides) === "none") return false;
    if (!def.surface) return true;
    const editable = isEditableRole(role);
    const sections = editable ? ((roleOverrides[role] ?? null) as SectionClaim | null) : null;
    return surfaceAllowed(surfaceOf(def.surface), role, sections, editable ? (roleSurfaces[role] ?? null) : null);
  });
}

/**
 * Who receives an alert, and on which channels — the ONE resolver (D-NR3).
 *
 * - A **role** row reaches every member with that role.
 * - A **relation** row reaches the person the sender resolved for this event, if anybody.
 * - A **user** row beats both (D-NR2): on adds the person, off removes them — so somebody can opt a
 *   colleague out of an alert their role gets without changing the role's switch.
 * - Nobody outside the alert's section is ever reached, whatever a row says: a member who cannot view
 *   it — on the carrier's own Permissions page, `alertMemberCanView` — is dropped, and so is an id
 *   that is not a current member (a person who left, a relation that points at a suspended account).
 *
 * `members` are the carrier's ACTIVE members. The result holds only people with at least one channel.
 * It may be empty: the sender then falls back, loudly — an alert addressed to nobody is a failure.
 */
export function resolveAlertRecipients(
  key: AlertKey,
  saved: readonly AlertRoute[],
  members: readonly AlertMember[],
  relations: Partial<Record<AlertRelation, string | null>>,
): Map<string, Set<AlertChannel>> {
  const def = alertDefinition(key);
  const eligible = new Map(members.filter((m) => alertMemberCanReceive(m, def)).map((m) => [m.userId, m.role]));
  const out = new Map<string, Set<AlertChannel>>();
  const add = (userId: string | null | undefined, channel: AlertChannel) => {
    if (!userId || !eligible.has(userId)) return;
    out.set(userId, (out.get(userId) ?? new Set<AlertChannel>()).add(channel));
  };
  const routes = routesInForce(key, saved);
  for (const r of routes) {
    if (!r.enabled) continue;
    if (r.recipientKind === "role") {
      for (const [userId, role] of eligible) if (role === r.recipientKey) add(userId, r.channel);
    } else if (r.recipientKind === "relation") {
      if ((def.relations as readonly string[]).includes(r.recipientKey)) add(relations[r.recipientKey as AlertRelation], r.channel);
    }
  }
  // The person's own rows last, so they win in both directions.
  for (const r of routes) {
    if (r.recipientKind !== "user") continue;
    if (r.enabled) add(r.recipientKey, r.channel);
    else out.get(r.recipientKey)?.delete(r.channel);
  }
  for (const [userId, channels] of out) if (channels.size === 0) out.delete(userId);
  return out;
}

// ── the Settings page and "My alerts" (HOME-TIME-PLAN HT5, NOTIFICATION-ROUTING-PLAN NR4) ─────────

/** `PUT /api/alert-routing/:alert` — the alert's whole set of switches, replacing what was saved. */
export const alertRoutesSaveSchema = z.object({ routes: z.array(alertRouteSchema).max(300) });
export type AlertRoutesSave = z.infer<typeof alertRoutesSaveSchema>;

/** One switch's identity: a set of routes holds each (recipient, channel) once. */
export const alertRouteId = (r: Pick<AlertRoute, "recipientKind" | "recipientKey" | "channel">): string => `${r.recipientKind}:${r.recipientKey}:${r.channel}`;

/**
 * Why a set of routes cannot be saved for an alert, in words for the page, or null when it can.
 *
 * `memberIds` are the carrier's active members who can view the alert's section — the only people a
 * `user` row may name (anybody else would never be reached, and the page would say they are).
 * `roleKeys` are the roles that can (`alertRolesFor`). Both are the CARRIER's answer, so the caller
 * passes them: the API from its override tables, the page from what the API listed.
 * The last rule is the plan's: an alert addressed to nobody is a failure, so a set with every switch
 * off is refused rather than saved and then quietly sent to everyone who manages the section.
 */
export function alertRoutesProblem(key: AlertKey, routes: readonly AlertRoute[], memberIds: ReadonlySet<string>, roleKeys: ReadonlySet<string>): string | null {
  const def = alertDefinition(key);
  const viewers = roleKeys;
  const seen = new Set<string>();
  for (const r of routes) {
    const id = alertRouteId(r);
    if (seen.has(id)) return "The same recipient and channel is listed twice.";
    seen.add(id);
    if (r.recipientKind === "role" && !viewers.has(r.recipientKey)) return "That role cannot open the page this alert is about, so it cannot receive it.";
    if (r.recipientKind === "relation" && !(def.relations as readonly string[]).includes(r.recipientKey)) return "This alert does not have that recipient.";
    if (r.recipientKind === "user" && !memberIds.has(r.recipientKey)) return "One of the people listed is not an active member who can open the page this alert is about.";
  }
  if (!routes.some((r) => r.enabled)) return "An alert cannot be sent to nobody. Leave at least one recipient switched on.";
  return null;
}

const alertKeySchema = z.string().refine(isAlertKey);

/** `GET /api/alert-routing` — every alert the carrier can route, the switches in force, and who can be added. */
export const alertRoutingViewSchema = z.object({
  alerts: z.array(
    z.object({
      key: alertKeySchema,
      label: z.string(),
      description: z.string(),
      /** The relations this alert has, with their words. */
      relations: z.array(z.object({ key: z.enum(ALERT_RELATIONS), label: z.string() })),
      /** The roles that can view the alert's section — the only ones that can receive it. */
      roles: z.array(z.object({ key: z.string(), label: z.string() })),
      /** The switches in force: the carrier's saved set, or the defaults. */
      routes: z.array(alertRouteSchema),
      /** True when the carrier has saved nothing for this alert, so `routes` are the defaults. */
      usesDefaults: z.boolean(),
      /**
       * The members who can receive THIS alert — the only people its editor may offer. Alerts differ
       * (home time is the Dispatch section's; the lumper reminders are a screen accounting holds without
       * Dispatch), so one list for the page would offer a person a save then refuses.
       */
      memberIds: z.array(z.string()),
    }),
  ),
  /** Active members, with their role, so the page can add a person and say who a role reaches. */
  members: z.array(
    z.object({
      userId: z.string(),
      name: z.string(),
      role: z.string(),
      /** Has a mobile number they confirmed and have not stopped: a Text switch reaches them. */
      textReady: z.boolean(),
    }),
  ),
  /** Texting: whether this server can send one at all, and the hours a text is held (D-HT18). */
  texts: z.object({ available: z.boolean(), quiet: alertTextQuietSchema }),
});
export type AlertRoutingView = z.infer<typeof alertRoutingViewSchema>;

/**
 * `GET /api/me/alerts` — what the caller receives (D-HT17's read-only half). `always` is by their role
 * or their own row; each relation is what they get when the event is theirs.
 */
export const myAlertsSchema = z.object({
  alerts: z.array(
    z.object({
      key: alertKeySchema,
      label: z.string(),
      description: z.string(),
      always: z.array(z.enum(ALERT_CHANNELS)),
      whenMine: z.array(z.object({ relation: z.enum(ALERT_RELATIONS), label: z.string(), channels: z.array(z.enum(ALERT_CHANNELS)) })),
    }),
  ),
});
export type MyAlerts = z.infer<typeof myAlertsSchema>;

/**
 * What one member receives of one alert, from the ONE resolver — so "My alerts" cannot say something
 * the sender would not do. A relation is listed only when it adds a channel `always` does not have.
 */
export function alertsForMember(key: AlertKey, saved: readonly AlertRoute[], member: AlertMember): { always: AlertChannel[]; whenMine: { relation: AlertRelation; channels: AlertChannel[] }[] } {
  const order = (set: Set<AlertChannel> | undefined) => ALERT_CHANNELS.filter((c) => set?.has(c));
  const always = order(resolveAlertRecipients(key, saved, [member], {}).get(member.userId));
  const whenMine = alertDefinition(key).relations.flatMap((relation) => {
    const channels = order(resolveAlertRecipients(key, saved, [member], { [relation]: member.userId }).get(member.userId)).filter((c) => !always.includes(c));
    return channels.length > 0 ? [{ relation, channels }] : [];
  });
  return { always, whenMine };
}

/**
 * A saved set, less what can no longer receive the alert: a role the carrier has since taken the
 * section from, a person who left or lost it. The page shows this and its next save writes it, so a
 * permission change never leaves a set the page then refuses to save. The DEFAULTS pass through here
 * too — a default naming a role this carrier removed from the section is not shown as a switch.
 */
export function receivableRoutes(routes: readonly AlertRoute[], memberIds: ReadonlySet<string>, roleKeys: ReadonlySet<string>): AlertRoute[] {
  return routes.filter((r) => (r.recipientKind === "role" ? roleKeys.has(r.recipientKey) : r.recipientKind === "user" ? memberIds.has(r.recipientKey) : true));
}
