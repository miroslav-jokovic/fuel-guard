import { Redirect } from 'expo-router';

// The tab shell lives under (tabs); "/" redirects to Home.
export default function Index() {
  return <Redirect href="/home" />;
}
