import { Stack } from 'expo-router';

// The unauthenticated group: no headers, no gestures back into the app. The root guard decides
// which of these screens is shown based on session status.
export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false, gestureEnabled: false }} />;
}
