import { describe, expect, it } from 'vitest';
import type { LoadStop, LoadStopPhoto } from '@silvicom/shared';
import {
  buildStopPhotos,
  outstandingSlots,
  reasonRequiredToComplete,
  satisfiedSlots,
  type SessionCapture,
} from '@/features/loads/stopCaptureModel';

function cap(slot: string, over: Partial<SessionCapture> = {}): SessionCapture {
  return {
    photoId: `id-${slot}`,
    slot,
    localUri: `file:///tmp/${slot}.jpg`,
    capturedAt: '2026-07-28T12:00:00Z',
    ...over,
  };
}

function photo(slot: string): LoadStopPhoto {
  return { id: `ph-${slot}`, slot, storage_path: `p/${slot}.jpg`, captured_at: null, uploaded_at: '2026-01-01T00:00:00Z' };
}

function stop(required: string[], photos: LoadStopPhoto[] = []): Pick<LoadStop, 'required_photos' | 'photos'> {
  return { required_photos: required, photos };
}

describe('satisfiedSlots', () => {
  it('unions server photos and this-session captures', () => {
    const s = satisfiedSlots(stop([], [photo('bol')]), [cap('seal')]);
    expect([...s].sort()).toEqual(['bol', 'seal']);
  });
});

describe('outstandingSlots', () => {
  it('lists required slots with no photo from either source', () => {
    expect(outstandingSlots(stop(['bol', 'seal', 'trailer'], [photo('bol')]), [cap('seal')])).toEqual(['trailer']);
  });
  it('is empty when every required slot is covered', () => {
    expect(outstandingSlots(stop(['bol'], [photo('bol')]), [])).toEqual([]);
  });
  it('ignores captures for slots that are not required', () => {
    expect(outstandingSlots(stop(['bol'], []), [cap('bol'), cap('other')])).toEqual([]);
  });
});

describe('reasonRequiredToComplete (D21)', () => {
  it('requires a reason when a required slot is still missing', () => {
    expect(reasonRequiredToComplete(stop(['bol', 'seal'], []), [cap('bol')])).toBe(true);
  });
  it('does not require a reason when all required slots are covered', () => {
    expect(reasonRequiredToComplete(stop(['bol'], []), [cap('bol')])).toBe(false);
  });
  it('does not require a reason when the stop has no required photos', () => {
    expect(reasonRequiredToComplete(stop([], []), [])).toBe(false);
  });
});

describe('buildStopPhotos', () => {
  it('maps a capture to the RLS-scoped storage path, keeping the client UUID as the row id', () => {
    const photos = buildStopPhotos({
      orgId: 'org1',
      driverId: 'drv1',
      loadId: 'load1',
      captures: [cap('bol', { photoId: 'p1', localUri: 'file:///a.jpg', capturedAt: '2026-07-28T00:00:00Z' })],
    });
    expect(photos).toEqual([
      {
        id: 'p1',
        slot: 'bol',
        storage_path: 'org1/drv1/load1/p1.jpg',
        captured_at: '2026-07-28T00:00:00Z',
        local_uri: 'file:///a.jpg',
      },
    ]);
  });
  it('is empty for no captures (a plain arrive or skip)', () => {
    expect(buildStopPhotos({ orgId: 'o', driverId: 'd', loadId: 'l', captures: [] })).toEqual([]);
  });
});
