import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { AppText, Badge, Button, Card, Icon } from '@/components';
import { equipmentLine, startShortcut, type StartShortcut } from '@/features/duty/startShortcutModel';
import { useEquipment } from '@/features/duty/useDuty';
import { readLastEquipment, type LastEquipment } from '@/lib/lastEquipment';
import { useFeatures } from '@/session/useFeatures';

/**
 * The pre-shift hero.
 *
 * Most days are the same rig as yesterday, and making a driver walk a two-step wizard to say so was
 * the most-repeated friction in the app. When the remembered truck is still on the roster and still
 * free, this is one tap. When anything at all is uncertain — someone took the truck, the roster has
 * not loaded, the org requires an odometer reading — it falls back to the wizard rather than
 * guessing, because a shortcut that puts a driver in the wrong truck costs far more than it saves.
 * The rules are `startShortcutModel`, which is tested; this reads them.
 */
export function StartDayCard({
  onDuty,
  onStart,
  onChange,
  onQuickStart,
  starting = false,
}: {
  onDuty: boolean;
  onStart: () => void;
  onChange: () => void;
  onQuickStart?: (shortcut: StartShortcut) => void;
  starting?: boolean;
}) {
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

  const shortcut = last && !onDuty ? startShortcut(last, equipment.data, odometerMode) : null;

  if (onDuty) {
    return (
      <Card variant="hero">
        <AppText variant="screenTitle" tone="onHero">Nothing to drive yet</AppText>
        <AppText variant="supporting" tone="onHeroSecondary">
          You are on duty. A released load will appear here the moment dispatch sends it.
        </AppText>
        <View className="pt-1">
          <Button
            label="Change truck or trailer"
            icon="route"
            variant="secondary"
            size="lg"
            onHero
            onPress={onChange}
          />
        </View>
      </Card>
    );
  }

  if (!shortcut || !onQuickStart) {
    return (
      <Card variant="hero">
        <AppText variant="screenTitle" tone="onHero">Confirm your equipment</AppText>
        <AppText variant="supporting" tone="onHeroSecondary">
          Tell us the truck and trailer you are using, and the day starts.
        </AppText>
        <View className="pt-1">
          {/* Unconditional again: Today drops this whole card in recovery, so by the time it
              renders the app knows what it is starting from. The guard that used to live here is
              gone because the state it defended against can no longer reach it. */}
          <Button label="Confirm equipment" icon="play_circle" variant="hero" size="lg" onPress={onStart} />
        </View>
      </Card>
    );
  }

  return (
    <Card variant="hero">
      {/* No "START YOUR DAY" overline (D-DB12): the question is the heading and needs no kicker. */}
      <AppText variant="screenTitle" tone="onHero">Same rig as yesterday?</AppText>

      <View className="gap-2 pt-1">
        <RigRow
          icon="local_shipping"
          title={equipmentLine(shortcut.vehicle)}
          badge="Free"
        />
        <RigRow
          icon="route"
          title={shortcut.trailer ? equipmentLine(shortcut.trailer) : 'Bobtail — no trailer'}
          badge={shortcut.trailer ? 'Free' : undefined}
        />
      </View>

      <View className="gap-2 pt-2">
        <Button
          label="Start with this equipment"
          icon="play_circle"
          variant="hero"
          size="lg"
          loading={starting}
          haptic="success"
          onPress={() => onQuickStart(shortcut)}
        />
        <Button label="Choose different truck or trailer" variant="ghost" onHero onPress={onStart} />
      </View>
    </Card>
  );
}

function RigRow({ icon, title, badge }: { icon: 'local_shipping' | 'route'; title: string; badge?: string }) {
  return (
    <View className="flex-row items-center gap-3">
      <View className="h-11 w-11 items-center justify-center rounded-full bg-hero-tile">
        <Icon name={icon} size={20} className="text-on-hero-secondary" />
      </View>
      <AppText variant="rowTitle" tone="onHero" className="flex-1" numberOfLines={1}>{title}</AppText>
      {badge ? <Badge label={badge} tone="ghost" /> : null}
    </View>
  );
}
