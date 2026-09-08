import type { ReactNode } from 'react';
import { View } from 'react-native';
import { AppText } from './AppText';
import { IconButton } from './IconButton';

/**
 * Compact, content-first screen header with scalable title and optional contextual actions.
 *
 * THE TITLE STARTS AT THE SCREEN INSET (D-DB23). It used to sit in a flex row beside the back or
 * close button, which pushed it right by the button's 44pt target plus the gap. Measured on the
 * settings modal, 2026-09-08: the title's left edge was at **64pt** while every section heading
 * below it was at **19.3pt** — the screen's own name was the one piece of text on the page that did
 * not line up with the page. Seventeen screens render this header and 21 call sites pass a leading
 * action, so it was the app's most repeated misalignment.
 *
 * This is not a new rule. D-DB15 settled exactly this argument for the auth screens after the owner's
 * "alignment is not correct" — "the mark owns the hero and the sheet owns every line of text, all at
 * the one screen inset" — and the same sentence applies here. The leading action takes its own row
 * above the title, which is also how a platform large-title bar is built, so the button keeps its
 * full 44pt target and stops displacing the words.
 */
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

  const titleBlock = (
    <View className="gap-1">
      <AppText variant={contextual ? 'navigationTitle' : 'screenTitle'} accessibilityRole="header">
        {title}
      </AppText>
      {subtitle ? <AppText variant="supporting" tone="muted">{subtitle}</AppText> : null}
    </View>
  );

  // Without a leading action there is nothing to displace the title, so the row stays as it was and
  // `right` keeps sitting beside the words rather than gaining a row of its own.
  if (!contextual) {
    return (
      <View className="min-h-11 flex-row items-start gap-2">
        <View className="min-h-11 flex-1 justify-center">{titleBlock}</View>
        {right}
      </View>
    );
  }

  return (
    <View className="gap-2">
      <View className="min-h-11 flex-row items-center gap-2">
        {leadingAction}
        <View className="flex-1" />
        {right}
        {onBack && onClose ? <IconButton name="close" label="Close" onPress={onClose} /> : null}
      </View>
      {titleBlock}
    </View>
  );
}
