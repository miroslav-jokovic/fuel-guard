import { describe, expect, it } from 'vitest';
import {
  activeSlot,
  badgeLabel,
  discOffset,
  isHiddenTab,
  shell,
  shellBottomMargin,
  shellHeight,
  visibleTabs,
} from '@/components/tabBarModel';

const ICONS = { home: 1, loads: 1, documents: 1, more: 1 };
const routes = [
  { key: 'home-1', name: 'home' },
  { key: 'loads-1', name: 'loads' },
  { key: 'navigate-1', name: 'navigate' },
  { key: 'documents-1', name: 'documents' },
  { key: 'score-1', name: 'score' },
  { key: 'more-1', name: 'more' },
];
const enabled = { options: { headerShown: false, title: 'X' } };
const hidden = { options: { headerShown: false, tabBarItemStyle: {}, tabBarButton: () => null } };

describe('tab shell — which tabs draw', () => {
  it('reads a hidden tab from the tabBarButton expo-router substitutes for href: null', () => {
    expect(isHiddenTab(hidden.options)).toBe(true);
    expect(isHiddenTab(enabled.options)).toBe(false);
    expect(isHiddenTab(undefined)).toBe(false);
  });

  it('draws only routes with an icon that are not hidden, in navigator order', () => {
    const descriptors = {
      'home-1': enabled, 'loads-1': hidden, 'navigate-1': enabled, 'documents-1': enabled, 'score-1': hidden, 'more-1': enabled,
    };
    expect(visibleTabs(routes, descriptors, ICONS).map((r) => r.name)).toEqual(['home', 'documents', 'more']);
  });
});

describe('tab shell — where the disc sits', () => {
  const visible = routes.filter((r) => r.name !== 'navigate' && r.name !== 'score');

  it('lights the active tab by position among the VISIBLE tabs, not the navigator index', () => {
    expect(activeSlot(visible, { key: 'more-1', name: 'more' }, false)).toBe(3);
    expect(activeSlot(visible, { key: 'documents-1', name: 'documents' }, false)).toBe(2);
  });

  it('keeps More lit while a hidden Score route is on screen, because that is where the driver came from', () => {
    expect(activeSlot(visible, { key: 'score-1', name: 'score' }, true)).toBe(3);
  });

  it('shows no disc for a route that is neither visible nor Score-from-More', () => {
    expect(activeSlot(visible, { key: 'navigate-1', name: 'navigate' }, false)).toBe(-1);
    expect(activeSlot(visible, undefined, false)).toBe(-1);
  });

  it('centres the disc over its slot at any slot width', () => {
    expect(discOffset(0, 80, 52)).toBe(14);
    expect(discOffset(2, 71.6, 52)).toBeCloseTo(153, 0);
    // The centre of the disc is the centre of the slot.
    const slot = 71.6;
    expect(discOffset(3, slot, shell.disc) + shell.disc / 2).toBeCloseTo(3.5 * slot, 6);
  });

  it('protrudes exactly half the notch above the capsule', () => {
    expect(shell.rise).toBe(shell.notch / 2);
    expect(shell.notch).toBeGreaterThan(shell.disc);
  });
});

describe('tab shell — edges and badges', () => {
  it('rides on the home-indicator inset and never closer than 12pt to the screen edge', () => {
    expect(shellBottomMargin(34)).toBe(34);
    expect(shellBottomMargin(0)).toBe(12);
  });

  it('reports the whole floating shell, notch strip included, so the scene can clear it', () => {
    /**
     * The scene passes UNDER the shell since 2026-09-08, so this number is the difference between a
     * list whose last row can be read and one permanently behind a capsule. It must cover all three
     * parts — `Screen` reads exactly this, and reads it from here rather than from
     * `BottomTabBarHeightContext`, whose value is not guaranteed once the bar is absolutely
     * positioned.
     */
    expect(shellHeight(34)).toBe(shell.rise + shell.height + 34);
    expect(shellHeight(0)).toBe(shell.rise + shell.height + 12);
    // It is strictly more than the capsule alone: the notch rises above the capsule's top edge, and
    // a scene that stopped at the capsule would still put its last row under the active disc.
    expect(shellHeight(34)).toBeGreaterThan(shell.height + 34);
  });

  it('reads an unread count as nothing, the number, or 9+', () => {
    expect(badgeLabel(undefined)).toBeNull();
    expect(badgeLabel(0)).toBeNull();
    expect(badgeLabel(-2)).toBeNull();
    expect(badgeLabel(3)).toBe('3');
    expect(badgeLabel(9)).toBe('9');
    expect(badgeLabel(10)).toBe('9+');
    expect(badgeLabel('new')).toBe('new');
    expect(badgeLabel('')).toBeNull();
  });
});
