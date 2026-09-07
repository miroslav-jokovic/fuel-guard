import { describe, expect, it } from 'vitest';
import { isUnmeteredConnection } from './meteredConnection';

/**
 * D-SCAN11's cost rule, and the tri-state that makes it easy to get backwards.
 *
 * Getting it wrong in the permissive direction pushes a ~12 MB three-page bill of lading over a
 * driver's own cellular plan, for bytes nothing reads until somebody disputes the load. Getting it
 * wrong in the conservative direction delays an upload by half an hour. The tests are written around
 * that asymmetry rather than around the truth table.
 */
describe('isUnmeteredConnection', () => {
  it('uploads over Wi-Fi, which is the case a truck stop actually provides', () => {
    expect(isUnmeteredConnection({ type: 'wifi' })).toBe(true);
  });

  it('waits on cellular even when the platform says nothing about cost', () => {
    expect(isUnmeteredConnection({ type: 'cellular' })).toBe(false);
  });

  it('waits on cellular the platform calls expensive', () => {
    expect(isUnmeteredConnection({ type: 'cellular', isConnectionExpensive: true })).toBe(false);
  });

  /**
   * ⚠ The assertion the `=== false` comparison exists for. `!facts.isConnectionExpensive` reads an
   * ABSENT answer as "cheap" and passes this case, which is the one wrong answer that costs money —
   * so this and the `cellular` case above are the pair that pins the difference.
   */
  it('treats "the platform did not say" as metered, not as free', () => {
    expect(isUnmeteredConnection({ type: 'ethernet' })).toBe(false);
    expect(isUnmeteredConnection({ type: 'other', isConnectionExpensive: undefined })).toBe(false);
  });

  it('uploads over a non-Wi-Fi link the platform explicitly calls cheap', () => {
    // An ethernet-tethered tablet, or an unmetered plan the OS knows about. Explicit `false` is a
    // statement, unlike absence.
    expect(isUnmeteredConnection({ type: 'ethernet', isConnectionExpensive: false })).toBe(true);
  });
});
