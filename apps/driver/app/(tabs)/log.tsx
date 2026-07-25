import { Redirect } from 'expo-router';

// The "Log" tab intercepts its own press to open /log-fuel; this is only reached if that fails.
export default function LogTab() {
  return <Redirect href="/home" />;
}
