import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { EquipmentOption } from '@fuelguard/shared';
import {
  ActionBar,
  Badge,
  Banner,
  Button,
  ConfirmSheet,
  EmptyState,
  Field,
  Icon,
  Input,
  ListRow,
  NumericField,
  Screen,
  ScreenHeader,
  SectionLabel,
  Skeleton,
  TaskStepper,
  type TaskStep,
} from '@/components';
import {
  dutyView,
  useChangeEquipment,
  useEquipment,
  useShift,
  useStartShift,
} from '@/features/duty/useDuty';

type Mode = 'start' | 'swap';

/** Filter a roster by unit number — the only search a driver ever needs here. */
function useFiltered(options: EquipmentOption[], query: string): EquipmentOption[] {
  return useMemo(() => {
    const q = query.trim().toLowerCase();
    const ranked = [...options].sort((a, b) => {
      // "Your truck" first, then anything free, then held units — a driver should have to work to
      // take someone else's unit, not stumble into it.
      if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
      const aHeld = a.in_use_by !== null;
      const bHeld = b.in_use_by !== null;
      if (aHeld !== bHeld) return aHeld ? 1 : -1;
      return a.unit_number.localeCompare(b.unit_number, undefined, { numeric: true });
    });
    if (!q) return ranked;
    return ranked.filter(
      (o) =>
        o.unit_number.toLowerCase().includes(q) ||
        (o.make ?? '').toLowerCase().includes(q) ||
        (o.model ?? '').toLowerCase().includes(q),
    );
  }, [options, query]);
}

function unitSubtitle(o: EquipmentOption): string | undefined {
  const make = [o.make, o.model].filter(Boolean).join(' ');
  if (o.in_use_by) return `In use by ${o.in_use_by}`;
  return make || undefined;
}

/**
 * The check-in sheet (D44). A modal route over the shell, not a tab and not a login wall.
 *
 * Two modes on one screen because they are the same decision: `start` opens a shift, `swap` records
 * a drop-and-hook or a truck change mid-shift without ending it. Both reach the driver in ≤2 taps
 * from Home, which matters because a swap happens at a dock, in a hurry, in gloves.
 */
