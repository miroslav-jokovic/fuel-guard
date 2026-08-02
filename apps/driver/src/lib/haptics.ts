import * as Haptics from 'expo-haptics';

// Tasteful haptic map (plan D20). Visual feedback is always primary; haptics enhance and are
// fire-and-forget (silent on iOS Low-Power / when disabled).
function fire(p: Promise<void>): void {
  void p.catch(() => {
    /* haptics are best-effort */
  });
}

export const haptics = {
  success: () => fire(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => fire(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => fire(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
  select: () => fire(Haptics.selectionAsync()),
  tap: () => fire(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
};

export type HapticKind = keyof typeof haptics;
