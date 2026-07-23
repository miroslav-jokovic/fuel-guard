import type { FunctionalComponent } from "vue";
import { canViewSection, canManageSection, canManageFleet, isAdmin, type UserRole } from "@fuelguard/shared";
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
export function buildNavGroups(role: UserRole | null): NavGroup[] {
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
        { name: "Fuel Log", to: "/fuel-log", icon: BeakerIcon, show: true },
        { name: "Transactions", to: "/transactions", icon: TableCellsIcon, show: canViewSection(role, "fuel") },
        { name: "Rejections", to: "/rejections", icon: NoSymbolIcon, show: canViewSection(role, "fuel") },
        { name: "Import", to: "/import", icon: ArrowUpTrayIcon, show: canManageSection(role, "fuel") },
      ],
    },
    {
      label: "Dispatch",
      icon: MapIcon,
      items: [
        { name: "Fuel Planning", to: "/fuel-planning", icon: MapIcon, show: canManageSection(role, "dispatch") },
        { name: "Truck Stops", to: "/truck-stops", icon: BuildingStorefrontIcon, show: canViewSection(role, "dispatch") },
      ],
    },
    {
      label: "Safety",
      icon: ShieldCheckIcon,
      items: [
        { name: "Alerts", to: "/anomalies", icon: ExclamationTriangleIcon, show: canViewSection(role, "safety") },
        { name: "Driver Performance", to: "/driver-performance", icon: TrophyIcon, show: canViewSection(role, "safety") },
        { name: "Idling", to: "/idling", icon: ClockIcon, show: canViewSection(role, "safety") },
      ],
    },
    {
      label: "Fleet",
      icon: TruckIcon,
      items: [
        { name: "Vehicles", to: "/vehicles", icon: TruckIcon, show: canViewSection(role, "fleet") },
        { name: "Trailers", to: "/trailers", icon: ArchiveBoxIcon, show: canViewSection(role, "fleet") },
        { name: "Drivers", to: "/drivers", icon: UserGroupIcon, show: canViewSection(role, "fleet") },
        { name: "Odometer", to: "/odometer", icon: ArrowsRightLeftIcon, show: canViewSection(role, "fleet") },
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
