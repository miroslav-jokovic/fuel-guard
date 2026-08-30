/**
 * @silvicom/ui/icons — the curated icon inventory.
 *
 * Every icon used anywhere in a Silvicom 360 app is re-exported from here under a
 * stable local name. Feature code imports from this barrel; the barrel maps to
 * whichever HugeIcons glyph we consider canonical for that concept.
 *
 * Why the indirection?
 *   - One-file swap when a designer picks a better variant (e.g. `Truck01Icon`
 *     → `TruckDeliveryIcon`). No churn across 300 call sites.
 *   - Pro upgrade path: swap the source package (`@hugeicons/core-free-icons`
 *     → `@hugeicons-pro/core-*`) here and only here.
 *   - Enforced vocabulary: adding a new icon means adding it here first, which
 *     keeps the set from sprawling.
 *
 * How to add an icon:
 *   1. Find the HugeIcons glyph at https://hugeicons.com (Stroke Rounded, free
 *      tier). Note the export name (e.g. `PackageOpenIcon`).
 *   2. Add a re-export below under a stable local name.
 *   3. Import from `@silvicom/ui/icons` at the call site.
 *
 * Naming convention: local names mirror the semantic Heroicons names that
 * predated this migration, so the pattern is familiar to anyone who worked on
 * the pre-2026-07 codebase. New icons use direct HugeIcons names.
 *
 * Any row marked `// ⚠ verify` should be eyeballed against the HugeIcons
 * catalog before shipping visually — the concept has multiple variants and the
 * choice below is a reasonable default, not a designer's pick.
 */

/**
 * A HugeIcons icon module — a tuple array of [tag, attrs] describing the SVG.
 *
 * Mirrors the shape of core-free-icons' internal `IconSvgObject` (accepting both
 * mutable and readonly forms). We define it inline rather than re-exporting
 * from the package because the package's `exports` map doesn't expose the
 * type subpath cleanly. A structural clone keeps the barrel decoupled from
 * the vendor's internal type layout.
 */
export type Icon = readonly (readonly [string, { readonly [key: string]: string | number }])[];

