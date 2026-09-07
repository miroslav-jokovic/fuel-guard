import { AppText } from './AppText';

/**
 * A bare section heading, for the few places that need the type without the `Section` wrapper's
 * spacing (a heading inside an already-padded card). Prefer `Section`: it owns the rhythm, which is
 * the half that used to be invisible at the call site.
 */
export function SectionLabel({ children }: { children: string }) {
  return (
    <AppText variant="navigationTitle" accessibilityRole="header">
      {children}
    </AppText>
  );
}
