import {
  ArrowsRightLeftIcon,
  ArrowUpTrayIcon,
  BeakerIcon,
  CheckCircleIcon,
  ClipboardDocumentCheckIcon,
  ClipboardDocumentListIcon,
  ClockIcon,
  Cog6ToothIcon,
  ExceptionLedgerIcon,
  ExclamationTriangleIcon,
  HomeIcon,
  LoadsIcon,
  PaperAirplaneIcon,
  MapIcon,
  OdometerIcon,
  PetrolPumpIcon,
  ReconciliationIcon,
  FuelCardIcon,
  RejectionIcon,
  ShieldCheckIcon,
  HazmatPlacardIcon,
  LicenseIcon,
  SparklesIcon,
  TrailerIcon,
  TransactionIcon,
  TrophyIcon,
  TruckIcon,
  TruckStopIcon,
  UserGroupIcon,
  UserListIcon,
  UsersIcon,
  VehicleIcon,
  type Icon,
} from "@fuelguard/ui/icons";
import {
  canViewSection,
  canManageSection,
  canManageFleet,
  isAdmin,
  moduleEnabled,
  type UserRole,
  type ModuleSet,
} from "@fuelguard/shared";

export interface NavItem {
  name: string;
  to: string;
  icon: Icon;
  show: boolean;
  /** Optional count badge (e.g. pending hazmat reviews). Rendered only when > 0. */
  badge?: number;
}

/** Live counts injected into the nav (kept out of the static section map). */
export interface NavCounts {
  hazmatReview?: number;
  messagesUnread?: number;
}

export interface NavGroup {
  /** Section label (null = ungrouped top items). */
  label: string | null;
  /** Section icon shown in the collapsed rail (labeled sections only). */
  icon?: Icon;
  items: NavItem[];
}

/**
 * The single source of truth for the sidebar. Sections mirror the product areas — Fuel, Dispatch, Safety,
 * Fleet — with Dashboard/Ask AI at the top and Admin pinned last. Health/QA/config surfaces (Detection
 * Coverage, Reefer Coverage, Recall Audit, Reports) intentionally live on the Settings page, not here.
 *
 * `show` is UI gating ONLY — RLS + the API's requireRole checks are the real enforcement. Visibility is
 * driven by the shared section-capability matrix (auth.ts): canViewSection opens a section read-only,
 * canManageSection gates the write surfaces (Import, Fuel Planning). Dashboard + Fuel Log stay ungated so
 * drivers keep them; Ask AI is any signed-in staff role (not driver).
 */
