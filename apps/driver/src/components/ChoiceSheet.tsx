import { View } from 'react-native';
import { AppText } from './AppText';
import { Button } from './Button';
import { GroupedList } from './GroupedList';
import { ListRow } from './ListRow';
import { SystemSheet } from './SystemSheet';

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
 * share an anatomy so a driver learns one gesture. Both are the system's own sheet (`SystemSheet`,
 * Visual 2026 V9).
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
  return (
    <SystemSheet visible={visible} onDismiss={onCancel}>
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
    </SystemSheet>
  );
}
