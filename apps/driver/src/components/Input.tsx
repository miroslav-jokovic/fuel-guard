import { useState } from 'react';
import { TextInput, type TextInputProps } from 'react-native';
import { useFieldAccessibility } from './Field';

// Token-only text field. 16pt text avoids iOS focus-zoom; ≥48pt target. A visible FOCUS state
// (brand border) is non-negotiable polish — fields must show where the caret lives. Error wins
// over focus. Android needs includeFontPadding:false + textAlignVertical for true vertical centering.
export function Input({
  invalid = false,
  style,
  onFocus,
  onBlur,
  accessibilityLabel,
  accessibilityHint,
  ...rest
}: { invalid?: boolean } & TextInputProps) {
  const field = useFieldAccessibility();
  const [focused, setFocused] = useState(false);
  const isInvalid = invalid || Boolean(field?.error);
  const border = isInvalid ? 'border-danger' : focused ? 'border-edge-focus' : 'border-edge';
  return (
    <TextInput
      className={`min-h-12 rounded-lg border bg-surface px-3 font-ui text-body text-ink placeholder:text-ink-subtle ${border} ${
        focused && !isInvalid ? 'border-2' : ''
      }`}
      style={[{ paddingVertical: 8, textAlignVertical: 'center', includeFontPadding: false }, style]}
      accessibilityLabel={accessibilityLabel ?? field?.label}
      accessibilityHint={accessibilityHint ?? field?.error ?? field?.hint}
      aria-invalid={isInvalid || undefined}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      {...rest}
    />
  );
}
