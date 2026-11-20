import { View } from 'react-native';
import { AppText } from './AppText';

/**
 * An unread count on an icon button (the bell, messages): the number in a 24pt amber disc (2pt of it the ring) at the
 * glyph's top-right corner, capped at "9+".
 *
 * One primitive, because the bell and the messages button each drew their own: a 13/18 caption
 * inside 4pt of padding on every side made a 26pt-tall pill that covered half the glyph (owner,
 * 2026-11-20: "bad badges"). Here the disc is a fixed 24pt with no vertical padding, so the 18pt line
 * sits inside it, and a 2pt ring in the canvas colour separates it from the glyph it overlaps.
 *
 * Amber, because an unread message is something the driver acts on (D-DV5), with the navy `onAction`
 * text every amber fill carries. The count is the one text allowed to ignore the phone's text size
 * (D-DV9): a badge that grows with it would cover the icon. The screen reader gets the count from the
 * button's own label, so the disc is hidden from it.
 */
export function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      className="absolute right-0 top-0.5 h-6 min-w-6 items-center justify-center rounded-full border-2 border-canvas bg-action px-1"
    >
      <AppText variant="caption" weight="semibold" tone="onAction" allowFontScaling={false} tabular>
        {count > 9 ? '9+' : String(count)}
      </AppText>
    </View>
  );
}
