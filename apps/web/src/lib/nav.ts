import type { FunctionalComponent } from "vue";
import {
  HomeIcon,
  TruckIcon,
  UserGroupIcon,
  BeakerIcon,
  ExclamationTriangleIcon,
  Cog6ToothIcon,
  UsersIcon,
  ArrowUpTrayIcon,
  TableCellsIcon,
  NoSymbolIcon,
  SparklesIcon,
  ArchiveBoxIcon,
  ArrowsRightLeftIcon,
  ClockIcon,
  TrophyIcon,
  MapIcon,
  BuildingStorefrontIcon,
  ShieldCheckIcon,
} from "@heroicons/vue/24/outline";

export interface NavItem {
  name: string;
  to: string;
  icon: FunctionalComponent;
  show: boolean;
}

export interface NavGroup {
  /** Section label (null = ungrouped top items). */
  label: string | null;
  /** Section icon shown in the collapsed rail (labeled sections only). */
  icon?: FunctionalComponent;
  items: NavItem[];
}

/** The slice of the session's role capabilities the sidebar needs to decide visibility. */
export interface NavSession {
  canManage: boolean;
  readOnly: boolean;
  admin: boolean;
}

/**
 * The single source of truth for the sidebar. Sections mirror the product areas — Fuel, Dispatch, Safety,
 * Fleet — with Dashboard/Ask AI at the top and Admin pinned last. Health/QA/config surfaces (Detection
 * Coverage, Reefer Coverage, Recall Audit, Reports) intentionally live on the Settings page, not here.
 *
 * `show` is UI gating ONLY — RLS + the API's requireRole checks are the real enforcement. When the
 * department roles (dispatcher, safety_manager) land, swap these predicates for section capabilities.
 */
export function buildNavGroups(s: NavSession): NavGroup[] {
  const manageOrRead = s.canManage || s.readOnly;
  return [
    {
      label: null,
      items: [
        { name: "Dashboard", to: "/", icon: HomeIcon, show: true },
        { name: "Ask AI", to: "/ask", icon: SparklesIcon, show: manageOrRead },
      ],
    },
    {
      label: "Fuel",
      icon: BeakerIcon,
      items: [
        { name: "Fuel Log", to: "/fuel-log", icon: BeakerIcon, show: true },
        { name: "Transactions", to: "/transactions", icon: TableCellsIcon, show: manageOrRead },
        { name: "Rejections", to: "/rejections", icon: NoSymbolIcon, show: manageOrRead },
        { name: "Import", to: "/import", icon: ArrowUpTrayIcon, show: s.canManage },
      ],
    },
    {
      label: "Dispatch",
      icon: MapIcon,
      items: [
        { name: "Fuel Planning", to: "/fuel-planning", icon: MapIcon, show: s.canManage },
        { name: "Truck Stops", to: "/truck-stops", icon: BuildingStorefrontIcon, show: manageOrRead },
      ],
    },
    {
      label: "Safety",
      icon: ShieldCheckIcon,
      items: [
        { name: "Alerts", to: "/anomalies", icon: ExclamationTriangleIcon, show: manageOrRead },
        { name: "Driver Performance", to: "/driver-performance", icon: TrophyIcon, show: manageOrRead },
        { name: "Idling", to: "/idling", icon: ClockIcon, show: manageOrRead },
      ],
    },
    {
      label: "Fleet",
      icon: TruckIcon,
      items: [
        { name: "Vehicles", to: "/vehicles", icon: TruckIcon, show: manageOrRead },
        { name: "Trailers", to: "/trailers", icon: ArchiveBoxIcon, show: manageOrRead },
        { name: "Drivers", to: "/drivers", icon: UserGroupIcon, show: manageOrRead },
        { name: "Odometer", to: "/odometer", icon: ArrowsRightLeftIcon, show: manageOrRead },
      ],
    },
    {
      label: "Admin",
      icon: Cog6ToothIcon,
      items: [
        { name: "Settings", to: "/settings", icon: Cog6ToothIcon, show: s.canManage },
        { name: "Users", to: "/settings/users", icon: UsersIcon, show: s.admin },
      ],
    },
  ]
    .map((g) => ({ ...g, items: g.items.filter((i) => i.show) }))
    .filter((g) => g.items.length > 0);
}
