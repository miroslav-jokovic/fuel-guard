import { Column, Text } from '@expo/ui/jetpack-compose';
import { background, fillMaxSize, paddingAll } from '@expo/ui/jetpack-compose/modifiers';
import { createWidget } from 'expo-widgets';
import { idleProps, type GlanceProps } from './glanceModel';
import { guarded } from './guarded';

/**
 * The Android home-screen widget (Visual 2026 V9, D-DV25; Q-DV5): the stop and its window on the navy
 * of Today's block.
 *
 * Android widgets take a snapshot, not a timeline, and cannot run a system timer. A relative line
 * ("Window opens in 18 min") would be wrong a minute later with the app asleep, so this shows only
 * what stays true: the stop, the place and the appointment as clock times. Runs in the widget runtime
 * (`'widget'`), props only.
 */
const StopWidget = (props: GlanceProps) => {
  'widget';
  const c = props.colors;
  const t = props.type;
  // Compose names weights by number; the type scale names them by word.
  const w = (weight: string) => (weight === 'bold' ? '700' : weight === 'semibold' ? '600' : weight === 'medium' ? '500' : '400');
  return (
    <Column modifiers={[fillMaxSize(), background(c.hero), paddingAll(16)]}>
      <Text color={c.onHeroSecondary} maxLines={1} style={{ fontSize: t.context.size, fontWeight: w(t.context.weight) }}>{props.context}</Text>
      <Text color={c.onHero} maxLines={1} style={{ fontSize: t.title.size, fontWeight: w(t.title.weight) }}>{props.title}</Text>
      {props.window ? (
        <Text color={c.onHero} maxLines={1} style={{ fontSize: t.figure.size, fontWeight: w(t.figure.weight) }}>{props.window}</Text>
      ) : null}
      {props.place ? <Text color={c.onHeroSecondary} maxLines={1} style={{ fontSize: t.place.size, fontWeight: w(t.place.weight) }}>{props.place}</Text> : null}
    </Column>
  );
};

export default guarded(() => createWidget('StopWidget', StopWidget, idleProps('Off duty')));
