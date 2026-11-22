import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import type { Load } from '@silvicom/shared';
import { glanceStopLoad } from './glanceModel';
import { syncGlance } from './glanceSync';

/**
 * Keeps the Lock Screen and widget on the stop Today shows (Visual 2026 V9, D-DV25). Mounted once, in
 * the signed-in tab shell (`app/(tabs)/_layout.tsx`), so it runs whichever tab is open. The shell
 * hands it the SAME cached facts Today reads: the current load (`bucketLoads(...).current[0]`) and
 * the duty state. Composition stays in `app/`, so this feature imports no other feature
 * (`lint:boundaries`).
 *
 * It re-reads the clock once a minute and whenever the app comes to the front, the two moments a
 * phase change can be noticed; the model makes an unchanged minute a no-op.
 *
 * `known` is false until the shift has loaded: "no shift data yet" is not "off duty", and acting on
 * it would end a running Live Activity at every cold start.
 */
export function useGlanceSync(input: { known: boolean; onDuty: boolean; currentLoad: Load | null }): void {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    const front = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNow(Date.now());
    });
    return () => {
      clearInterval(tick);
      front.remove();
    };
  }, []);

  const { known, onDuty, currentLoad } = input;
  const load = glanceStopLoad({ onDuty, currentLoad });

  useEffect(() => {
    if (!known) return;
    syncGlance({ load, onDuty, now });
  }, [known, load, onDuty, now]);
}
