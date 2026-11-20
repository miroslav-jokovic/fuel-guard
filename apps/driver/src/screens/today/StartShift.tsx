import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { ActionBar, Button, useToast } from '@/components';
import { startShortcut, type StartShortcut } from '@/features/duty/startShortcutModel';
import { useEquipment, useStartShift } from '@/features/duty/useDuty';
import { readLastEquipment, writeLastEquipment, type LastEquipment } from '@/lib/lastEquipment';
import { useFeatures } from '@/session/useFeatures';

/**
 * The one-tap start (formerly `StartDayCard`, Direction B's pre-shift hero).
 *
 * Most days are the same rig as yesterday, and making a driver walk a two-step wizard to say so was
 * the most-repeated friction in the app. When the remembered truck is still on the roster and still
 * free, this is one tap. When anything at all is uncertain (someone took the truck, the roster has not
 * loaded, the org requires an odometer reading) it is null, and Start shift opens the check-in rather
 * than guessing, because a shortcut that puts a driver in the wrong truck costs far more than it
 * saves. The rules are `startShortcutModel`, which is tested; this reads them.
 */
export function useStartShortcut(enabled: boolean): StartShortcut | null {
  const { odometerMode } = useFeatures();
  const equipment = useEquipment();
  const [last, setLast] = useState<LastEquipment | null>(null);

  useEffect(() => {
    let active = true;
    void readLastEquipment().then((v) => {
      if (active) setLast(v);
    });
    return () => {
      active = false;
    };
  }, []);

  return enabled && last ? startShortcut(last, equipment.data, odometerMode) : null;
}

/**
 * The pre-shift screen's one amber action, pinned in the bottom third (D-DV10, the mock's screen 9).
 * With a shortcut it starts the shift in the rig the "Before you start" row names; without one it
 * opens the check-in. Choosing a different rig is that row's "Change", so there is no second button.
 */
export function StartShiftBar({ shortcut }: { shortcut: StartShortcut | null }) {
  const router = useRouter();
  const startShift = useStartShift();
  const toast = useToast();

  const quickStart = (s: StartShortcut) => {
    void startShift
      .mutateAsync({
        vehicleId: s.vehicle.id,
        vehicleUnit: s.vehicle.unit_number,
        ...(s.trailer ? { trailerId: s.trailer.id, trailerUnit: s.trailer.unit_number } : {}),
        takeOver: false,
      })
      .then(() => {
        // Remember what actually started the day, so tomorrow's shortcut is right even when today's
        // differed from yesterday's.
        void writeLastEquipment({ vehicleId: s.vehicle.id, trailerId: s.trailer?.id ?? null });
        toast.show(`On duty · Unit ${s.vehicle.unit_number}`);
      });
  };

  return (
    <ActionBar>
      <Button
        label="Start shift"
        icon="play_circle"
        variant="primary"
        size="lg"
        haptic="success"
        loading={startShift.isPending}
        onPress={() => (shortcut ? quickStart(shortcut) : router.push('/duty/check-in'))}
      />
    </ActionBar>
  );
}
