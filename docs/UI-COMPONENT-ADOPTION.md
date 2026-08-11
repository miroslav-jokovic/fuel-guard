# FuelGuard UI component adoption baseline

Generated from the current Vue source with `pnpm audit:ui -- --markdown`. Re-run the command after each migration slice; this file is a review baseline, while the command output is the live inventory.

## Summary

| Measure                        | Count |
| ------------------------------ | ----: |
| `webPages`                     |    56 |
| `adminPages`                   |     6 |
| `pagesUsingPageHeader`         |    49 |
| `pagesWithoutPageHeader`       |     7 |
| `baseCardInstances`            |   146 |
| `radiusUtilities`              |   279 |
| `textSmUtilities`              |   494 |
| `textXsUtilities`              |   396 |
| `inkSubtleUtilities`           |     0 |
| `smallInkSubtleLines`          |     0 |
| `rawButtonsInPagesAndFeatures` |     0 |
| `rawInputsInPagesAndFeatures`  |     0 |
| `rawSelectsInPagesAndFeatures` |     0 |
| `rawWebTables`                 |     3 |
| `visibleRawWebTables`          |     0 |
| `screenReaderTableFallbacks`   |     3 |
| `rawAdminTables`               |     0 |

## Web page adoption

Raw-element counts are evidence for review, not automatic defects. Auth/public pages and screen-reader fallbacks may be documented exceptions.

