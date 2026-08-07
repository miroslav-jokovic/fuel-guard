import { AppText } from './AppText';

/** Sentence-case grouped heading. Uppercase micro-labels are reserved for immutable short codes. */
export function SectionLabel({ children }: { children: string }) {
  return <AppText variant="sectionTitle" tone="secondary" className="pt-1">{children}</AppText>;
}
