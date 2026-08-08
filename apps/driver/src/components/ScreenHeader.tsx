import type { ReactNode } from 'react';
import { View } from 'react-native';
import { AppText } from './AppText';
import { IconButton } from './IconButton';

/** Compact, content-first screen header with scalable title and optional contextual actions. */
export function ScreenHeader({
  title,
  subtitle,
  onBack,
  onClose,
  right,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  onClose?: () => void;
  right?: ReactNode;
}) {
  const contextual = onBack != null || onClose != null;
  const leadingAction = onBack
    ? <IconButton name="arrow_back" label="Back" onPress={onBack} />
    : onClose
      ? <IconButton name="close" label="Close" onPress={onClose} />
      : null;
  return (
    <View className="min-h-11 flex-row items-start gap-2">
      {leadingAction}
      <View className="min-h-11 flex-1 justify-center gap-1">
        <AppText
          variant={contextual ? 'navigationTitle' : 'screenTitle'}
          accessibilityRole="header"
        >
          {title}
        </AppText>
        {subtitle ? (
          <AppText
            variant="supporting"
            tone="muted"
          >
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {right}
      {onBack && onClose ? <IconButton name="close" label="Close" onPress={onClose} /> : null}
    </View>
  );
}
