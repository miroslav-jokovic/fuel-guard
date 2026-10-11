import {
  AdjustmentsHorizontalIcon,
  BellIcon,
  BooksCheckIcon,
  BuildingOffice2Icon,
  ClipboardDocumentCheckIcon,
  ClipboardDocumentListIcon,
  ConnectIcon,
  LockIcon,
  DatabaseSyncIcon,
  DevicePhoneMobileIcon,
  MapIcon,
  RadarIcon,
  ReeferTruckIcon,
  ReportChartIcon,
  UsersIcon,
  TrophyIcon,
  type Icon,
} from "@silvicom/ui/icons";

/**
 * The Settings directory's cards — what each LOOKS like, and nothing about who sees it
 * (SETTINGS-PERMISSIONS-PLAN.md SP1).
 *
 * Until SP1 every card carried its own `show:` expression — `session.admin`, `session.can("roster")`,
 * `session.admin || session.readOnly` — which made this page the fourth home of each screen's gate,
 * beside the route meta, the API and the RLS policy. Nine of those were `session.admin`, and that is
 * why nine screens could not be offered on the Permissions page: nothing on it could move them.
 *
 * So the card and the screen now ask one question. `SettingsPage.vue` finds each card's surface in
 * the catalogue and shows it exactly when `surfaceAllowed` would let the router open it. What stays
 * here is presentation only — the icon (which cannot live in `shared`, for `navIcons.ts`'s reason),
 * the sentence under the name, and which of the page's two blocks it sits in. Array order is card
 * order. `SettingsPage.test.ts` holds the split: every screen the catalogue says is reached from
 * Settings has a card, and every card names a real surface.
 */
export interface SettingsCard {
  /** A surface key — its label, path and gate are read from the catalogue, never restated here. */
  key: string;
  icon: Icon;
  desc: string;
  block: "config" | "reports";
}

export const SETTINGS_CARDS: readonly SettingsCard[] = [
  { key: "admin.settings.org", icon: BuildingOffice2Icon, desc: "Profile, allowed domains, and operating hours.", block: "config" },
  { key: "admin.settings.notifications", icon: BellIcon, desc: "The carrier's alerts, on or off, and who is emailed.", block: "config" },
  // Users is a SIDEBAR entry as well as a card, which is why it is named here rather than being one
  // of the catalogue's `reachedFrom` screens.
  { key: "admin.users", icon: UsersIcon, desc: "Invite teammates and manage roles.", block: "config" },
  { key: "admin.settings.permissions", icon: LockIcon, desc: "What each role can reach, and exactly what a given member sees.", block: "config" },
  { key: "admin.settings.driver-app", icon: DevicePhoneMobileIcon, desc: "Which features drivers see, app behavior, per-driver exceptions, and the minimum app version.", block: "config" },
  // The only way in: under Settings, not in the sidebar (owner's ruling 2026-09-28). A recruiter holds
  // `settings: none`, cannot open this page, and does not need the card.
  { key: "admin.recruiting", icon: BooksCheckIcon, desc: "How long application links stay open, the reminder, and who signs the handbook and the road test.", block: "config" },
  { key: "admin.settings.data", icon: DatabaseSyncIcon, desc: "Samsara sync, re-sync, rebuild anomalies, and data-integrity status.", block: "config" },
  { key: "admin.settings.efs", icon: ConnectIcon, desc: "SOAP credentials, connection test, and per-feed sync for the direct EFS webservice.", block: "config" },
  { key: "admin.settings.mcleod-fleets", icon: ConnectIcon, desc: "Which McLeod dispatcher runs each fleet, and who each dispatcher is here. Builds the dispatch board's My fleet.", block: "config" },
  { key: "admin.settings.fleetpal", icon: ConnectIcon, desc: "The FleetPal API key, the hourly repair-record sweep, and what each collection last brought in.", block: "config" },
  { key: "admin.settings.card-control", icon: LockIcon, desc: "Who may lock cards and grant fuel exceptions, and the EFS write-access check.", block: "config" },
  { key: "admin.settings.thresholds", icon: AdjustmentsHorizontalIcon, desc: "The limits that decide when a fill is flagged, and the AI second opinion.", block: "config" },
  { key: "admin.settings.driver-performance", icon: TrophyIcon, desc: "How safety, efficiency and idling are weighted into a driver's score.", block: "config" },
  { key: "admin.settings.fuel-planning", icon: MapIcon, desc: "The tank rules, the stations the planner may use, emergencies, prices, and the default load and truck.", block: "config" },
  { key: "admin.settings.audit", icon: ClipboardDocumentListIcon, desc: "Who did what, and when.", block: "config" },
  // Reporting & detection-health surfaces — moved off the daily sidebar into Settings.
  { key: "admin.reports", icon: ReportChartIcon, desc: "Fuel spend, MPG, and anomaly summaries to review or export.", block: "reports" },
  { key: "admin.coverage", icon: RadarIcon, desc: "How many fills could be checked against Samsara, truck by truck.", block: "reports" },
  { key: "admin.reefer-coverage", icon: ReeferTruckIcon, desc: "Which trucks have reefer-fueling detection enabled.", block: "reports" },
  { key: "admin.recall-audit", icon: ClipboardDocumentCheckIcon, desc: "Check a sample of unflagged fills to measure what the system misses.", block: "reports" },
];
