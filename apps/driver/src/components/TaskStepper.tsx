import { Text, View } from 'react-native';
import { Icon } from './Icon';

export type TaskStepState = 'complete' | 'current' | 'upcoming';
export interface TaskStep {
  label: string;
  state: TaskStepState;
}

export function TaskStepper({ steps }: { steps: TaskStep[] }) {
  return (
    <View className="flex-row items-start" accessibilityRole="progressbar">
      {steps.map((step, index) => (
        <View key={step.label} className="flex-1 items-center">
          <View className="w-full flex-row items-center">
            <View className={`h-0.5 flex-1 ${index === 0 ? 'bg-transparent' : step.state === 'complete' ? 'bg-success' : 'bg-edge'}`} />
            <View
              className={`h-7 w-7 items-center justify-center rounded-full border ${
                step.state === 'complete'
                  ? 'border-success bg-success'
                  : step.state === 'current'
                    ? 'border-brand bg-brand/10'
                    : 'border-edge-strong bg-surface'
              }`}
            >
              {step.state === 'complete' ? (
                <Icon name="check" size={16} className="text-ink-inverse" />
              ) : (
                <Text className={`text-xs font-sans-sb ${step.state === 'current' ? 'text-brand' : 'text-ink-muted'}`}>
                  {index + 1}
                </Text>
              )}
            </View>
            <View className={`h-0.5 flex-1 ${index === steps.length - 1 ? 'bg-transparent' : step.state === 'complete' ? 'bg-success' : 'bg-edge'}`} />
          </View>
          <Text
            numberOfLines={1}
            className={`mt-1.5 max-w-full text-center text-xs ${step.state === 'current' ? 'font-sans-sb text-ink' : 'text-ink-muted'}`}
          >
            {step.label}
          </Text>
        </View>
      ))}
    </View>
  );
}
