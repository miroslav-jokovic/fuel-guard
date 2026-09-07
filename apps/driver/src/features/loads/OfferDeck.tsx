import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { DECLINE_REASON_LABELS, type AcceptanceCopy, type Load } from '@silvicom/shared';
import { AppText, Badge, Button, Card } from '@/components';
import { placeLabel } from './loadViewModel';
import { backers } from './offerDeckModel';
import { useTheme } from '@/theme/ThemeProvider';
import { layout, motion } from '@/theme/tokens';
import { useWindowDimensions } from 'react-native';

/**
 * The offers, as a deck (D-DB7 — Loads' one signature moment).
 *
 * An offer is a decision, not a listing: dispatch is waiting on an answer, and the answer is on the
 * card rather than two taps away inside the load. The plates behind the front card say how many are
 * waiting without the driver counting rows.
 */
export function OfferDeck({
  offers,
  copy,
  accepting,
  onAccept,
  onDecline,
  onOpen,
  onHazmat,
}: {
  offers: readonly Load[];
  copy: AcceptanceCopy;
  accepting: boolean;
  onAccept: (load: Load) => void;
  onDecline: (load: Load) => void;
  onOpen: (load: Load) => void;
  onHazmat: () => void;
}) {
  const { reduceMotion } = useTheme();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale >= layout.largeTextBreakpoint;
  const front = offers[0];
  const plates = backers(offers.length);

  // The deck advances on Accept or Decline: the next card arrives rather than the list re-flowing,
  // so the driver's eye stays where the decision is.
  const enter = useSharedValue(1);
  const frontId = front?.id ?? null;
  useEffect(() => {
    if (reduceMotion || frontId === null) {
      enter.value = 1;
      return;
    }
    enter.value = 0;
    enter.value = withSpring(1, { damping: 24, stiffness: 320 });
  }, [frontId, reduceMotion, enter]);
  const enterStyle = useAnimatedStyle(() => ({
    opacity: reduceMotion ? 1 : withTiming(enter.value, { duration: motion.standard }),
    transform: [{ scale: 0.96 + enter.value * 0.04 }, { translateY: (1 - enter.value) * -12 }],
  }));

  if (!front) return null;

  const ordered = [...front.stops].sort((a, b) => a.seq - b.seq);
  const first = ordered[0];
  const last = ordered[ordered.length - 1];

  return (
    <View>
      {/* Decorative depth only — assistive tech is told about the front card and the count. */}
      {Array.from({ length: plates }, (_, i) => (
        <View
          key={i}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          className={`absolute inset-x-4 h-full rounded-xl ${i === 0 ? 'bg-surface/65' : 'bg-surface/35'}`}
          style={{ top: (i + 1) * 14, marginHorizontal: (i + 1) * 6 }}
        />
      ))}

      <Animated.View style={enterStyle}>
        <Card>
          <View className="flex-row items-center gap-2">
            <Badge label={`Offered ${shortTime(front.created_at)}`} tone="info" />
            <AppText variant="caption" tone="muted" className="flex-1 text-right" numberOfLines={1}>
              {front.ref}
            </AppText>
          </View>

          <AppText variant="navigationTitle" numberOfLines={2}>
            {placeLabel(first)} → {placeLabel(last)}
          </AppText>
          <AppText variant="supporting" tone="muted">
            {[
              first?.appointment_start ? `${weekdayTime(first.appointment_start)} pickup` : null,
              front.total_miles == null ? null : `${Math.round(front.total_miles).toLocaleString()} mi`,
              front.equipment,
              `${ordered.length} ${ordered.length === 1 ? 'stop' : 'stops'}`,
            ].filter(Boolean).join(' · ')}
          </AppText>

          {front.hazmat ? (
            <View className="flex-row flex-wrap gap-2 pt-1">
              <Badge label="Hazmat" tone="danger" icon="local_fire_department" />
            </View>
          ) : null}

          <View className={`gap-2 pt-2 ${largeText ? '' : 'flex-row'}`}>
            <View className={largeText ? '' : 'flex-1'}>
              <Button label={copy.primary} variant="primary" loading={accepting} onPress={() => onAccept(front)} />
            </View>
            <View className={largeText ? '' : 'flex-1'}>
              <Button label={copy.secondary} variant="secondary" onPress={() => onDecline(front)} />
            </View>
          </View>
          <Button label="See the whole load" variant="ghost" size="sm" onPress={() => onOpen(front)} />
          {front.hazmat ? (
            <Button label="Open the BOL check" variant="ghost" size="sm" onPress={onHazmat} />
          ) : null}
        </Card>
      </Animated.View>

      {offers.length > 1 ? (
        <View
          className="flex-row items-center justify-center gap-1 pt-3"
          accessibilityLabel={`Offer 1 of ${offers.length}`}
        >
          {offers.map((offer, index) => (
            <View
              key={offer.id}
              className={`h-1.5 rounded-full ${index === 0 ? 'w-4 bg-action' : 'w-1.5 bg-on-hero/30'}`}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** The reason list the decline flow asks for, in the sheet's shape. */
export function declineChoices(copy: AcceptanceCopy) {
  return copy.reasons.map((reason) => ({ value: reason, label: DECLINE_REASON_LABELS[reason] }));
}

function shortTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function weekdayTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}
