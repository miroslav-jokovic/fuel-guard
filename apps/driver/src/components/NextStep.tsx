import { View } from 'react-native';
import { AppText } from './AppText';
import { Button } from './Button';
import { cardSurfaceClass } from '@/theme/elevation';
import { useTheme } from '@/theme/ThemeProvider';
import { layout } from '@/theme/tokens';

/**
 * ONE recommended next step (Visual 2026 V1 mock, taken from Uber Driver's "recommended next step"):
 * what to do, why, and the amber action that does it.
 *
 * At most one per screen, and only when there IS a next step. A screen with nothing for the driver to
 * do shows no NextStep at all, never a placeholder. The action is the screen's single primary
 * (D-DV5), so a screen that renders a NextStep has no other amber button.
 *
 * The title and the reason stack and grow with the driver's text size (D-DV9). The button keeps its
 * 48pt target and moves under the text instead of squeezing it when the row gets tight.
 */
export function NextStep({
  title,
  reason,
  actionLabel,
  onAction,
  loading = false,
}: {
  title: string;
  reason?: string;
  actionLabel: string;
  onAction: () => void;
  loading?: boolean;
}) {
  const { themeKey } = useTheme();
  return (
    <View
      className={`flex-row flex-wrap items-center gap-3 rounded-xl ${cardSurfaceClass(themeKey, 'resting')}`}
      style={{ padding: layout.sheetCardPadding + 2 }}
    >
      <View className="min-w-0 flex-1 gap-0.5" style={{ flexBasis: 180 }}>
        <AppText variant="rowTitle">{title}</AppText>
        {reason ? <AppText variant="supporting" tone="secondary">{reason}</AppText> : null}
      </View>
      <View>
        <Button label={actionLabel} variant="primary" size="md" loading={loading} onPress={onAction} haptic="success" />
      </View>
    </View>
  );
}