export default function CheckIn() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: Mode }>();
  const mode: Mode = params.mode === 'swap' ? 'swap' : 'start';

  const shift = useShift();
  const equipment = useEquipment();
  const duty = dutyView(shift.data);
  const startShift = useStartShift();
  const changeEquipment = useChangeEquipment();

  const [vehicle, setVehicle] = useState<EquipmentOption | null>(null);
  const [trailer, setTrailer] = useState<EquipmentOption | null>(null);
  const [bobtail, setBobtail] = useState(false);
  const [odometer, setOdometer] = useState('');
  const [search, setSearch] = useState('');
  const [takeOver, setTakeOver] = useState<EquipmentOption | null>(null);

  const vehicles = useFiltered(equipment.data?.vehicles ?? [], search);
  const trailers = useFiltered(equipment.data?.trailers ?? [], search);

  const loading = equipment.isPending && !equipment.data;
  // Vehicle is required to be on duty at all; in swap mode the driver already has one.
  const canConfirm = mode === 'swap' ? Boolean(vehicle ?? trailer ?? bobtail) : Boolean(vehicle);
  const equipmentSteps: TaskStep[] = mode === 'swap'
    ? [
        { label: 'Truck', state: vehicle ? 'complete' : 'current' },
        { label: 'Trailer', state: vehicle && (trailer || bobtail) ? 'complete' : vehicle ? 'current' : 'upcoming' },
        { label: 'Save', state: vehicle && (trailer || bobtail) ? 'current' : 'upcoming' },
      ]
    : [
        { label: 'Truck', state: vehicle ? 'complete' : 'current' },
        { label: 'Trailer', state: vehicle && (trailer || bobtail) ? 'complete' : vehicle ? 'current' : 'upcoming' },
        { label: 'Odometer', state: vehicle && (trailer || bobtail) ? 'current' : 'upcoming' },
      ];

  const pick = (option: EquipmentOption, kind: 'vehicle' | 'trailer') => {
    // Never a silent steal (D44.6) — the driver is shown who holds it and decides.
    if (option.in_use_by) {
      setTakeOver(option);
      return;
    }
    if (kind === 'vehicle') setVehicle(option);
    else {
      setTrailer(option);
      setBobtail(false);
    }
  };

  const confirmTakeOver = () => {
    const option = takeOver;
    setTakeOver(null);
    if (!option) return;
    const isVehicle = vehicles.some((v) => v.id === option.id);
    if (isVehicle) setVehicle(option);
    else {
      setTrailer(option);
      setBobtail(false);
    }
  };

  const submit = async () => {
    const odo = Number.parseFloat(odometer);
    const tookOver = Boolean(
      vehicle?.in_use_by ?? trailer?.in_use_by,
    );

    if (mode === 'start' && vehicle) {
      await startShift.mutateAsync({
        vehicleId: vehicle.id,
        vehicleUnit: vehicle.unit_number,
        trailerId: trailer?.id ?? null,
        trailerUnit: trailer?.unit_number ?? null,
        ...(Number.isFinite(odo) && odo > 0 ? { startOdometer: odo } : {}),
        takeOver: tookOver,
      });
    } else {
      await changeEquipment.mutateAsync({
        ...(vehicle ? { vehicleId: vehicle.id, vehicleUnit: vehicle.unit_number } : {}),
        ...(trailer ? { trailerId: trailer.id, trailerUnit: trailer.unit_number } : {}),
        clearTrailer: bobtail,
        takeOver: tookOver,
      });
    }
    router.back();
  };

  return (
    <Screen>
      <ScreenHeader
        title={mode === 'swap' ? 'Change equipment' : 'Start your day'}
        subtitle={
          mode === 'swap'
            ? duty.equipmentLabel ?? 'Update your truck or trailer'
            : 'Confirm what you are driving'
        }
        onClose={() => router.back()}
      />

      <TaskStepper steps={equipmentSteps} />

      {equipment.isError && !equipment.data ? (
        <Banner
          tone="danger"
          message="Could not load your fleet list. You can still work offline once you have checked in."
          actionLabel="Retry"
          onAction={() => void equipment.refetch()}
        />
      ) : null}

      <Input
        placeholder="Search by unit number"
        value={search}
        onChangeText={setSearch}
        autoCapitalize="characters"
        autoCorrect={false}
        returnKeyType="search"
      />

      <SectionLabel>{mode === 'swap' ? 'Truck (leave to keep yours)' : 'Truck'}</SectionLabel>
      {loading ? (
        <View className="gap-2">
          <Skeleton className="h-[60px] w-full rounded-xl" />
          <Skeleton className="h-[60px] w-full rounded-xl" />
        </View>
      ) : vehicles.length === 0 ? (
        <EmptyState
          icon="local_shipping"
          title="No trucks found"
          subtitle="Nothing matches that unit number."
        />
      ) : (
        vehicles.map((v) => (
          <ListRow
            key={v.id}
            icon="local_shipping"
            iconFill={vehicle?.id === v.id}
            title={`Unit ${v.unit_number}`}
            subtitle={unitSubtitle(v)}
            onPress={() => pick(v, 'vehicle')}
            right={
              vehicle?.id === v.id ? (
                <Icon name="check_circle" size={22} className="text-brand" />
              ) : v.in_use_by ? (
                <Badge label="In use" tone="caution" icon="person" />
              ) : v.is_default ? (
                <Badge label="Your truck" tone="brand" />
              ) : undefined
            }
          />
        ))
      )}

      <SectionLabel>Trailer</SectionLabel>
      {/* "Not hooked yet" is a first-class answer, not an empty state — the trailer is often unknown
          until the driver reaches the shipper (D44.2). */}
      <ListRow
        icon="route"
        title="Bobtail — no trailer yet"
        subtitle="You can add one later without ending your shift"
        onPress={() => {
          setBobtail(true);
          setTrailer(null);
        }}
        right={
          bobtail ? <Icon name="check_circle" size={22} className="text-brand" /> : undefined
        }
      />
      {loading ? (
        <Skeleton className="h-[60px] w-full rounded-xl" />
      ) : (
        trailers.map((t) => (
          <ListRow
            key={t.id}
            icon="route"
            title={`Trailer ${t.unit_number}`}
            subtitle={unitSubtitle(t)}
            onPress={() => pick(t, 'trailer')}
            right={
              trailer?.id === t.id ? (
                <Icon name="check_circle" size={22} className="text-brand" />
              ) : t.in_use_by ? (
                <Badge label="In use" tone="caution" icon="person" />
              ) : undefined
            }
          />
        ))
      )}

      {mode === 'start' ? (
        <>
          <SectionLabel>Odometer (optional)</SectionLabel>
          <Field label="Starting odometer" hint="Anchors your MPG and idle numbers for the shift">
            <NumericField
              value={odometer}
              onChangeText={setOdometer}
              unit="mi"
              placeholder="412003"
            />
          </Field>
        </>
      ) : null}

      <ActionBar>
        <Button
          label={mode === 'swap' ? 'Save equipment' : 'Start my shift'}
        size="lg"
        icon="check"
        disabled={!canConfirm}
        loading={startShift.isPending || changeEquipment.isPending}
        haptic="success"
        onPress={() => void submit()}
      />
        <Text className="pb-2 text-center text-xs text-ink-subtle">
          Works offline — this syncs when you get signal.
        </Text>
      </ActionBar>

      <ConfirmSheet
        visible={takeOver !== null}
        tone="caution"
        icon="warning"
        title={`Unit ${takeOver?.unit_number ?? ''} is checked out`}
        message={`${takeOver?.in_use_by ?? 'Another driver'} has had it since ${
          takeOver?.in_use_since
            ? new Date(takeOver.in_use_since).toLocaleTimeString(undefined, {
                hour: '2-digit',
                minute: '2-digit',
              })
            : 'earlier today'
        }. Taking it over ends their shift and tells dispatch.`}
        confirmLabel="Take it over"
        cancelLabel="Pick another"
        onConfirm={confirmTakeOver}
        onCancel={() => setTakeOver(null)}
      />
    </Screen>
  );
}
