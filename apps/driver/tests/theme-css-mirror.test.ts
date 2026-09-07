import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderThemeCss } from '../scripts/gen-driver-theme-css.mjs';
import roleValues from '@/theme/theme.roles.json';

const ROOT = join(import.meta.dirname, '..');
const css = readFileSync(join(ROOT, 'global.css'), 'utf8');

/**
 * `global.css` claimed to be generated for a year while nothing generated it (Direction B §0), so a
 * 50-role re-value was fifty hand edits per appearance. `lint:theme` catches a drifted VALUE; this
 * catches a drifted FILE — a role added to the JSON and never mirrored, or a hand edit to the CSS
 * that the generator would undo on its next run.
 */
describe('global.css mirrors theme.roles.json', () => {
  it('is byte-identical to what pnpm gen:theme would write', () => {
    expect(renderThemeCss(css, roleValues)).toBe(css);
  });

  it('would notice a role whose value changed in the JSON', () => {
    const mutated = {
      ...roleValues,
      light: { ...roleValues.light, hero: '255 0 0' },
    };
    expect(renderThemeCss(css, mutated)).not.toBe(css);
  });
});
