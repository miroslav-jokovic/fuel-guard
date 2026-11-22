import { HStack, Image, Text, VStack } from '@expo/ui/swift-ui';
import { activityBackgroundTint, font, foregroundStyle, lineLimit, monospacedDigit, padding } from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets';
import type { GlanceProps } from './glanceModel';
import { guarded } from './guarded';

/**
 * The stop being driven to, on the Lock Screen and in the Dynamic Island (Visual 2026 V9, D-DV25).
 *
 * This function runs in the widget extension's isolated runtime (the `'widget'` directive): no hooks,
 * no imports of our own and nothing from module scope, so every word and colour is a prop from
 * `glanceModel.ts`. Keep it a layout; a rule added here cannot be tested.
 *
 * - The countdown is the system's own relative date (`Text` with `dateStyle="relative"`), so it stays
 *   right with the app asleep. It stops at the window's start, and the activity's stale date is that same instant.
 * - Stale (a phase changed and the app has not refreshed it) shows the appointment window alone. That
 *   stays true whatever happened since; "Window opens in 0:00" would not.
 * - Navy with the on-hero roles, as Today's block: the Lock Screen is the same signature, smaller.
 */
const StopActivity = (props: GlanceProps, environment: LiveActivityEnvironment) => {
  'widget';
  const c = props.colors;
  const t = props.type;
  const stale = environment.isStale === true;
  const counting = props.countdownTo !== undefined && !stale;
  const lineColor = props.lineTone === 'act' ? c.onHeroAct : c.onHeroLive;

  // The system's RELATIVE style ("7 hr, 59 min"), not a timer: on the Lock Screen iOS hides a timer's
  // seconds ("7:59:––"), and an H:MM:SS figure under the window's clock read as a second clock. It
  // keeps counting with the app asleep, in Today's units (V9 critique).
  const timer = (size: typeof t.figure) =>
    counting ? (
      <Text
        date={new Date(props.countdownTo ?? Date.now())}
        dateStyle="relative"
        modifiers={[font(size), monospacedDigit(), foregroundStyle(c.onHeroLive)]}
      />
    ) : null;

  // One line under the window: "Window opens in 7:59:12" while counting, Today's words after.
  const status = counting ? (
    <HStack alignment="firstTextBaseline" spacing={4}>
      <Text modifiers={[font(t.line), foregroundStyle(c.onHeroLive)]}>{props.countdownCaption}</Text>
      {timer(t.line)}
    </HStack>
  ) : !stale && props.line ? (
    <Text modifiers={[font(t.line), foregroundStyle(lineColor), lineLimit(1)]}>{props.line}</Text>
  ) : null;

  return {
    banner: (
      <VStack
        alignment="leading"
        spacing={4}
        modifiers={[padding({ all: 16 }), activityBackgroundTint(c.hero)]}
      >
        <Text modifiers={[font(t.context), foregroundStyle(c.onHeroSecondary), lineLimit(1)]}>
          {props.context}
        </Text>
        <Text modifiers={[font(t.title), foregroundStyle(c.onHero), lineLimit(1)]}>
          {props.title}
        </Text>
        {props.place ? (
          <Text modifiers={[font(t.place), foregroundStyle(c.onHeroSecondary), lineLimit(1)]}>{props.place}</Text>
        ) : null}
        <Text modifiers={[font(t.figure), monospacedDigit(), foregroundStyle(c.onHero), lineLimit(1)]}>
          {props.window}
        </Text>
        {status}
      </VStack>
    ),
    compactLeading: <Image systemName="truck.box.fill" color={c.onHeroLive} />,
    // The narrow island slots take the appointment's clock ("7 hr, 59 min" does not fit), behind a
    // clock glyph: a bare time beside a truck reads as an arrival ETA, which D-DV13 forbids.
    compactTrailing: (
      <HStack spacing={3}>
        <Image systemName="clock" color={c.onHeroSecondary} size={t.caption.size} />
        <Text modifiers={[font(t.line), monospacedDigit(), foregroundStyle(c.onHero)]}>{props.at}</Text>
      </HStack>
    ),
    minimal: <Image systemName="truck.box.fill" color={c.onHeroLive} />,
    expandedLeading: <Image systemName="truck.box.fill" color={c.onHeroLive} />,
    expandedTrailing: (
      <HStack spacing={3}>
        <Image systemName="clock" color={c.onHeroSecondary} size={t.caption.size} />
        <Text modifiers={[font(t.line), monospacedDigit(), foregroundStyle(c.onHero)]}>{props.at}</Text>
      </HStack>
    ),
    expandedCenter: (
      <Text modifiers={[font(t.title), foregroundStyle(c.onHero), lineLimit(1)]}>{props.title}</Text>
    ),
    expandedBottom: (
      <VStack alignment="leading" spacing={2}>
        <Text modifiers={[font(t.line), monospacedDigit(), foregroundStyle(c.onHero), lineLimit(1)]}>
          {props.window}
        </Text>
        <Text modifiers={[font(t.context), foregroundStyle(c.onHeroSecondary), lineLimit(1)]}>{props.context}</Text>
      </VStack>
    ),
  };
};

export default guarded(() => createLiveActivity('StopActivity', StopActivity));
