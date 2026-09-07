import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import type { DeclineReason, Load } from '@silvicom/shared';
import {
  AppText,
  Banner,
  Card,
  ChoiceSheet,
  ConfirmSheet,
  EmptyState,
  OfflineBanner,
  Screen,
  Section,
  SegmentedControl,
  Skeleton,
} from '@/components';
import { OfferDeck, declineChoices } from '@/features/loads/OfferDeck';
import { CurrentLoadRow, HistoryRow, UpcomingRow } from '@/features/loads/loadRows';
import {
  acceptedUpcoming,
  defaultChip,
  headerSentence,
  orderOffers,
  type LoadChip,
} from '@/features/loads/offerDeckModel';
import { bucketLoads } from '@/features/loads/loadViewModel';
import { useAcceptLoad, useAcceptance, useDeclineLoad, useLoads } from '@/features/loads/useLoads';
import { useFeatures } from '@/session/useFeatures';

const EMPTY: Record<LoadChip, { title: string; subtitle: string }> = {
  offered: { title: 'No offers right now', subtitle: 'Dispatch sends new work here first.' },
  current: { title: 'Nothing in transit', subtitle: 'Accept an upcoming load and start it to see it here.' },
  upcoming: { title: 'No upcoming loads', subtitle: 'New assignments appear here once dispatch releases them.' },
  history: { title: 'No finished loads yet', subtitle: 'Delivered runs stay here for your records.' },
};

/**
 * Loads (D51 — the tab reads "Loads", the page reads Assignments). Only loads dispatch approved and
 * released ever reach this list; the server applies the same predicate the RLS policy does, so there
 * is no client-side idea of a hidden load to get wrong (D45).
 *
 * There is no filter control. The canvas had one and there is nothing behind it — a control that
 * does nothing is worse than no control (D-DB8).
 */
export default function Loads() {
  const router = useRouter();
  const features = useFeatures();
  const enabled = features.enabled('tab.loads');
  const { data, isPending, isError, error, refetch } = useLoads(enabled);
  const { copy } = useAcceptance(enabled);
  const accept = useAcceptLoad();
  const decline = useDeclineLoad(enabled);

  const buckets = bucketLoads(data?.loads ?? []);
  const offers = useMemo(() => orderOffers(buckets.upcoming), [buckets.upcoming]);
  const assigned = useMemo(() => acceptedUpcoming(buckets.upcoming), [buckets.upcoming]);
  const counts = { offered: offers.length, current: buckets.current.length, upcoming: assigned.length };

  const [chosen, setChosen] = useState<LoadChip | null>(null);
  const chip = chosen ?? defaultChip(counts);
  const [decliningLoad, setDecliningLoad] = useState<Load | null>(null);
  const [reason, setReason] = useState<DeclineReason | null>(null);

  const showSkeletons = isPending && !data;

  if (features.isLoaded && !enabled) return <Redirect href="/home" />;

  const hero = (
    <View className="gap-4">
      <View className="gap-1">
        <AppText variant="screenTitle" tone="onHero" accessibilityRole="header">Loads</AppText>
        <AppText variant="supporting" tone="onHeroSecondary">{headerSentence(counts)}</AppText>
      </View>
      <SegmentedControl<LoadChip>
        variant="chips"
        onHero
        value={chip}
        onChange={setChosen}
        options={[
          { label: 'Offered', value: 'offered', ...(counts.offered > 0 ? { count: counts.offered } : {}) },
          { label: 'Current', value: 'current' },
          { label: 'Upcoming', value: 'upcoming', ...(counts.upcoming > 0 ? { count: counts.upcoming } : {}) },
          { label: 'History', value: 'history' },
        ]}
      />
      {chip === 'offered' && offers.length > 0 ? (
        <OfferDeck
          offers={offers}
          copy={copy}
          accepting={accept.isPending}
          onAccept={(load) => void accept.mutateAsync(load.id)}
          onDecline={(load) => setDecliningLoad(load)}
          onOpen={(load) => router.push(`/loads/${load.id}` as never)}
          onHazmat={() => router.push('/hazmat')}
        />
      ) : null}
    </View>
  );

  return (
    <Screen hero={hero} flow="sections">
      <OfflineBanner />

      {isError && !data ? (
        <Section first>
          <Banner
            tone="danger"
            message={error.message || 'Could not load your assignments.'}
            actionLabel="Retry"
            onAction={() => void refetch()}
          />
        </Section>
      ) : null}

      <Section first={!isError || Boolean(data)} title={SECTION_TITLE[chip]}>
        {showSkeletons ? (
          <>
            <Skeleton className="w-full rounded-xl" style={{ height: 72 }} />
            <Skeleton className="w-full rounded-xl" style={{ height: 72 }} />
          </>
        ) : (
          <LoadList
            chip={chip}
            offers={offers}
            assigned={assigned}
            current={buckets.current}
            previous={buckets.previous}
            onOpen={(id) => router.push(`/loads/${id}` as never)}
          />
        )}
      </Section>

      <ChoiceSheet<DeclineReason>
        visible={decliningLoad !== null && reason === null}
        title={copy.secondary}
        message="Dispatch sees the reason you pick."
        choices={declineChoices(copy)}
        onChoose={setReason}
        onCancel={() => setDecliningLoad(null)}
      />

      <ConfirmSheet
        visible={reason !== null}
        tone="danger"
        icon="warning"
        title={copy.secondary}
        message={copy.unassignsOnDecline
          ? 'This load goes back to dispatch and leaves your list.'
          : 'Dispatch will be told you cannot take this one. It stays on your list until they decide.'}
        confirmLabel={copy.secondary}
        loading={decline.isPending}
        onConfirm={() => {
          const picked = reason;
          const load = decliningLoad;
          setReason(null);
          setDecliningLoad(null);
          if (picked && load) void decline.mutateAsync({ loadId: load.id, reason: picked });
        }}
        onCancel={() => setReason(null)}
      />
    </Screen>
  );
}

const SECTION_TITLE: Record<LoadChip, string> = {
  offered: 'Offered to you',
  current: 'In transit',
  upcoming: 'Assigned to you',
  history: 'Finished',
};

function LoadList({
  chip,
  offers,
  assigned,
  current,
  previous,
  onOpen,
}: {
  chip: LoadChip;
  offers: readonly Load[];
  assigned: readonly Load[];
  current: readonly Load[];
  previous: readonly Load[];
  onOpen: (id: string) => void;
}) {
  const rows = { offered: offers, current, upcoming: assigned, history: previous }[chip];
  if (rows.length === 0) {
    return (
      <Card variant="flat" padded={false}>
        <EmptyState icon="local_shipping" title={EMPTY[chip].title} subtitle={EMPTY[chip].subtitle} />
      </Card>
    );
  }
  if (chip === 'current') {
    return (
      <Card variant="flat" padded={false}>
        {current.map((load) => <CurrentLoadRow key={load.id} load={load} onPress={() => onOpen(load.id)} />)}
      </Card>
    );
  }
  if (chip === 'history') {
    return (
      <Card variant="flat" padded={false}>
        {previous.map((load) => <HistoryRow key={load.id} load={load} onPress={() => onOpen(load.id)} />)}
      </Card>
    );
  }
  return (
    <>
      {rows.map((load) => <UpcomingRow key={load.id} load={load} onPress={() => onOpen(load.id)} />)}
    </>
  );
}