// prettier-ignore
export {
  // ── Actions ─────────────────────────────────────────────────────────────
  PlusSignIcon                as PlusIcon,
  Cancel01Icon                as XMarkIcon,
  Delete02Icon                as TrashIcon,
  Download04Icon              as ArrowDownTrayIcon,
  Upload04Icon                as ArrowUpTrayIcon,
  RefreshIcon                 as ArrowPathIcon,
  Tick02Icon                  as CheckIcon,
  SquareLock02Icon            as LockIcon,                        // card lock / card-control settings
  MoreVerticalIcon            as EllipsisVerticalIcon,
  Copy01Icon                  as CopyIcon,
  Sent02Icon                  as PaperAirplaneIcon,
  FilterIcon                  as FunnelIcon,
  Search01Icon                as MagnifyingGlassIcon,
  Settings02Icon              as AdjustmentsHorizontalIcon,     // ⚠ verify
  Settings01Icon              as Cog6ToothIcon,

  // ── Navigation / disclosure ─────────────────────────────────────────────
  Menu01Icon                  as Bars3Icon,
  ArrowDown01Icon             as ChevronDownIcon,
  ArrowUp01Icon               as ChevronUpIcon,
  ArrowLeft01Icon             as ChevronLeftIcon,
  ArrowRight01Icon            as ChevronRightIcon,
  ArrowUpDownIcon             as ChevronUpDownIcon,             // ⚠ verify
  ArrowDataTransferHorizontalIcon as ArrowsRightLeftIcon,       // ⚠ verify
  PanelLeftCloseIcon          as PanelLeftCloseIcon,
  PanelLeftOpenIcon           as PanelLeftOpenIcon,

  // ── Status / feedback ───────────────────────────────────────────────────
  CheckmarkCircle02Icon       as CheckCircleIcon,
  CancelCircleIcon            as XCircleIcon,
  Alert01Icon                 as ExclamationTriangleIcon,
  Alert02Icon                 as ShieldExclamationIcon,          // ⚠ verify (see ADR-001)
  InformationCircleIcon       as InformationCircleIcon,
  UnavailableIcon             as NoSymbolIcon,                   // ⚠ verify (⊘ vs. slashed-circle)
  EyeIcon                     as EyeIcon,
  PrinterIcon                 as PrinterIcon,
  ViewOffIcon                 as EyeSlashIcon,

  // ── Objects / domain ────────────────────────────────────────────────────
  TruckIcon                   as TruckIcon,
  Location04Icon              as MapPinIcon,                     // ⚠ verify (pin vs. dropped-pin)
  MapsIcon                    as MapIcon,
  Flag01Icon                  as FlagIcon,
  FlashIcon                   as BoltIcon,
  Fire02Icon                  as FireIcon,                       // ⚠ verify (01/02/03 stylistic pick)
  CubeIcon                    as CubeIcon,
  Archive02Icon               as ArchiveBoxIcon,
  Store01Icon                 as BuildingStorefrontIcon,
  Building02Icon              as BuildingOffice2Icon,
  Home01Icon                  as HomeIcon,
  TestTube01Icon              as BeakerIcon,
  DollarCircleIcon            as CurrencyDollarIcon,
  ChartAverageIcon            as ChartAverageIcon,               // cost-per-mile: an average, per unit
  Link04Icon                  as LinkIcon,                       // ⚠ verify (01/02/03/04 stylistic)
  ChampionIcon                as TrophyIcon,                     // ⚠ verify (ChampionIcon vs. Trophy01Icon)
  SecurityCheckIcon           as ShieldCheckIcon,                // ⚠ verify (shield-with-tick)
  AlertDiamondIcon            as HazmatPlacardIcon,              // hazmat/DOT placard diamond
  Key01Icon                   as KeyIcon,
  ResetPasswordIcon           as ResetPasswordIcon,
  Wifi01Icon                  as SignalIcon,                     // ⚠ verify (wifi arcs vs. signal bars)
  AiMagicIcon                 as SparklesIcon,                   // ✨ AI features
  SmartPhone01Icon            as DevicePhoneMobileIcon,          // Driver App settings card

  // ── Time / calendar ─────────────────────────────────────────────────────
  Clock01Icon                 as ClockIcon,
  Calendar03Icon              as CalendarIcon,

  // ── People ──────────────────────────────────────────────────────────────
  UserGroupIcon               as UserGroupIcon,
  UserMultiple02Icon          as UsersIcon,
  // The applicant board (U5/D-UI6). It rendered `Building02Icon` — a BUILDING, for the person
  // applying — because the nav item was added before this barrel had a people-list glyph.
  UserListIcon                as UserListIcon,

  // ── Notifications ───────────────────────────────────────────────────────
  Notification01Icon          as BellIcon,

  // ── Documents / tables / charts ─────────────────────────────────────────
  File01Icon                  as DocumentTextIcon,
  // Resolved 2026-08-21 (U5): the alias means clipboard-WITH-A-LIST and was pointing at the bare
  // `ClipboardIcon`, which is why it carried a standing ⚠. `ClipboardListIcon` exists and is
  // literally the glyph the local name describes.
  ClipboardListIcon           as ClipboardDocumentListIcon,
  TaskDone01Icon              as ClipboardDocumentCheckIcon,
  // Driver Qualification (U5/D-UI6). It shared `ClipboardDocumentCheckIcon` with Assignments —
  // one glyph on two unrelated nav items, both visible at once in an expanded sidebar. A §391.51
  // file is a licence and a medical card, so the licence glyph says what the section holds.
  LicenseIcon                 as LicenseIcon,
  Table01Icon                 as TableCellsIcon,
  AnalyticsUpIcon             as ChartBarIcon,                   // ⚠ verify (many chart variants)
  Analytics01Icon             as ChartBarSquareIcon,             // ⚠ verify
  ChartAverageIcon            as DocumentChartBarIcon,           // ⚠ verify
  // ── Domain-specific (nav items) ─────────────────────────────────────────
  ContainerIcon               as TrailerIcon,
  CardExchange01Icon          as TransactionIcon,
  PetrolPumpIcon              as PetrolPumpIcon,
  CreditCardNotAcceptIcon     as RejectionIcon,
  CreditCardIcon              as FuelCardIcon,
  WalletDone02Icon            as ReconciliationIcon,
  // The exception ledger: a claim weighed against a bill, which is what the surface is for.
  BalanceScaleIcon            as ExceptionLedgerIcon,
  // The IFTA ledger: a tax owed to a jurisdiction for miles driven inside it. The nav gate requires a
  // glyph unique across the whole menu, so this cannot borrow the scales the exception ledger has.
  TaxesIcon                   as IftaLedgerIcon,
  DeliveryTruck01Icon         as LoadsIcon,
  GasPipeIcon                 as TruckStopIcon,
  ShippingTruck01Icon         as VehicleIcon,
  DashboardBrowsingIcon       as OdometerIcon,

  // ── Card & tile icons (domain-specific card look) ───────────────────────
  Csv02Icon                   as CsvIcon,
  Pdf02Icon                   as PdfIcon,
  Invoice02Icon               as InvoiceIcon,
  WaterEnergyIcon             as GallonsIcon,
  RoadIcon                    as RoadIcon,
  GaugeIcon                   as GaugeIcon,
  DatabaseSync01Icon          as DatabaseSyncIcon,
  ConnectIcon                 as ConnectIcon,
  Radar01Icon                 as RadarIcon,
  ContainerTruck01Icon        as ReeferTruckIcon,
  // The Maintenance SECTION. Its section glyph was Cog6ToothIcon, which Admin also wears — and a
  // section icon renders ONLY in the collapsed rail, where there are no labels at all, so the two
  // sat side by side as the same wordless cog. Same failure as U5/D-UI6, worse placement.
  WrenchIcon                  as WrenchIcon,                  // all three variants rendered and compared
  ChartLineData01Icon         as ReportChartIcon,

  // Colour scheme (D-DS2b): three states, three glyphs — follow the system, pin light, pin dark.
  Sun03Icon                   as SchemeLightIcon,
  Moon02Icon                  as SchemeDarkIcon,
  ComputerIcon                as SchemeSystemIcon,

} from "@hugeicons/core-free-icons";
