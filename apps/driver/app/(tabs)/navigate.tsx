import { Redirect } from 'expo-router';

// Dummy route for the elevated center tab — the tab's press listener intercepts and opens the
// /drive modal instead; if reached directly (deep link), redirect there too.
export default function NavigateTab() {
  return <Redirect href="/drive" />;
}
