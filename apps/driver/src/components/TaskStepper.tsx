import { View } from 'react-native';
import { AppText } from './AppText';

export type TaskStepState = 'complete' | 'current' | 'upcoming';
export interface TaskStep {
  label: string;
  state: TaskStepState;
}

/** Compact, Dynamic-Type-safe progress summary. The full workflow remains in the content below. */
export function TaskStepper({ steps }: { steps: TaskStep[] }) {
  if (steps.length === 0) return null;
  const explicitCurrent = steps.findIndex((step) => step.state === 'current');
  const completed = steps.filter((step) => step.state === 'complete').length;
  const currentIndex = explicitCurrent >= 0 ? explicitCurrent : Math.min(completed, steps.length - 1);
  const current = steps[currentIndex];
  const progress = Math.round(((currentIndex + 1) / steps.length) * 100);

  return (
    <View
      className="gap-2"
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 1, max: steps.length, now: currentIndex + 1, text: current?.label }}
    >
      <View className="flex-row items-start justify-between gap-3">
        <AppText variant="sectionTitle" className="flex-1">{current?.label ?? 'Current step'}</AppText>
        <AppText variant="caption" tone="muted" tabular>Step {currentIndex + 1} of {steps.length}</AppText>
      </View>
      <View className="h-1 overflow-hidden rounded-full bg-surface-muted">
        <View className="h-full rounded-full bg-operation-current" style={{ width: `${progress}%` }} />
      </View>
    </View>
  );
}
