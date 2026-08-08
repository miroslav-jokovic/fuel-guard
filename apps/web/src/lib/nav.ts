import {
  ArrowUpTrayIcon,
  BeakerIcon,
  ClipboardDocumentCheckIcon,
  ClockIcon,
  Cog6ToothIcon,
  ExclamationTriangleIcon,
  HomeIcon,
  LoadsIcon,
  PaperAirplaneIcon,
  MapIcon,
  OdometerIcon,
  PetrolPumpIcon,
  ReconciliationIcon,
  RejectionIcon,
  ShieldCheckIcon,
  ShieldExclamationIcon,
  SparklesIcon,
  TrailerIcon,
  TransactionIcon,
  TrophyIcon,
  TruckIcon,
  TruckStopIcon,
  UserGroupIcon,
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
        { name: "Import", to: "/import", icon: ArrowUpTrayIcon, show: canManageSection(role, "fuel") },
        { name: "Reconciliation", to: "/fuel-reconciliation", icon: ReconciliationIcon, show: canManageSection(role, "fuel") },
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
        { name: "Driver Qualification", to: "/compliance", icon: ClipboardDocumentCheckIcon, show: canViewSection(role, "fleet") },
        // ONE hazmat entry (H-C4, owner decision 2026-08-08): the hub routes to the calculator, the
        // loads board and the review queue — duplicating them here duplicated Loads/Trailers for no
        // gain. The review badge rides on the hub so the queue still announces itself.
        { name: "HazmatGuard", to: "/hazmat", icon: ShieldExclamationIcon, show: isStaff && moduleEnabled(modules, "hazmatguard"), badge: counts.hazmatReview },
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
