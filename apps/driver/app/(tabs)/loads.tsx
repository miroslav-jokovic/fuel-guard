import { useState } from 'react';
import { Redirect, useRouter } from 'expo-router';
import type { DeclineReason, Load } from '@silvicom/shared';
import {
  Banner,
  ChoiceSheet,
  ConfirmSheet,
  EmptyState,
  OfflineBanner,
  Screen,
  ScreenHeader,
  Section,
  Skeleton,
} from '@/components';
import { OfferDeck, declineChoices } from '@/features/loads/OfferDeck';
import { LoadRows } from '@/features/loads/LoadRows';
import { loadsListView } from '@/features/loads/loadsListModel';
import { useAcceptLoad, useAcceptance, useDeclineLoad, useLoads } from '@/features/loads/useLoads';
import { useFeatures } from '@/session/useFeatures';

/**
 * Loads (D51 — the tab reads "Loads", the page reads Assignments). Only loads dispatch approved and
 * released ever reach this list; the server applies the same predicate the RLS policy does, so there
 * is no client-side idea of a hidden load to get wrong (D45).
 *
 * Visual 2026 V6 (the V1 mock's screen 4): the title, the offers (the one thing here somebody is
 * waiting on), then every other load grouped by TIME (Now, Next, Delivered this week, Earlier) as
 * rows on the canvas. Direction B grouped by status behind four chips over a navy hero, so a driver
 * had to know which chip a load was filed under to find it. The grouping is `loadsListModel`.
 */
export default function Loads() {
  const router = useRouter();
  const features = useFeatures();
  const enabled = features.enabled('tab.loads');
  const { data, isPending, isError, error, refetch } = useLoads(enabled);
  const { copy } = useAcceptance(enabled);
  const accept = useAcceptLoad();
  const decline = useDeclineLoad(enabled);
  const [decliningLoad, setDecliningLoad] = useState<Load | null>(null);
  const [reason, setReason] = useState<DeclineReason | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  if (features.isLoaded && !enabled) return <Redirect href="/home" />;

  const view = loadsListView(data?.loads ?? []);
  const open = (id: string) => router.push(`/loads/${id}` as never);
  const nothing = view.offers.length === 0 && view.groups.length === 0;

  return (
    <Screen
      flow="sections"
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void refetch().finally(() => setRefreshing(false));
      }}
    >
      <ScreenHeader title="Loads" />
      <OfflineBanner />

      {isError && !data ? (
        <Section>
          <Banner
            tone="danger"
            message={error.message || 'Could not load your assignments.'}
            actionLabel="Retry"
            onAction={() => void refetch()}
          />
        </Section>
      ) : null}

      {isPending && !data ? (
        <Section>
          <Skeleton className="w-full rounded-xl" style={{ height: 64 }} />
          <Skeleton className="w-full rounded-xl" style={{ height: 64 }} />
        </Section>
      ) : null}

      {view.offers.length > 0 ? (
        <Section title={view.offers.length === 1 ? 'Offered to you' : `Offered to you · ${view.offers.length}`}>
          <OfferDeck
            offers={view.offers}
            copy={copy}
            accepting={accept.isPending}
            onAccept={(load) => void accept.mutateAsync(load.id)}
            onDecline={(load) => setDecliningLoad(load)}
            onOpen={(load) => open(load.id)}
            onHazmat={() => router.push('/documents')}
          />
        </Section>
      ) : null}

      {view.groups.map((group) => (
        <Section key={group.key} title={group.title}>
          <LoadRows rows={group.rows} onOpen={open} />
        </Section>
      ))}

      {data && nothing ? (
        <Section>
          <EmptyState
            icon="local_shipping"
            title="No loads yet"
            subtitle="Released loads from dispatch appear here, and delivered ones stay for your records."
          />
        </Section>
      ) : null}

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
