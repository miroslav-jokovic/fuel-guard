import { Modal, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from './AppText';
import { Button } from './Button';
import { GroupedList } from './GroupedList';
import { ListRow } from './ListRow';
import { useTheme } from '@/theme/ThemeProvider';

export interface Choice<T extends string> {
  value: T;
  label: string;
  subtitle?: string;
}

/**
 * A bottom sheet that asks one question with a short list of answers.
 *
 * The decline flow used to render its reasons INLINE at the bottom of the load-detail screen: a
 * driver tapped "Can't take this", the page grew a new section below the fold, and the reasons were
 * only reachable by scrolling past the load they were declining. A question that blocks the flow
 * belongs in front of it. `ConfirmSheet` is the two-answer case; this is the n-answer one, and they
 * share an anatomy so a driver learns one gesture.
 */
export function ChoiceSheet<T extends string>({
  visible,
  title,
  message,
  choices,
  cancelLabel = 'Never mind',
  onChoose,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message?: string;
  choices: readonly Choice<T>[];
  cancelLabel?: string;
  onChoose: (value: T) => void;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { reduceMotion } = useTheme();

  return (
    <Modal visible={visible} transparent statusBarTranslucent animationType="none" onRequestClose={onCancel}>
      <View className="flex-1 justify-end">
        <Animated.View
          entering={reduceMotion ? undefined : FadeIn.duration(140)}
          className="absolute inset-0 bg-surface-inverse/40"
        >
          <Pressable
            className="flex-1"
            accessibilityRole="button"
            accessibilityLabel={`Dismiss ${title}`}
            onPress={onCancel}
          />
        </Animated.View>
        <Animated.View
          entering={reduceMotion ? undefined : SlideInDown.springify().damping(28).stiffness(320)}
          className="rounded-t-2xl bg-surface-raised px-5 pt-3"
          style={{ maxHeight: height - insets.top - 8, paddingBottom: insets.bottom + 16 }}
          accessibilityViewIsModal
        >
          <View className="h-1 w-9 self-center rounded-full bg-edge-strong" />
          <ScrollView bounces={false} showsVerticalScrollIndicator={false} contentContainerClassName="gap-4 py-4">
            <View className="gap-1">
              <AppText variant="navigationTitle" accessibilityRole="header">{title}</AppText>
              {message ? <AppText variant="supporting" tone="secondary">{message}</AppText> : null}
            </View>
            <GroupedList>
              {choices.map((choice) => (
                <ListRow
                  key={choice.value}
                  title={choice.label}
                  subtitle={choice.subtitle}
                  onPress={() => onChoose(choice.value)}
                />
              ))}
            </GroupedList>
            <Button label={cancelLabel} variant="ghost" onPress={onCancel} />
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}