| Page                                | PageHeader | BaseCard | Raw button | Raw input | Raw select | Raw table |
| ----------------------------------- | ---------: | -------: | ---------: | --------: | ---------: | --------: |
| `AnomaliesPage.vue`                 |        Yes |        1 |          0 |         0 |          0 |         0 |
| `AskAiPage.vue`                     |        Yes |        1 |          0 |         0 |          0 |         0 |
| `AssignmentsPage.vue`               |        Yes |        0 |          0 |         0 |          0 |         0 |
| `AuditPage.vue`                     |        Yes |        0 |          0 |         0 |          0 |         0 |
| `CardControlSettingsPage.vue`       |        Yes |        5 |          0 |         0 |          0 |         0 |
| `CompliancePage.vue`                |        Yes |        0 |          0 |         0 |          0 |         0 |
| `CoveragePage.vue`                  |        Yes |        7 |          0 |         0 |          0 |         0 |
| `DashboardPage.vue`                 |        Yes |        2 |          0 |         0 |          0 |         3 |
| `DataSyncPage.vue`                  |        Yes |        2 |          0 |         0 |          0 |         0 |
| `DispatchLoadDetailPage.vue`        |        Yes |        5 |          0 |         0 |          0 |         0 |
| `DispatchLoadFormPage.vue`          |         No |        0 |          0 |         0 |          0 |         0 |
| `DispatchLoadsPage.vue`             |        Yes |        0 |          0 |         0 |          0 |         0 |
| `DriverAppSettingsPage.vue`         |        Yes |        8 |          0 |         0 |          0 |         0 |
| `DriverDetailPage.vue`              |        Yes |        3 |          0 |         0 |          0 |         0 |
| `DriverPerformancePage.vue`         |        Yes |        1 |          0 |         0 |          0 |         0 |
| `DriverPerformanceSettingsPage.vue` |        Yes |        3 |          0 |         0 |          0 |         0 |
| `DriverQualificationPage.vue`       |        Yes |        3 |          0 |         0 |          0 |         0 |
| `DriversPage.vue`                   |        Yes |        0 |          0 |         0 |          0 |         0 |
| `EfsSoapPage.vue`                   |        Yes |        3 |          0 |         0 |          0 |         0 |
| `FuelCardDetailPage.vue`            |        Yes |        3 |          0 |         0 |          0 |         0 |
| `FuelCardsPage.vue`                 |        Yes |        0 |          0 |         0 |          0 |         0 |
| `FuelEventsPage.vue`                |        Yes |        3 |          0 |         0 |          0 |         0 |
| `FuelLogPage.vue`                   |        Yes |        1 |          0 |         0 |          0 |         0 |
| `FuelPlanningPage.vue`              |        Yes |        0 |          0 |         0 |          0 |         0 |
| `FuelPlanningSettingsPage.vue`      |        Yes |        8 |          0 |         0 |          0 |         0 |
| `FuelReconciliationPage.vue`        |        Yes |        2 |          0 |         0 |          0 |         0 |
| `FuelStationsPage.vue`              |        Yes |        2 |          0 |         0 |          0 |         0 |
| `HazmatCalculatorPage.vue`          |        Yes |        0 |          0 |         0 |          0 |         0 |
| `HazmatLoadDetailPage.vue`          |        Yes |        6 |          0 |         0 |          0 |         0 |
| `HazmatLoadFormPage.vue`            |        Yes |        2 |          0 |         0 |          0 |         0 |
| `HazmatLoadsPage.vue`               |        Yes |        0 |          0 |         0 |          0 |         0 |
| `HazmatPage.vue`                    |        Yes |        1 |          0 |         0 |          0 |         0 |
| `HazmatReviewPage.vue`              |        Yes |        0 |          0 |         0 |          0 |         0 |
| `IdlingPage.vue`                    |        Yes |        5 |          0 |         0 |          0 |         0 |
| `ImportPage.vue`                    |        Yes |        3 |          0 |         0 |          0 |         0 |
| `MessagesPage.vue`                  |        Yes |        5 |          0 |         0 |          0 |         0 |
| `NotificationsPage.vue`             |        Yes |        1 |          0 |         0 |          0 |         0 |
| `OdometerPage.vue`                  |        Yes |        1 |          0 |         0 |          0 |         0 |
| `OrgSettingsPage.vue`               |        Yes |        2 |          0 |         0 |          0 |         0 |
| `PlaceholderPage.vue`               |         No |        0 |          0 |         0 |          0 |         0 |
| `PublicPlacardCalculatorPage.vue`   |         No |        1 |          0 |         0 |          0 |         0 |
| `RecallAuditPage.vue`               |        Yes |        3 |          0 |         0 |          0 |         0 |
| `ReeferCoveragePage.vue`            |        Yes |        0 |          0 |         0 |          0 |         0 |
| `RejectionsPage.vue`                |        Yes |        0 |          0 |         0 |          0 |         0 |
| `ReportsPage.vue`                   |        Yes |        4 |          0 |         0 |          0 |         0 |
| `SettingsPage.vue`                  |        Yes |        0 |          0 |         0 |          0 |         0 |
| `SettingsUsersPage.vue`             |        Yes |        2 |          0 |         0 |          0 |         0 |
| `ThresholdsPage.vue`                |        Yes |        3 |          0 |         0 |          0 |         0 |
| `TrailersPage.vue`                  |        Yes |        0 |          0 |         0 |          0 |         0 |
| `TransactionsPage.vue`              |        Yes |        0 |          0 |         0 |          0 |         0 |
| `VehicleDetailPage.vue`             |        Yes |        3 |          0 |         0 |          0 |         0 |
| `VehiclesPage.vue`                  |        Yes |        0 |          0 |         0 |          0 |         0 |
| `auth/AcceptInvitePage.vue`         |         No |        0 |          0 |         0 |          0 |         0 |
| `auth/DriverAppRedirectPage.vue`    |         No |        0 |          0 |         0 |          0 |         0 |
| `auth/LoginPage.vue`                |         No |        0 |          0 |         0 |          0 |         0 |
| `auth/PendingPage.vue`              |         No |        0 |          0 |         0 |          0 |         0 |

## Raw table classification

| File                                   | Total | Visible | Screen-reader fallback |
| -------------------------------------- | ----: | ------: | ---------------------: |
| `apps/web/src/pages/DashboardPage.vue` |     3 |       0 |                      3 |