export function buildNavGroups(role: UserRole | null, modules: ModuleSet | null, counts: NavCounts = {}): NavGroup[] {
  const isStaff = role != null && role !== "driver";
  return [
    {
      label: null,
      items: [
        { name: "Dashboard", to: "/", icon: HomeIcon, show: true },
        { name: "Ask AI", to: "/ask", icon: SparklesIcon, show: isStaff },
      ],
    },
    {
      label: "Fuel",
      icon: BeakerIcon,
      items: [
        { name: "Fuel Log", to: "/fuel-log", icon: PetrolPumpIcon, show: true },
        { name: "Transactions", to: "/transactions", icon: TransactionIcon, show: canViewSection(role, "fuel") },
        { name: "Rejections", to: "/rejections", icon: RejectionIcon, show: canViewSection(role, "fuel") },
        // EFS card inventory + control. Read-only until the write entitlement is confirmed; the
        // page itself explains that, so the nav entry does not need to know.
        { name: "Cards", to: "/fuel-cards", icon: FuelCardIcon, show: canViewSection(role, "fuel") },
        { name: "Import", to: "/import", icon: ArrowUpTrayIcon, show: canManageSection(role, "fuel") },
        { name: "Reconciliation", to: "/fuel-reconciliation", icon: ReconciliationIcon, show: canManageSection(role, "fuel") },
        // The ledger is a READ surface for anyone who can see fuel — a controller checking what was
        // recovered does not need the permission to upload a statement. Moving a finding is gated
        // at the route, not here.
        { name: "Exceptions", to: "/fuel-exceptions", icon: ExceptionLedgerIcon, show: canViewSection(role, "fuel") },
      ],
    },
    {
      label: "Dispatch",
      icon: MapIcon,
      items: [
        { name: "Loads", to: "/loads", icon: LoadsIcon, show: canViewSection(role, "dispatch") && moduleEnabled(modules, "dispatch") },
        // Phase 7 (D-PM4): the dispatch inbox — participation-scoped, module-gated, badge = unread.
        { name: "Messages", to: "/messages", icon: PaperAirplaneIcon, show: canViewSection(role, "dispatch") && moduleEnabled(modules, "messages"), badge: counts.messagesUnread },
        { name: "Assignments", to: "/assignments", icon: ClipboardDocumentCheckIcon, show: canViewSection(role, "dispatch") && moduleEnabled(modules, "dispatch") },

        { name: "Fuel Planning", to: "/fuel-planning", icon: MapIcon, show: canManageSection(role, "dispatch") },
        { name: "Truck Stops", to: "/truck-stops", icon: TruckStopIcon, show: canViewSection(role, "dispatch") },
      ],
    },
    {
      label: "Safety",
      icon: ShieldCheckIcon,
      items: [
        { name: "Alerts", to: "/anomalies", icon: ExclamationTriangleIcon, show: canViewSection(role, "safety") },
        { name: "Driver Performance", to: "/driver-performance", icon: TrophyIcon, show: canViewSection(role, "safety") },
        { name: "Idling", to: "/idling", icon: ClockIcon, show: canViewSection(role, "safety") },
        // The driver qualification file (§391.51) — certifications, the DQF event history, and the
        // scans behind both. Named for what it is rather than "Compliance", which said nothing, and
        // rather than "Safety", which is the section it already sits in. Keeps the existing Fleet
        // capability gate so the rename does not broaden access, and keeps /compliance so nobody's
        // bookmark breaks.
        // ⚠ U5/D-UI6: it wore ClipboardDocumentCheckIcon, which Assignments also wears — one glyph on
        // two unrelated items in two different sections, both on screen at once. A §391.51 file is a
        // licence and a medical card, so LicenseIcon says what it holds.
        { name: "Driver Qualification", to: "/compliance", icon: LicenseIcon, show: canViewSection(role, "fleet") },
        // ONE hazmat entry (H-C4, owner decision 2026-08-08): the hub routes to the calculator, the
        // loads board and the review queue — duplicating them here duplicated Loads/Trailers for no
        // gain. The review badge rides on the hub so the queue still announces itself.
        {
          name: "HazmatGuard",
          to: "/hazmat",
          icon: HazmatPlacardIcon,
          show: isStaff && moduleEnabled(modules, "hazmatguard"),
          badge: counts.hazmatReview,
        },
      ],
    },
    {
      // Recruitment is the hiring half of §391, and its OWN section in the capability matrix — not a
      // corner of Fleet. Gating it on `fleet` (which is how it first shipped) let a dispatcher read
      // every driver's former employers; §391.53(a)(1) puts that file with the people making the
      // hiring decision. More lands here later; employment history is the first surface.
      label: "Recruitment",
      icon: ClipboardDocumentListIcon,
      items: [
        // ⚠ U5/D-UI6: this rendered Building02Icon — a BUILDING, for the person applying. The LABEL
        // is deliberately untouched: RECRUITING-SYSTEM-PLAN R9 owns the word and renames it when the
        // recruiter board lands (D-UI8).
        { name: "Applicants", to: "/recruitment", icon: UserListIcon, show: canViewSection(role, "recruitment") },
        // U1/D-UI1: both routes were REGISTERED on 2026-08-20 to close a P0b incident (the URLs fell
        // through to nothing) and still had no nav entry, so they were reachable only from two
        // buttons on the Applicants page. A recruiter arriving from a notification had no way back,
        // and neither page was discoverable by anyone who had not been shown it. The buttons stay:
        // one answers "from here", the other answers "at all".
        { name: "Screening readiness", to: "/recruitment/screening", icon: CheckCircleIcon, show: canViewSection(role, "recruitment") },
        { name: "Safety-history inquiries", to: "/recruitment/inquiries", icon: ArrowsRightLeftIcon, show: canViewSection(role, "recruitment") },
      ],
    },
    {
      label: "Fleet",
      icon: TruckIcon,
      items: [
        { name: "Vehicles", to: "/vehicles", icon: VehicleIcon, show: canViewSection(role, "fleet") },
        { name: "Trailers", to: "/trailers", icon: TrailerIcon, show: canViewSection(role, "fleet") },
        { name: "Drivers", to: "/drivers", icon: UserGroupIcon, show: canViewSection(role, "fleet") },
        { name: "Odometer", to: "/odometer", icon: OdometerIcon, show: canViewSection(role, "fleet") },
      ],
    },
    {
      label: "Admin",
      icon: Cog6ToothIcon,
      items: [
        // Settings = org config (admin + fleet_manager); Users = admin only. Department roles get neither.
        { name: "Settings", to: "/settings", icon: Cog6ToothIcon, show: canManageFleet(role) },
        { name: "Users", to: "/settings/users", icon: UsersIcon, show: isAdmin(role) },
      ],
    },
  ]
    .map((g) => ({ ...g, items: g.items.filter((i) => i.show) }))
    .filter((g) => g.items.length > 0);
}
