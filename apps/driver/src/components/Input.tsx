import { TextInput, type TextInputProps } from 'react-native';

// Token-only text field. 16pt text avoids iOS focus-zoom; >= 48pt target.
export function Input({ invalid = false, ...rest }: { invalid?: boolean } & TextInputProps) {
  return (
    <TextInput
      className={`rounded-md bg-surface border px-3 min-h-[48px] text-base text-ink placeholder:text-ink-subtle ${
        invalid ? 'border-danger' : 'border-edge-strong'
      }`}
      {...rest}
    />
  );
}
