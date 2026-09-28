# FuelGuard UI component adoption baseline

Generated from the current Vue source with `pnpm audit:ui -- --markdown`. Re-run the command after each migration slice; this file is a review baseline, while the command output is the live inventory.

## Summary

| Measure | Count |
|---|---:|
| `webPages` | 82 |
| `adminPages` | 6 |
| `pagesUsingPageHeader` | 68 |
| `pagesWithoutPageHeader` | 14 |
| `baseCardInstances` | 216 |
| `radiusUtilities` | 461 |
| `textSmUtilities` | 1087 |
| `textXsUtilities` | 774 |
| `inkSubtleUtilities` | 0 |
| `smallInkSubtleLines` | 0 |
| `rawButtonsInPagesAndFeatures` | 0 |
| `rawInputsInPagesAndFeatures` | 0 |
| `rawSelectsInPagesAndFeatures` | 0 |
| `rawWebTables` | 3 |
| `visibleRawWebTables` | 0 |
| `screenReaderTableFallbacks` | 3 |
| `rawAdminTables` | 0 |

## Web page adoption

Raw-element counts are evidence for review, not automatic defects. Auth/public pages and screen-reader fallbacks may be documented exceptions.

| Page | PageHeader | BaseCard | Raw button | Raw input | Raw select | Raw table |
|---|---:|---:|---:|---:|---:|---:|
| `AnnualInspectionFormPage.vue` | Yes | 2 | 0 | 0 | 0 | 0 |
| `AnnualInspectionsPage.vue` | Yes | 0 | 0 | 0 | 0 | 0 |
| `AnomaliesPage.vue` | Yes | 1 | 0 | 0 | 0 | 0 |
| `ApplicantRecordPage.vue` | Yes | 0 | 0 | 0 | 0 | 0 |
| `ApplyPage.vue` | No | 2 | 0 | 0 | 0 | 0 |
| `AskAiPage.vue` | Yes | 1 | 0 | 0 | 0 | 0 |
| `AssetDetailPage.vue` | Yes | 3 | 0 | 0 | 0 | 0 |
| `AssetsPage.vue` | Yes | 0 | 0 | 0 | 0 | 0 |
| `AssignmentsPage.vue` | Yes | 0 | 0 | 0 | 0 | 0 |
| `AuditPage.vue` | Yes | 0 | 0 | 0 | 0 | 0 |
| `BillingPage.vue` | Yes | 0 | 0 | 0 | 0 | 0 |
| `CardControlSettingsPage.vue` | Yes | 5 | 0 | 0 | 0 | 0 |
| `CompliancePage.vue` | Yes | 0 | 0 | 0 | 0 | 0 |
| `CountSessionPage.vue` | Yes | 0 | 0 | 0 | 0 | 0 |
| `CoveragePage.vue` | Yes | 7 | 0 | 0 | 0 | 0 |
| `DashboardPage.vue` | Yes | 1 | 0 | 0 | 0 | 0 |
| `DataSyncPage.vue` | Yes | 4 | 0 | 0 | 0 | 0 |
| `DispatchLoadDetailPage.vue` | Yes | 4 | 0 | 0 | 0 | 0 |
| `DispatchLoadsPage.vue` | Yes | 0 | 0 | 0 | 0 | 0 |
| `DriverAppSettingsPage.vue` | Yes | 8 | 0 | 0 | 0 | 0 |
| `DriverDetailPage.vue` | Yes | 3 | 0 | 0 | 0 | 0 |
| `DriverPerformancePage.vue` | Yes | 1 | 0 | 0 | 0 | 0 |
| `DriverPerformanceSettingsPage.vue` | Yes | 3 | 0 | 0 | 0 | 0 |
| `DriversPage.vue` | Yes | 0 | 0 | 0 | 0 | 0 |
| `EfsSoapPage.vue` | Yes | 4 | 0 | 0 | 0 | 0 |
| `FleetReportPage.vue` | Yes | 0 | 0 | 0 | 0 | 0 |
| `FuelCardDetailPage.vue` | Yes | 2 | 0 | 0 | 0 | 0 |
| `FuelCardsPage.vue` | Yes | 0 | 0 | 0 | 0 | 0 |
| `FuelExceptionsPage.vue` | Yes | 1 | 0 | 0 | 0 | 0 |
| `FuelLogPage.vue` | Yes | 0 | 0 | 0 | 0 | 0 |
| `FuelPlanningPage.vue` | Yes | 0 | 0 | 0 | 0 | 0 |
| `FuelPlanningSettingsPage.vue` | Yes | 6 | 0 | 0 | 0 | 0 |
| `FuelReconciliationPage.vue` | Yes | 1 | 0 | 0 | 0 | 0 |
| `FuelStationsPage.vue` | Yes | 2 | 0 | 0 | 0 | 0 |
| `HazmatCalculatorPage.vue` | Yes | 0 | 0 | 0 | 0 | 0 |
| `HazmatLoadDetailPage.vue` | Yes | 5 | 0 | 0 | 0 | 0 |
| `HazmatReviewPage.vue` | Yes | 0 | 0 | 0 | 0 | 0 |
| `IdlingPage.vue` | Yes | 6 | 0 | 0 | 0 | 0 |
| `IftaLedgerPage.vue` | Yes | 1 | 0 | 0 | 0 | 0 |
| `InquiryQueuePage.vue` | Yes | 1 | 0 | 0 | 0 | 0 |
| `InspectorRegisterPage.vue` | Yes | 0 | 0 | 0 | 0 | 0 |
| `LabelsPage.vue` | Yes | 2 | 0 | 0 | 0 | 0 |
| `MaintenanceHomePage.vue` | Yes | 0 | 0 | 0 | 0 | 0 |
| `MaintenancePage.vue` | Yes | 0 | 0 | 0 | 0 | 0 |
| `MaintenanceSpendPage.vue` | Yes | 0 | 0 | 0 | 0 | 0 |
| `MessagesPage.vue` | Yes | 5 | 0 | 0 | 0 | 0 |
| `NotFoundPage.vue` | Yes | 0 | 0 | 0 | 0 | 0 |
| `NotificationsPage.vue` | Yes | 1 | 0 | 0 | 0 | 0 |
| `OdometerPage.vue` | Yes | 1 | 0 | 0 | 0 | 0 |
| `OrgSettingsPage.vue` | Yes | 2 | 0 | 0 | 0 | 0 |
| `PartDetailPage.vue` | Yes | 1 | 0 | 0 | 0 | 0 |
| `PartsPage.vue` | Yes | 0 | 0 | 0 | 0 | 0 |
| `PlaceholderPage.vue` | No | 0 | 0 | 0 | 0 | 0 |
| `PublicPlacardCalculatorPage.vue` | No | 1 | 0 | 0 | 0 | 0 |
| `RecallAuditPage.vue` | Yes | 3 | 0 | 0 | 0 | 0 |
| `RecruitmentPage.vue` | Yes | 0 | 0 | 0 | 0 | 0 |
| `RecruitmentTemplatesPage.vue` | Yes | 2 | 0 | 0 | 0 | 0 |
| `ReeferCoveragePage.vue` | Yes | 0 | 0 | 0 | 0 | 0 |
| `ReportsPage.vue` | Yes | 4 | 0 | 0 | 0 | 0 |
| `ScanPage.vue` | No | 0 | 0 | 0 | 0 | 0 |
| `ScreeningReadinessPage.vue` | Yes | 1 | 0 | 0 | 0 | 0 |
| `ServerErrorPage.vue` | Yes | 0 | 0 | 0 | 0 | 0 |
| `SettingsPage.vue` | Yes | 0 | 0 | 0 | 0 | 0 |
| `SettingsPermissionsPage.vue` | Yes | 0 | 0 | 0 | 0 | 0 |
| `SettingsRecruitingPage.vue` | Yes | 0 | 0 | 0 | 0 | 0 |
| `SettingsUsersPage.vue` | Yes | 2 | 0 | 0 | 0 | 0 |
| `ThresholdsPage.vue` | Yes | 3 | 0 | 0 | 0 | 0 |
| `TrailersPage.vue` | Yes | 0 | 0 | 0 | 0 | 0 |
| `UnitDetailPage.vue` | Yes | 1 | 0 | 0 | 0 | 0 |
| `UnitsPage.vue` | Yes | 0 | 0 | 0 | 0 | 0 |
| `VehicleDetailPage.vue` | Yes | 3 | 0 | 0 | 0 | 0 |
| `VehiclesPage.vue` | Yes | 0 | 0 | 0 | 0 | 0 |
| `auth/AcceptInvitePage.vue` | No | 0 | 0 | 0 | 0 | 0 |
| `auth/DriverAppRedirectPage.vue` | No | 0 | 0 | 0 | 0 | 0 |
| `auth/ForgotPasswordPage.vue` | No | 0 | 0 | 0 | 0 | 0 |
| `auth/LoginPage.vue` | No | 0 | 0 | 0 | 0 | 0 |
| `auth/PendingPage.vue` | No | 0 | 0 | 0 | 0 | 0 |
| `auth/ResetPasswordPage.vue` | No | 0 | 0 | 0 | 0 | 0 |
| `legal/PrivacyPolicyPage.vue` | No | 0 | 0 | 0 | 0 | 0 |
| `legal/SmsTermsPage.vue` | No | 0 | 0 | 0 | 0 | 0 |
| `legal/SupportPage.vue` | No | 0 | 0 | 0 | 0 | 0 |
| `legal/TermsPage.vue` | No | 0 | 0 | 0 | 0 | 0 |

## Raw table classification

| File | Total | Visible | Screen-reader fallback |
|---|---:|---:|---:|
| `apps/web/src/features/dashboard/widgets/CostCompositionWidget.vue` | 1 | 0 | 1 |
| `apps/web/src/features/dashboard/widgets/MpgTrendWidget.vue` | 1 | 0 | 1 |
| `apps/web/src/features/dashboard/widgets/SpendTrendWidget.vue` | 1 | 0 | 1 |
