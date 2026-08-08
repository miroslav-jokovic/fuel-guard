import { AppText } from './AppText';

/** Sentence-case heading with 24pt before its section and 8pt before its first child. */
export function SectionLabel({ children, compact = false }: { children: string; compact?: boolean }) {
  return (
    <AppText variant="sectionTitle" tone="secondary" className={compact ? '' : 'mt-2 -mb-2'}>
      {children}
    </AppText>
  );
}
