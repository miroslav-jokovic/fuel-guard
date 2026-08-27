// @silvicom/ui — the shared design system consumed by both the customer and platform apps.
// Import the token layer once per app: `import "@silvicom/ui/tokens.css"`.
//
// Every export here must have a caller. `lint:ui-adoption` fails on one that does not, because a
// barrel is a promise: four of these had no call site anywhere — AppNumberField and AppInputGroup
// were whole components nothing rendered, AppSurface and AppTextField were aliases for AppCard and
// AppInput that nobody used the second name for (removed 2026-08-23, D-DS8).
export { default as AppButton } from "./components/AppButton.vue";
export { default as AppInput } from "./components/AppInput.vue";
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
export { default as AppDateRangePicker } from "./components/AppDateRangePicker.vue";
export { default as AppFormField } from "./components/AppFormField.vue";
export { default as AppCombobox } from "./components/AppCombobox.vue";
export { default as AppBadge } from "./components/AppBadge.vue";
export { default as AppAvatar } from "./components/AppAvatar.vue";
export { default as AppTabs } from "./components/AppTabs.vue";
export { default as AppCallout } from "./components/AppCallout.vue";
export type { SelectOption, SelectValue } from "./components/AppSelect.vue";
export type { RadioOption, RadioValue } from "./components/AppRadioGroup.vue";
export type { DateRangeValue } from "./components/AppDateRangePicker.vue";
export type { ComboboxOption } from "./components/AppCombobox.vue";
export type { TabItem } from "./components/AppTabs.vue";
export type { CalloutTone } from "./components/AppCallout.vue";
