/**
 * "Chrome on Android" — so a person can tell their devices apart. ONE reading of a user agent for the two
 * lists that show devices: the browsers that receive notifications (`apps/web/src/lib/webPush.ts`, which sends
 * its own `navigator.userAgent` through this) and the signed-in devices (`memberSessionsContract.ts`, where the
 * API reads the user agent Supabase recorded at sign-in). Moved here from the web on 2026-11-15 so the second
 * list could not grow its own copy.
 *
 * ⚠ It decides one thing besides a label: its " on iPhone" / " on iPad" ending is how an iPhone tab learns the
 * app is already on a Home Screen (`installedOnThisKindOfDevice` in the web). Reword those two and that breaks.
 */
export function deviceLabel(ua: string): string {
  const browser = /SamsungBrowser/.test(ua) ? "Samsung Internet"
    : /Edg\//.test(ua) ? "Edge"
    : /OPR\//.test(ua) ? "Opera"
    : /Firefox\/|FxiOS/.test(ua) ? "Firefox"
    : /Chrome\/|CriOS/.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : "Browser";
  const os = /Android/.test(ua) ? "Android"
    : /iPhone|iPod/.test(ua) ? "iPhone"
    : /iPad/.test(ua) ? "iPad"
    : /Windows/.test(ua) ? "Windows"
    : /Macintosh|Mac OS X/.test(ua) ? "Mac"
    : /Linux/.test(ua) ? "Linux"
    : "this device";
  return `${browser} on ${os}`;
}
