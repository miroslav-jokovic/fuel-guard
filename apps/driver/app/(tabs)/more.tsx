import { useRouter } from 'expo-router';
import { Badge, ListRow, Screen, ScreenHeader, SectionLabel } from '@/components';
import { dutyView, useShift } from '@/features/duty/useDuty';
import { useModules } from '@/session/useModules';

export default function More() {
  const router = useRouter();
  const shift = useShift();
  const duty = dutyView(shift.data);
  const { has } = useModules();

  // Entitlement-gated (D55/D-PM1, the Samsara rule: what an org hasn't bought simply doesn't
  // appear). Entitled → the live hazmat hub; not entitled → the teaser row stays.
  const hazmatEnabled = has('hazmatguard');

  return (
    <Screen>
      <ScreenHeader title="More" />

      {duty.onDuty ? (
        <>
          <SectionLabel>On duty</SectionLabel>
          <ListRow
            icon="local_shipping"
            iconFill
            title={duty.equipmentLabel ?? 'On duty'}
            subtitle={duty.hasTrailer ? 'Truck and trailer' : 'Bobtail — no trailer yet'}
            onPress={() => router.push('/duty/check-in?mode=swap')}
          />
          <ListRow
            icon="logout"
            title="End shift"
            subtitle="Sign off and release your truck"
            onPress={() => router.push('/duty/end-shift')}
          />
        </>
      ) : null}

      {hazmatEnabled ? (
        <>
          <SectionLabel>Work</SectionLabel>
          <ListRow
            title="Hazmat checks"
            subtitle="Capture a BOL, get the compliance verdict"
            icon="local_fire_department"
            onPress={() => router.push('/hazmat' as never)}
          />
        </>
      ) : null}

      <SectionLabel>App</SectionLabel>
      <ListRow
        title="Settings"
        subtitle="Profile, appearance, sign out"
        icon="settings"
        onPress={() => router.push('/settings')}
      />
      {__DEV__ ? (
        <ListRow
          title="Design system"
          subtitle="Component gallery (dev builds only)"
          icon="explore"
          onPress={() => router.push('/gallery')}
        />
      ) : null}

      <SectionLabel>Coming soon</SectionLabel>
      <ListRow
        title="Training"
        subtitle="Safety courses & quizzes"
        icon="school"
        right={<Badge label="Soon" tone="info" />}
      />
      {!hazmatEnabled ? (
        <ListRow
          title="HazmatGuard"
          subtitle="Hazmat documentation in your load flow"
          icon="local_fire_department"
          right={<Badge label="Soon" tone="info" />}
        />
      ) : null}
      <ListRow
        title="Ask FuelGuard"
        subtitle="AI copilot for your loads, route & score"
        icon="bolt"
        right={<Badge label="Soon" tone="info" />}
      />
    </Screen>
  );
}
