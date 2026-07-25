import { TextInput, type TextInputProps } from 'react-native';

// Token-only text field. 16pt text avoids iOS focus-zoom; >= 48pt target. The style default keeps
// text vertically centered on both platforms (Android needs includeFontPadding:false +
// textAlignVertical); a caller-passed `style` still merges on top (e.g. paddingRight for an adornment).
export function Input({ invalid = false, style, ...rest }: { invalid?: boolean } & TextInputProps) {
  return (
    <TextInput
      className={`rounded-md bg-surface border px-3 min-h-[48px] text-base text-ink placeholder:text-ink-subtle ${
        invalid ? 'border-danger' : 'border-edge-strong'
      }`}
      style={[{ paddingVertical: 8, textAlignVertical: 'center', includeFontPadding: false }, style]}
      {...rest}
    />
  );
}
