// @silvicom/ui — the shared design system consumed by both the customer and platform apps.
// Import the token layer once per app: `import "@silvicom/ui/tokens.css"`.
//
// Every export here must have a caller. `lint:ui-adoption` fails on one that does not, because a
// barrel is a promise: four of these had no call site anywhere — AppNumberField and AppInputGroup
// were whole components nothing rendered, AppSurface and AppTextField were aliases for AppCard and
// AppInput that nobody used the second name for (removed 2026-08-23, D-DS8).
export { default as AppButton } from "./components/AppButton.vue";
export { default as AppInput } from "./components/AppInput.vue";
export { default as AppPasswordInput } from "./components/AppPasswordInput.vue";
export { default as AppCard } from "./components/AppCard.vue";
export { default as AppIcon } from "./components/AppIcon.vue";
export { default as AppCheckbox } from "./components/AppCheckbox.vue";
export { default as AppTextarea } from "./components/AppTextarea.vue";
export { default as AppSelect } from "./components/AppSelect.vue";
export { default as AppSwitch } from "./components/AppSwitch.vue";
export { default as AppTable } from "./components/AppTable.vue";
export { default as AppPageHeader } from "./components/AppPageHeader.vue";
export { default as AppIconButton } from "./components/AppIconButton.vue";
export { default as AppRadioGroup } from "./components/AppRadioGroup.vue";
export { default as AppSearchField } from "./components/AppSearchField.vue";
export { default as AppDateField } from "./components/AppDateField.vue";
export { default as AppDateTimeField } from "./components/AppDateTimeField.vue";
export { default as AppMonthField } from "./components/AppMonthField.vue";
export { default as AppMemorableDate } from "./components/AppMemorableDate.vue";
export { default as AppDateRangePicker } from "./components/AppDateRangePicker.vue";
export { default as AppFormField } from "./components/AppFormField.vue";
export { default as AppCombobox } from "./components/AppCombobox.vue";
export { default as AppBadge } from "./components/AppBadge.vue";
export { default as AppIconChip } from "./components/AppIconChip.vue";
export type { ChipTone } from "./components/AppIconChip.vue";
export { default as AppDelta } from "./components/AppDelta.vue";
export type { DeltaDirection, DeltaTone } from "./components/AppDelta.vue";
export { default as AppAvatar } from "./components/AppAvatar.vue";
export { default as AppTabs } from "./components/AppTabs.vue";
export { default as AppSegmentedControl } from "./components/AppSegmentedControl.vue";
export { default as AppCallout } from "./components/AppCallout.vue";
export type { SelectOption } from "./components/AppSelect.vue";
export type { TabItem } from "./components/AppTabs.vue";
export type { SegmentOption } from "./components/AppSegmentedControl.vue";
export { provideTouchTargets, useTouchTargets } from "./touchTargets";

// The list and read-state composites (US7, D-US11 — UI-STANDARDIZATION.md). They lived in
// `apps/web/src/components/ui` until 2026-10-15, where the admin console could not reach them, so the
// same list behaved two ways in two consoles. Moved, not copied: there is one address for each.
export { default as DataWorkspace } from "./components/DataWorkspace.vue";
export { default as FilterBar } from "./components/FilterBar.vue";
export type { FilterChip } from "./components/FilterBar.vue";
export { default as DataTable } from "./components/DataTable.vue";
export type { DataTableColumn } from "./components/DataTable.vue";
export { default as TablePagination } from "./components/TablePagination.vue";
export { default as BulkActionBar } from "./components/BulkActionBar.vue";
export { default as QueryState } from "./components/QueryState.vue";
export { default as FactList } from "./components/FactList.vue";
export { default as StatCard } from "./components/StatCard.vue";
export type { Fact } from "./components/FactList.vue";
export { default as ErrorState } from "./components/ErrorState.vue";
export { default as ErrorPanel } from "./components/ErrorPanel.vue";
export { default as TableSkeleton } from "./components/TableSkeleton.vue";
export { ANY_PARAM, useQueryState } from "./lists/useQueryState";
export type { UrlQueryState } from "./lists/useQueryState";
export { sortRows, toggleSort } from "./lists/sort";
export { useUrlSort, SORT_DIRECTIONS } from "./lists/useUrlSort";
export type { SortState } from "./lists/sort";
export { countLabelFor } from "./lists/plural";
export { isBlank } from "./lists/dataTable";
export { provideWorkspaceTable, reportToWorkspace, useWorkspaceTable } from "./lists/workspaceTable";
export { NotFoundError, isNotFound, retryUnlessNotFound, QUERY_DEFAULTS, recordOrThrow } from "./lists/notFound";
export { provideRouteOpens } from "./lists/routeOpens";
// "Are you sure?" (D-US7) and the dialog it draws in, moved with the list kit so the admin console
// asks the same way the web app does instead of through `window.confirm`.
export { default as BaseModal } from "./components/BaseModal.vue";
export { default as ConfirmHost } from "./components/ConfirmHost.vue";
export { useConfirm, useConfirmStore } from "./lists/confirm";
export type { ConfirmRequest } from "./lists/confirm";

