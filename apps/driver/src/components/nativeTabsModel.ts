import type { SFSymbolIcon, MaterialIcon } from 'expo-router/native-tabs';
import type { FeatureKey } from '@silvicom/shared';

/** Symbol name types from the icon component's own props, so a misspelt glyph fails typecheck. */
type SfName = Extract<NonNullable<SFSymbolIcon['sf']>, string>;
type MdName = Extract<MaterialIcon['md'], string>;

/**
 * The four tabs, in the owner's order (D-DB14), and the glyph each one carries on each platform
 * (Visual 2026 D-DV11). Pure data, so the order, the gating and the icon pairs are tested without a
 * renderer (`apps/driver/tests/native-tabs-model.test.ts`).
 *
 * The SF Symbols are outline at rest and filled when selected, which is the system apps'
 * convention. Material Symbols names are the Android equivalents, one glyph for both states. SDK 58
 * accepts an `md` pair too; drawing a selected Android glyph is a visual change, so it waits for a
 * screen step and the owner's look at it (D-DV24), not the SDK upgrade.
 */
export interface TabSpec {
  name: 'home' | 'loads' | 'documents' | 'more';
  label: string;
  sf: { default: SfName; selected: SfName };
  md: MdName;
  /** A fleet can switch this tab off. Home and More are never conditional (D-DB14). */
  feature?: FeatureKey;
}

export const TABS: readonly TabSpec[] = [
  { name: 'home', label: 'Home', sf: { default: 'house', selected: 'house.fill' }, md: 'home' },
  {
    name: 'loads',
    label: 'Loads',
    sf: { default: 'shippingbox', selected: 'shippingbox.fill' },
    md: 'local_shipping',
    feature: 'tab.loads',
  },
  {
    name: 'documents',
    label: 'Documents',
    sf: { default: 'doc.text', selected: 'doc.text.fill' },
    md: 'description',
    feature: 'hazmat.capture',
  },
  { name: 'more', label: 'More', sf: { default: 'ellipsis.circle', selected: 'ellipsis.circle.fill' }, md: 'more_horiz' },
];
