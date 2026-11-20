import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TABS } from '@/components/nativeTabsModel';

const ROOT = join(__dirname, '..');

describe('the native tab shell (Visual 2026 D-DV1, V3)', () => {
  it("keeps the owner's four tabs in the owner's order (D-DB14)", () => {
    expect(TABS.map((t) => t.label)).toEqual(['Home', 'Loads', 'Documents', 'More']);
  });

  it('gates exactly Loads and Documents; Home and More are never conditional', () => {
    expect(TABS.filter((t) => t.feature).map((t) => [t.name, t.feature])).toEqual([
      ['loads', 'tab.loads'],
      ['documents', 'hazmat.capture'],
    ]);
  });

  it('gives every tab an outline glyph at rest and its filled twin when selected', () => {
    for (const tab of TABS) expect(tab.sf.selected, tab.name).toBe(`${tab.sf.default}.fill`);
  });

  it('has a screen file for every tab, and none for a route that is no longer a tab', () => {
    for (const tab of TABS) expect(existsSync(join(ROOT, `app/(tabs)/${tab.name}.tsx`)), tab.name).toBe(true);
    // A hidden native tab cannot be navigated to, so Score and Navigate live in the root stack.
    for (const moved of ['score', 'navigate']) {
      expect(existsSync(join(ROOT, `app/(tabs)/${moved}.tsx`)), `(tabs)/${moved}`).toBe(false);
      expect(existsSync(join(ROOT, `app/${moved}.tsx`)), moved).toBe(true);
    }
  });

  it('draws the shell with the system tab bar, not a custom JS one', () => {
    const layout = readFileSync(join(ROOT, 'app/(tabs)/_layout.tsx'), 'utf8');
    expect(layout).toContain("from 'expo-router/unstable-native-tabs'");
    expect(layout).not.toMatch(/tabBar=/);
    expect(existsSync(join(ROOT, 'src/components/TabBar.tsx'))).toBe(false);
  });
});
