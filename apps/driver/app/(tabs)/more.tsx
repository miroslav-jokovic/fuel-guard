import { useRouter } from 'expo-router';
import { GroupedList, ListRow, Screen, ScreenHeader, SectionLabel } from '@/components';
import { dutyView, useShift } from '@/features/duty/useDuty';
import { useFeatures } from '@/session/useFeatures';

export default function More() {
  const router = useRouter();
  const shift = useShift();
  const duty = dutyView(shift.data);
  const { enabled } = useFeatures();
  const hazmatEnabled = enabled('hazmat.capture');

  return (
    <Screen>
      <ScreenHeader title="More" subtitle="Support, tools, and account" />

      {duty.onDuty ? (
        <>
          <SectionLabel>Current shift</SectionLabel>
          <GroupedList>
            <ListRow
              icon="local_shipping"
              iconFill
              title={duty.equipmentLabel ?? 'On duty'}
              subtitle={duty.hasTrailer ? 'Truck and trailer confirmed' : 'Bobtail · no trailer'}
              onPress={() => router.push('/duty/check-in?mode=swap')}
            />
            <ListRow
              icon="logout"
              title="End shift"
              subtitle="Sign off and release your equipment"
              onPress={() => router.push('/duty/end-shift')}
            />
          </GroupedList>
        </>
      ) : null}

      {hazmatEnabled ? (
        <>
          <SectionLabel>Work tools</SectionLabel>
          <GroupedList>
            <ListRow
              title="Hazmat checks"
              subtitle="Capture a BOL and review compliance results"
              icon="local_fire_department"
              onPress={() => router.push('/hazmat')}
            />
          </GroupedList>
        </>
      ) : null}

      <SectionLabel>App</SectionLabel>
      <GroupedList>
        <ListRow
          title="Settings"
          subtitle="Appearance, sync, account, and diagnostics"
          icon="settings"
          onPress={() => router.push('/settings')}
        />
        {__DEV__ ? (
          <ListRow
            title="Design system"
            subtitle="Component gallery · development builds"
            icon="explore"
            onPress={() => router.push('/gallery')}
          />
        ) : null}
      </GroupedList>
    </Screen>
  );
}
