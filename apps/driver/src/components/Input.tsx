import { useState } from 'react';
import { TextInput, type TextInputProps } from 'react-native';

// Token-only text field. 16pt text avoids iOS focus-zoom; ≥48pt target. A visible FOCUS state
// (brand border) is non-negotiable polish — fields must show where the caret lives. Error wins
// over focus. Android needs includeFontPadding:false + textAlignVertical for true vertical centering.
export function Input({
  invalid = false,
  style,
  onFocus,
  onBlur,
  ...rest
}: { invalid?: boolean } & TextInputProps) {
  const [focused, setFocused] = useState(false);
  const border = invalid ? 'border-danger' : focused ? 'border-brand' : 'border-edge-strong';
  return (
    <TextInput
      className={`min-h-[48px] rounded-lg border bg-surface px-3.5 text-base text-ink placeholder:text-ink-subtle ${border} ${
        focused && !invalid ? 'border-2' : ''
      }`}
      style={[{ paddingVertical: 8, textAlignVertical: 'center', includeFontPadding: false }, style]}
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
