import { describe, expect, it } from 'vitest';
import roleValues from '@/theme/theme.roles.json';
import { contrastRatio } from '../scripts/srgb.mjs';
import { TONE_CHIP, TONE_SOFT, type Tone } from '@/components/tone';
import { roleOfTextTone, TEXT_TONE_CLASS, type TextTone } from '@/theme/textTone';

/**
 * `theme-colors.test.ts` asserts the pairings Direction B INTENDED — it reads `theme.roles.json` and
 * nothing else. This file asserts the pairings the components actually ASK FOR, by importing the
 * real tone tables, and the two are different questions.
 *
 * They diverged for as long as nobody asked the second one. On 2026-09-07 seven components were
 * expressing a foreground as a `className` on `AppText`, where NativeWind's cascade discarded it in
 * favour of AppText's own default — so the intended pairing passed its assertion in the other file
 * while the shipped pixels were `ink` on amber, and an avatar initial at 1.40:1 on its own disc.
 * Every table below is imported, never restated: a copy here would recreate the same blind spot.
 */
const roleOfFill = (bg: string): string | null => {
  // `bg-warning/12` and `bg-on-hero/10` are alpha fills. Their composite depends on whatever surface
  // they land on, which is a per-screen fact this file cannot know, so they are out of scope here
  // and covered by the on-surface assertions in theme-colors.test.ts instead. Solid fills are the
  // ones that failed, because a solid fill is where a foreground has nowhere to hide.
  if (bg.includes('/')) return null;
  return bg.replace(/^bg-/, '');
};

const appearances = Object.keys(roleValues) as (keyof typeof roleValues)[];

describe('tone pairings the components actually ask for', () => {
  it('every solid fill and its foreground clear 4.5:1 in all four appearances', () => {
    const checked: string[] = [];
    for (const table of [TONE_SOFT, TONE_CHIP]) {
      for (const [tone, appearance] of Object.entries(table) as [Tone, { bg: string; textTone: TextTone }][]) {
        const fill = roleOfFill(appearance.bg);
        if (!fill) continue;
        const foreground = roleOfTextTone(appearance.textTone);
        for (const appearanceKey of appearances) {
          const theme = roleValues[appearanceKey] as Record<string, string>;
          const ratio = contrastRatio(theme[foreground], theme[fill]);
          expect(ratio, `${tone}: ${foreground} on ${fill} (${appearanceKey})`).toBeGreaterThanOrEqual(4.5);
        }
        checked.push(`${tone}:${foreground}/${fill}`);
      }
    }
    // A silent pass because every fill was skipped is the failure mode this guards against.
    expect(checked.length).toBeGreaterThanOrEqual(12);
  });

  it('every tone names a role that exists in all four appearances', () => {
    for (const tone of Object.keys(TEXT_TONE_CLASS) as TextTone[]) {
      const role = roleOfTextTone(tone);
      for (const appearanceKey of appearances) {
        expect(roleValues[appearanceKey], `${tone} → ${role} (${appearanceKey})`).toHaveProperty(role);
      }
    }
  });

  /**
   * The specific regressions this file exists for. `Avatar` asked for `action-fg` on a `hero-tile`
   * disc — the foreground for the AMBER fill, a near-black in all four appearances by design — which
   * measures 1.40 / 1.14 / 1.68 / 1.45 and was never readable in any theme. The badges asked for
   * `action-fg` on `bg-action` and got `ink`, at 1.67:1 in dark.
   */
  it('pins the two grounds that were rendering unreadable text', () => {
    for (const appearanceKey of appearances) {
      const theme = roleValues[appearanceKey] as Record<string, string>;
      expect(
        contrastRatio(theme[roleOfTextTone('onHero')], theme['hero-tile']),
        `avatar initial on its disc (${appearanceKey})`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(theme[roleOfTextTone('onAction')], theme.action),
        `unread count on the amber badge (${appearanceKey})`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(theme[roleOfTextTone('onBrand')], theme.brand),
        `itinerary node number on the brand disc (${appearanceKey})`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
