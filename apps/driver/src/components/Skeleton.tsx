import { View } from 'react-native';

// Loading placeholder — cached-first screens use skeletons, not spinners (plan §22.5).
export function Skeleton({ className = '' }: { className?: string }) {
  return <View className={`rounded-md bg-surface-muted ${className}`} accessibilityElementsHidden />;
}
