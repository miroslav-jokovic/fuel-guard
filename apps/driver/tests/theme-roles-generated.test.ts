import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PALETTE, ROLES, buildRoles, render } from '../scripts/gen-driver-roles.mjs';

const ROOT = join(__dirname, '..');

describe('the colour system (Visual 2026 D-DV3–D-DV5)', () => {
  it('commits theme.roles.json exactly as the palette generates it — no hand edits', () => {
    expect(readFileSync(join(ROOT, 'src/theme/theme.roles.json'), 'utf8')).toBe(render());
  });

  it('uses the carrier colours as measured from the wordmark and the trailer decal', () => {
    expect(PALETTE.navy).toBe('#0A2144');
    expect(PALETTE.cyan).toBe('#00B2E3');
    const light = buildRoles().light ?? {};
    expect(light.hero).toBe('10 33 68');
    expect(light.accent).toBe('0 178 227');
  });

  it('names a palette colour for every role in all four appearances', () => {
    for (const [role, keys] of Object.entries(ROLES)) {
      expect(keys, role).toHaveLength(4);
      for (const key of keys) expect(PALETTE, `${role} → ${key}`).toHaveProperty(key);
    }
  });

  it('keeps every palette colour in use, so the palette is the app and not a wish list', () => {
    const used = new Set(Object.values(ROLES).flat());
    const unused = Object.keys(PALETTE).filter((key) => !used.has(key));
    expect(unused).toEqual([]);
  });

  it('keeps the action colour amber in every appearance (D-DV5: amber means act)', () => {
    for (const theme of Object.values(buildRoles())) {
      const [r = 0, g = 0, b = 255] = (theme.action ?? '').split(' ').map(Number);
      expect(r).toBeGreaterThan(240);
      expect(g).toBeGreaterThan(150);
      expect(b).toBeLessThan(100);
    }
  });
});
