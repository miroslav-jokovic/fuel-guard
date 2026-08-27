import { useEffect, useMemo, useState } from 'react';
import { Keyboard, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { EquipmentOption } from '@silvicom/shared';
import {
  ActionBar,
  AppText,
  Badge,
  Banner,
  Button,
  ConfirmSheet,
  EmptyState,
  Field,
  GroupedList,
  Icon,
  Input,
  ListRow,
  NumericField,
  Screen,
  ScreenHeader,
  SectionLabel,
  Skeleton,
  TaskStepper,
} from '@/components';
import {
  dutyView,
  useChangeEquipment,
  useEquipment,
  useShift,
  useStartShift,
} from '@/features/duty/useDuty';
import {
  canSubmit,
  chooseBobtail,
  filterEquipment,
  goBack,
  hasChanges,
  initialState,
  keepTrailer,
  keepVehicle,
  odometerValue,
  rankEquipment,
  selectTrailer,
  selectVehicle,
  stepperSteps,
  type CheckInMode,
  type CheckInState,
} from '@/features/duty/checkInModel';
import { readLastEquipment, writeLastEquipment } from '@/lib/lastEquipment';
import { useFeatures } from '@/session/useFeatures';
import { haptics } from '@/lib/haptics';

function unitSubtitle(o: EquipmentOption): string | undefined {
  const make = [o.make, o.model].filter(Boolean).join(' ');
  if (o.in_use_by) return `In use by ${o.in_use_by}`;
  return make || undefined;
}

/** One roster row — shared by both steps so selection affordances stay identical. */
function EquipmentRow({
  option,
  icon,
  selected,
  onPress,
}: {
  option: EquipmentOption;
  icon: 'local_shipping' | 'route';
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <ListRow
      icon={icon}
      iconFill={selected}
      title={`${icon === 'route' ? 'Trailer' : 'Unit'} ${option.unit_number}`}
      subtitle={unitSubtitle(option)}
      onPress={onPress}
      right={
        selected ? (
          <Icon name="check_circle" size={22} className="text-brand" />
        ) : option.in_use_by ? (
          <Badge label="In use" tone="caution" icon="person" />
        ) : option.is_default ? (
          <Badge label="Your truck" tone="brand" />
        ) : undefined
      }
    />
  );
}

/**
 * The check-in sheet (D44), rebuilt as a TRUE three-step wizard (hardening plan Phase 1): the old
 * single-scroll layout had a stepper that implied progression but one shared search box filtering
 * both rosters — selecting a truck after a search left the trailer list invisibly empty. Now each
 * step owns its search (cleared on advance), selection ADVANCES the wizard, every filtered list has
 * an empty state, and the primary action is pinned in the screen footer, never below the fold.
 *
 * Two modes on one screen because they are the same decision: `start` opens a shift, `swap` records
 * a drop-and-hook or truck change mid-shift without ending it (step 1 offers "keep your truck").
 */
export default function CheckIn() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: CheckInMode }>();
  const mode: CheckInMode = params.mode === 'swap' ? 'swap' : 'start';

  const shift = useShift();
  const equipment = useEquipment();
  const duty = dutyView(shift.data);
  const swapUnavailable = mode === 'swap' && shift.isError && !shift.data;
  const startShift = useStartShift();
  const changeEquipment = useChangeEquipment();

  const [s, setS] = useState<CheckInState>(initialState);
  const [search, setSearch] = useState('');
  const [odometer, setOdometer] = useState('');
  const [takeOver, setTakeOver] = useState<{ option: EquipmentOption; kind: 'vehicle' | 'trailer' } | null>(null);
  const [lastUsed, setLastUsed] = useState<{ vehicleId: string | null; trailerId: string | null }>({
    vehicleId: null,
    trailerId: null,
  });

  useEffect(() => {
    void readLastEquipment().then(setLastUsed);
  }, []);

  /** Every step transition clears the step-scoped search and drops the keyboard. */
  const advance = (next: CheckInState) => {
    setSearch('');
    Keyboard.dismiss();
    haptics.select();
    setS(next);
  };

  const vehicles = useMemo(
    () => filterEquipment(rankEquipment(equipment.data?.vehicles ?? [], lastUsed.vehicleId), search),
    [equipment.data?.vehicles, lastUsed.vehicleId, search],
  );
  const trailers = useMemo(
    () => filterEquipment(rankEquipment(equipment.data?.trailers ?? [], lastUsed.trailerId), search),
    [equipment.data?.trailers, lastUsed.trailerId, search],
  );

  const loading = equipment.isPending && !equipment.data;
  // Dashboard-controlled behavior (Phase 4, D-PM2): odometer off/optional/required and whether
  // take-over is allowed at all, resolved server-side and cached with the bootstrap.
  const { odometerMode, takeoverAllowed } = useFeatures();
  const [heldNotice, setHeldNotice] = useState<string | null>(null);

  const pick = (option: EquipmentOption, kind: 'vehicle' | 'trailer') => {
    // Never a silent steal (D44.6) — the driver is shown who holds it and decides. The tap site
    // carries `kind`, so the confirm can never misclassify a unit from a re-filtered list.
    if (option.in_use_by) {
      if (!takeoverAllowed) {
        // Org policy: no self-serve take-over — dispatch reassigns instead (duty.takeover off).
        setHeldNotice(
          `Unit ${option.unit_number} is checked out to ${option.in_use_by}. Your fleet has take-over disabled — ask dispatch to reassign it.`,
        );
        return;
      }
      setTakeOver({ option, kind });
      return;
    }
    setHeldNotice(null);
    advance(kind === 'vehicle' ? selectVehicle(s, option) : selectTrailer(s, option));
  };

  const confirmTakeOver = () => {
    const t = takeOver;
    setTakeOver(null);
    if (!t) return;
    setHeldNotice(null);
    advance(t.kind === 'vehicle' ? selectVehicle(s, t.option) : selectTrailer(s, t.option));
  };

  const submit = async () => {
    const tookOver = Boolean(s.vehicle?.in_use_by ?? s.trailer?.in_use_by);
    const odo = odometerValue(odometer);

    if (mode === 'start' && s.vehicle) {
      await startShift.mutateAsync({
        vehicleId: s.vehicle.id,
        vehicleUnit: s.vehicle.unit_number,
        trailerId: s.trailer?.id ?? null,
        trailerUnit: s.trailer?.unit_number ?? null,
        ...(odometerMode !== 'off' && odo !== undefined ? { startOdometer: odo } : {}),
        takeOver: tookOver,
      });
    } else {
      await changeEquipment.mutateAsync({
        ...(s.vehicle ? { vehicleId: s.vehicle.id, vehicleUnit: s.vehicle.unit_number } : {}),
        ...(s.trailer ? { trailerId: s.trailer.id, trailerUnit: s.trailer.unit_number } : {}),
        clearTrailer: s.bobtail,
        takeOver: tookOver,
      });
    }
    void writeLastEquipment({
      ...(s.vehicle ? { vehicleId: s.vehicle.id } : {}),
      ...(s.trailer ? { trailerId: s.trailer.id } : {}),
    });
    router.back();
  };

  // ── step content ──────────────────────────────────────────────────────────
  const summaryVehicle = s.vehicle
    ? `Unit ${s.vehicle.unit_number}`
    : s.keptVehicle
      ? (duty.equipmentLabel ?? 'Current truck')
      : '—';
  const summaryTrailer = s.trailer
    ? `Trailer ${s.trailer.unit_number}`
    : s.bobtail
      ? 'Bobtail — no trailer'
      : s.keptTrailer
        ? 'Unchanged'
        : '—';

  const searchBox = (
    <Input
      accessibilityLabel="Search equipment by unit number"
      placeholder="Search by unit number"
      value={search}
      onChangeText={setSearch}
      autoCapitalize="characters"
      autoCorrect={false}
      returnKeyType="search"
    />
  );

  const rosterSkeleton = (
    <View className="gap-2">
      <Skeleton className="h-[60px] w-full rounded-xl" />
      <Skeleton className="h-[60px] w-full rounded-xl" />
    </View>
  );

  return (
    <Screen
      padTop={false}
      footer={
        s.step === 'confirm' ? (
          <ActionBar>
            <Button
              label={mode === 'swap' ? 'Save equipment' : 'Start my shift'}
              size="lg"
              icon="check"
              disabled={swapUnavailable || !canSubmit(s, mode, odometerMode, odometer)}
              loading={startShift.isPending || changeEquipment.isPending}
              haptic="success"
              onPress={() => void submit()}
            />
            <AppText variant="caption" tone="subtle" className="pb-1 text-center">
              Works offline — this syncs when you get signal.
            </AppText>
          </ActionBar>
        ) : undefined
      }
    >
      <ScreenHeader
        title={mode === 'swap' ? 'Change equipment' : 'Start your day'}
        subtitle={
          mode === 'swap'
            ? (duty.equipmentLabel ?? 'Update your truck or trailer')
            : 'Confirm what you are driving'
        }
        onBack={s.step !== 'truck' ? () => setS(goBack(s)) : undefined}
        onClose={() => router.back()}
      />

      <TaskStepper steps={stepperSteps(s, mode)} />

      {equipment.isError && !equipment.data ? (
        <Banner
          tone="danger"
          message="Could not load your fleet list. You can still work offline once you have checked in."
          actionLabel="Retry"
          onAction={() => void equipment.refetch()}
        />
      ) : null}
      {swapUnavailable ? (
        <Banner
          tone="danger"
          message="Could not verify your current shift. Retry before changing equipment."
          actionLabel="Retry"
          onAction={() => void shift.refetch()}
        />
      ) : null}
      {heldNotice ? <Banner tone="info" message={heldNotice} /> : null}

      {s.step === 'truck' ? (
        <>
          <SectionLabel>{mode === 'swap' ? 'Pick a truck' : 'Your truck'}</SectionLabel>
          {mode === 'swap' ? (
            <GroupedList>
              <ListRow
                icon="local_shipping"
                iconFill
                title="Keep your truck"
                subtitle={duty.equipmentLabel ?? undefined}
                onPress={() => advance(keepVehicle(s))}
                right={<Icon name="arrow_forward" size={20} className="text-ink-muted" />}
              />
            </GroupedList>
          ) : null}
          {searchBox}
          {loading ? (
            rosterSkeleton
          ) : vehicles.length === 0 ? (
            <EmptyState
              icon="local_shipping"
              title={search ? 'No trucks match' : 'No trucks found'}
              subtitle={
                search
                  ? 'Clear the search to see the full list.'
                  : 'Ask dispatch to add your truck to the fleet.'
              }
            />
          ) : (
            <GroupedList>
              {vehicles.map((v) => (
                <EquipmentRow
                  key={v.id}
                  option={v}
                  icon="local_shipping"
                  selected={s.vehicle?.id === v.id}
                  onPress={() => pick(v, 'vehicle')}
                />
              ))}
            </GroupedList>
          )}
        </>
      ) : null}

      {s.step === 'trailer' ? (
        <>
          <SectionLabel>Trailer</SectionLabel>
          {/* "Not hooked yet" is a first-class answer, not an empty state (D44.2). */}
          <GroupedList>
            <ListRow
              icon="route"
              title="Bobtail — no trailer yet"
              subtitle="You can add one later without ending your shift"
              onPress={() => advance(chooseBobtail(s))}
              right={s.bobtail ? <Icon name="check_circle" size={22} className="text-brand" /> : undefined}
            />
            {mode === 'swap' ? (
              <ListRow
                icon="route"
                title="Keep current trailer"
                subtitle="No drop-and-hook this stop"
                onPress={() => advance(keepTrailer(s))}
                right={<Icon name="arrow_forward" size={20} className="text-ink-muted" />}
              />
            ) : null}
          </GroupedList>
          {searchBox}
          {loading ? (
            rosterSkeleton
          ) : trailers.length === 0 ? (
            <EmptyState
              icon="route"
              title={search ? 'No trailers match' : 'No trailers in the fleet'}
              subtitle={search ? 'Clear the search, or go bobtail for now.' : 'Go bobtail for now.'}
            />
          ) : (
            <GroupedList>
              {trailers.map((t) => (
                <EquipmentRow
                  key={t.id}
                  option={t}
                  icon="route"
                  selected={s.trailer?.id === t.id}
                  onPress={() => pick(t, 'trailer')}
                />
              ))}
            </GroupedList>
          )}
        </>
      ) : null}

      {s.step === 'confirm' ? (
        <>
          <SectionLabel>{mode === 'swap' ? 'Review change' : 'Review'}</SectionLabel>
          <GroupedList>
            <ListRow
              icon="local_shipping"
              iconFill
              title={summaryVehicle}
              subtitle="Truck"
              onPress={() => setS({ ...s, step: 'truck' })}
              right={<Icon name="edit" size={18} className="text-ink-muted" />}
            />
            <ListRow
              icon="route"
              iconFill={Boolean(s.trailer)}
              title={summaryTrailer}
              subtitle="Trailer"
              onPress={() => setS({ ...s, step: 'trailer' })}
              right={<Icon name="edit" size={18} className="text-ink-muted" />}
            />
          </GroupedList>
          {mode === 'swap' && !hasChanges(s, mode) ? (
            <Banner tone="info" message="Nothing changed yet — pick a different truck or trailer to save." />
          ) : null}
          {mode === 'start' && odometerMode !== 'off' ? (
            <>
              <SectionLabel>
                {odometerMode === 'required' ? 'Odometer' : 'Odometer (optional)'}
              </SectionLabel>
              <Field label="Starting odometer" hint="Anchors your MPG and idle numbers for the shift">
                <NumericField value={odometer} onChangeText={setOdometer} unit="mi" placeholder="412003" />
              </Field>
            </>
          ) : null}
        </>
      ) : null}

      <ConfirmSheet
        visible={takeOver !== null}
        tone="caution"
        icon="warning"
        title={`Unit ${takeOver?.option.unit_number ?? ''} is checked out`}
        message={`${takeOver?.option.in_use_by ?? 'Another driver'} has had it since ${
          takeOver?.option.in_use_since
            ? new Date(takeOver.option.in_use_since).toLocaleTimeString(undefined, {
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
