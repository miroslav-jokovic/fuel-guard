import {
  ArrowsRightLeftIcon,
  ArrowUpTrayIcon,
  BeakerIcon,
  CheckCircleIcon,
  CurrencyDollarIcon,
  DocumentTextIcon,
  ChartAverageIcon,
  InvoiceIcon,
  GaugeIcon,
  ClipboardDocumentCheckIcon,
  ClipboardDocumentListIcon,
  ClockIcon,
  Cog6ToothIcon,
  ExceptionLedgerIcon,
  IftaLedgerIcon,
  ExclamationTriangleIcon,
  HomeIcon,
  LoadsIcon,
  PaperAirplaneIcon,
  MapIcon,
  OdometerIcon,
  PetrolPumpIcon,
  ReconciliationIcon,
  FuelCardIcon,
  ShieldCheckIcon,
  ShieldExclamationIcon,
  HazmatPlacardIcon,
  LicenseIcon,
  SparklesIcon,
  TrailerIcon,
  TrophyIcon,
  TruckIcon,
  TruckStopIcon,
  UserGroupIcon,
  UserListIcon,
  CertificateIcon,
  ChecklistIcon,
  WrenchIcon,
  UsersIcon,
  VehicleIcon,
  type Icon,
} from "@silvicom/ui/icons";

/**
 * The sidebar's glyphs, keyed by surface — the half of the catalogue that cannot live in
 * `packages/shared` (D-SURF3, SURFACE-ENTITLEMENTS-PLAN.md S1).
 *
 * Shared depends on `zod` alone and is compiled for React Native for `apps/driver`; importing Vue
 * icon components there would break that build, and `packages/ui` does not depend on shared either.
 * So the permission facts live in `SURFACES` and the pictures live here.
 *
 * This is NOT a second home for a permission — an icon is not one. It IS the exact point where an
 * author who has not read that decision concludes "the catalogue can't live in shared" and
 * duplicates the whole thing web-side. `lint:surfaces` asserts these keys are exactly the
 * catalogue's, in both directions, so the split cannot silently drift.
 */
export const SURFACE_ICONS: Record<string, Icon> = {
  dashboard: HomeIcon,
  "ask-ai": SparklesIcon,

  "fuel.log": PetrolPumpIcon,
  "fuel.cards": FuelCardIcon,
  "fuel.import": ArrowUpTrayIcon,
  "fuel.spend": ReconciliationIcon,
  "fuel.exceptions": ExceptionLedgerIcon,
  "fuel.ifta": IftaLedgerIcon,

  "dispatch.loads": LoadsIcon,
  "dispatch.messages": PaperAirplaneIcon,
  "dispatch.assignments": ClipboardDocumentCheckIcon,
  "dispatch.fuel-planning": MapIcon,
  "dispatch.truck-stops": TruckStopIcon,

  "safety.alerts": ExclamationTriangleIcon,
  "safety.driver-performance": TrophyIcon,
  "safety.idling": ClockIcon,
  // ⚠ U5/D-UI6: this wore ClipboardDocumentCheckIcon, which Assignments also wears — one glyph on
  // two unrelated items in two different sections, both on screen at once. A §391.51 file is a
  // licence and a medical card, so LicenseIcon says what it holds.
  "safety.driver-qualification": LicenseIcon,
  "safety.placard-calculator": HazmatPlacardIcon,
  "safety.hazmat-review": ShieldExclamationIcon,

  // ⚠ U5/D-UI6: Applicants rendered Building02Icon — a BUILDING, for the person applying. The LABEL
  // is deliberately untouched: RECRUITING-SYSTEM-PLAN R9 owns the word and renames it when the
  // recruiter board lands (D-UI8).
  "recruitment.applicants": UserListIcon,
  "recruitment.screening": CheckCircleIcon,
  "recruitment.inquiries": ArrowsRightLeftIcon,

  "fleet.vehicles": VehicleIcon,
  "fleet.trailers": TrailerIcon,
  "fleet.drivers": UserGroupIcon,
  "fleet.odometer": OdometerIcon,

  "finance.accounting": CurrencyDollarIcon,
  "finance.cpm": ChartAverageIcon,
  "finance.cost-schedule": InvoiceIcon,
  "finance.billing": DocumentTextIcon,

  "maintenance.repair-spend": GaugeIcon,
  "maintenance.inspections": ChecklistIcon,
  "maintenance.inspectors": CertificateIcon,

  "admin.settings": Cog6ToothIcon,
  "admin.users": UsersIcon,
};

/** The icon shown for a labelled group in the collapsed rail. Keyed by `SURFACE_GROUPS[].key`. */
export const GROUP_ICONS: Record<string, Icon> = {
  fuel: BeakerIcon,
  dispatch: MapIcon,
  safety: ShieldCheckIcon,
  recruitment: ClipboardDocumentListIcon,
  fleet: TruckIcon,
  finance: CurrencyDollarIcon,
  maintenance: WrenchIcon,
  admin: Cog6ToothIcon,
};
