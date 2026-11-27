import type { ReactNode } from 'react';
import { Pressable } from 'react-native';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { haptics } from '@/lib/haptics';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';

/** One action a row offers to a swipe from the right (Visual 2026 V8's "swipe-to-act"). */
export interface RowSwipeAction {
  /** A verb the driver would say: "Mark read". */
  label: string;
  icon: MaterialSymbolName;
  onAction: () => void;
}

/**
 * Swipe a row left to reveal ONE action, the Linear pattern the plan names for Messages and
 * Notifications (V8). Only an action that already exists is offered; a swipe never invents one.
 *
 * - One action, never a tray: a gloved thumb must not be choosing between two narrow targets. It is
 *   96pt wide, past D-DV10's 48pt minimum, and the row snaps shut after it runs.
 * - The surface is the neutral selected surface with ink, not a status colour: marking something
 *   read is neither live nor a demand to act (D-DV5).
 * - A swipe cannot be found by ear, so `ListRow` offers the same action to VoiceOver and TalkBack as
 *   a named accessibility action. The swipe is a shortcut, never the only way.
 * - Reduce Motion needs nothing here: the row moves only under the finger.
 */
export function SwipeAction({ action, children }: { action?: RowSwipeAction; children: ReactNode }) {
  if (!action) return <>{children}</>;
  return (
    <Swipeable
      friction={2}
      rightThreshold={48}
      overshootRight={false}
      renderRightActions={(_progress, _translation, methods) => (
        <Pressable
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          onPress={() => {
            haptics.success();
            action.onAction();
            methods.close();
          }}
          className="w-24 items-center justify-center gap-1 bg-surface-selected active:bg-surface-muted"
        >
          <Icon name={action.icon} size={22} className="text-ink" />
          <AppText variant="caption" weight="semibold">{action.label}</AppText>
        </Pressable>
      )}
    >
      {children}
    </Swipeable>
  );
}
