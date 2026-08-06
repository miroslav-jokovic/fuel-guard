import {
  ArrowUpTrayIcon,
  BeakerIcon,
  ClipboardDocumentCheckIcon,
  ClockIcon,
  Cog6ToothIcon,
  ExclamationTriangleIcon,
  HomeIcon,
  LoadsIcon,
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
        // Certifications and operating credentials are reviewed as part of the safety workflow.
        // Keep the existing Fleet capability gate so this IA move does not broaden access.
        { name: "Compliance", to: "/compliance", icon: ClipboardDocumentCheckIcon, show: canViewSection(role, "fleet") },
        { name: "HazmatGuard", to: "/hazmat", icon: ShieldExclamationIcon, show: isStaff && moduleEnabled(modules, "hazmatguard") },
        { name: "Placard Calculator", to: "/hazmat/calculator", icon: ClipboardDocumentCheckIcon, show: isStaff && moduleEnabled(modules, "hazmatguard") },
        { name: "Hazmat Loads", to: "/hazmat/loads", icon: LoadsIcon, show: canViewSection(role, "hazmat") && moduleEnabled(modules, "hazmatguard") },
        { name: "Hazmat Review", to: "/hazmat/review", icon: ClipboardDocumentCheckIcon, show: canViewSection(role, "hazmat") && moduleEnabled(modules, "hazmatguard"), badge: counts.hazmatReview },
        { name: "Cargo-Tank Profiles", to: "/hazmat/settings/equipment", icon: TrailerIcon, show: canManageSection(role, "hazmat") && moduleEnabled(modules, "hazmatguard") },
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
