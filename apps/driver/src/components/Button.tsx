import { Pressable, Text, type PressableProps } from 'react-native';

type Variant = 'primary' | 'secondary' | 'danger' | 'soft' | 'ghost';
type Size = 'sm' | 'md';

// Variant taxonomy matches the web design system (plan §11.6). Targets >= 48pt (glove).
const VIEW: Record<Variant, string> = {
  primary: 'bg-brand active:opacity-90',
  secondary: 'bg-surface border border-edge-strong active:bg-surface-subtle',
  danger: 'bg-danger active:opacity-90',
  soft: 'bg-surface-muted active:opacity-90',
  ghost: 'active:opacity-70',
};
const LABEL: Record<Variant, string> = {
  primary: 'text-brand-fg',
  secondary: 'text-ink-secondary',
  danger: 'text-ink-inverse',
  soft: 'text-ink-secondary',
  ghost: 'text-ink-muted',
};
const SIZE: Record<Size, { view: string; text: string }> = {
  sm: { view: 'px-3 min-h-[44px]', text: 'text-sm' },
  md: { view: 'px-4 min-h-[52px]', text: 'text-base' },
};

export type ButtonProps = { label: string; variant?: Variant; size?: Size } & PressableProps;

export function Button({ label, variant = 'secondary', size = 'md', disabled, ...rest }: ButtonProps) {
  const s = SIZE[size];
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      className={`flex-row items-center justify-center rounded-md ${VIEW[variant]} ${s.view} ${disabled ? 'opacity-50' : ''}`}
      {...rest}
    >
      <Text className={`font-semibold ${LABEL[variant]} ${s.text}`}>{label}</Text>
    </Pressable>
  );
}
