import { HStack, Text, VStack } from '@expo/ui/swift-ui';
import { containerBackground, font, lineLimit, monospacedDigit, widgetURL } from '@expo/ui/swift-ui/modifiers';
import { createWidget } from 'expo-widgets';
import { idleProps, type GlanceProps } from './glanceModel';
import { guarded } from './guarded';

/**
 * The Lock Screen widget (accessoryRectangular; Visual 2026 V9, D-DV25): the stop, its window, and the
 * system's countdown to it, in three lines.
 *
 * Runs in the widget runtime (`'widget'`): props only. The Lock Screen draws accessory widgets in its
 * own monochrome ("vibrant"), so this sets no colour; weight carries the hierarchy. Its timeline comes
 * from `glanceTimeline`, one entry per phase of the window, so it changes with the app asleep.
 */
const StopWidget = (props: GlanceProps) => {
  'widget';
  const t = props.type;
  const counting = props.countdownTo !== undefined;
  return (
    <VStack alignment="leading" spacing={1} modifiers={[containerBackground('clear', 'widget'), widgetURL(props.url)]}>
      <Text modifiers={[font(t.title), lineLimit(1)]}>{props.title}</Text>
      {props.mode === 'idle' ? (
        <Text modifiers={[font(t.context), lineLimit(1)]}>{props.context}</Text>
      ) : (
        <Text modifiers={[font(t.place), monospacedDigit(), lineLimit(1)]}>{props.window}</Text>
      )}
      {counting ? (
        // Relative ("7 hr, 59 min"), not a timer: the Lock Screen hides a timer's seconds.
        <HStack spacing={4}>
          <Text modifiers={[font(t.caption), lineLimit(1)]}>{props.countdownCaption}</Text>
          <Text
            date={new Date(props.countdownTo ?? Date.now())}
            dateStyle="relative"
            modifiers={[font(t.caption), monospacedDigit(), lineLimit(1)]}
          />
        </HStack>
      ) : props.line ? (
        <Text modifiers={[font(t.caption), lineLimit(1)]}>{props.line}</Text>
      ) : null}
    </VStack>
  );
};

export default guarded(() => createWidget('StopWidget', StopWidget, idleProps('Off duty')));
