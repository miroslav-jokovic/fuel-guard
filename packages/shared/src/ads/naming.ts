import { isCalendarDay, type CalendarDay } from "../calendarDay.js";
import { AD_PLATFORMS, type AdPlatform } from "./contracts.js";

/**
 * The name every object we create on a platform carries (plan §4.2 `naming.ts`).
 *
 *   S360|META|campaign|recruiting_opening|op-1@v3|P2|20261102|ab12cd34
 *   S360|META|ad|recruiting_opening|op-1@v3|P2|20261102|ab12cd34|9f8e7d6c
 *
 * Two jobs, both load-bearing:
 * 1. **Reconcile (D-AD4).** A campaign on the account whose name does not parse is one we did not
 *    create — someone used Ads Manager — and is reported as `external_change`, never adopted or
 *    "fixed". So `parseAdName` returns null for anything not built here, rather than its best guess.
 * 2. **Reading the account by eye.** The owner sees the opening, the preset and the day in Ads
 *    Manager's own list, which is also where Meta's reports group by name.
 *
 * `|` separates because no field may contain it (the builder refuses), and underscores, dots, `@` and
 * dashes are all legal inside fields. The day is the campaign's creation day, passed in (no clock).
 * The ids are the first 8 hex of our row uuids: enough to find the row, short enough to read.
 */

export const AD_NAME_PREFIX = "S360";
export const AD_NAME_LEVELS = ["campaign", "adset", "form", "ad"] as const;
export type AdNameLevel = (typeof AD_NAME_LEVELS)[number];

const PLATFORM_CODES: Record<AdPlatform, string> = { meta: "META", tiktok: "TIKTOK", x: "X", simulator: "SIM" };
const CODE_PLATFORMS = Object.fromEntries(Object.entries(PLATFORM_CODES).map(([p, c]) => [c, p])) as Record<string, AdPlatform>;

export interface AdNameParts {
  platform: AdPlatform;
  level: AdNameLevel;
  brief_source: string;
  brief_ref: string;
  preset_key: string;
  day: CalendarDay;
  campaign_short: string;
  /** Only on the `ad` level: the creative's short id. */
  creative_short?: string;
}

const SHORT = /^[0-9a-f]{8}$/;
const SOURCE = /^[a-z][a-z0-9_]{1,62}$/;
const PRESET = /^[A-Z][A-Z0-9_]{0,15}$/;
/** Meta's limit for a campaign name is far above this; 250 keeps every platform's list readable. */
export const AD_NAME_MAX = 250;

/** `isCalendarDay` checks the shape only (its own comment says so); a name must carry a real date. */
function isRealDay(day: string): boolean {
  if (!isCalendarDay(day)) return false;
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** The short id the name carries for a row uuid. */
export function shortId(uuid: string): string {
  const s = uuid.replace(/-/g, "").slice(0, 8).toLowerCase();
  if (!SHORT.test(s)) throw new Error(`shortId: not a uuid: ${uuid}`);
  return s;
}

export function buildAdName(p: AdNameParts): string {
  const problems: string[] = [];
  if (!SOURCE.test(p.brief_source)) problems.push("brief_source");
  if (p.brief_ref.length === 0 || p.brief_ref.length > 80 || /[|\s]/.test(p.brief_ref)) problems.push("brief_ref");
  if (!PRESET.test(p.preset_key)) problems.push("preset_key");
  if (!isRealDay(p.day)) problems.push("day");
  if (!SHORT.test(p.campaign_short)) problems.push("campaign_short");
  if ((p.level === "ad") !== (p.creative_short !== undefined)) problems.push("creative_short");
  if (p.creative_short !== undefined && !SHORT.test(p.creative_short)) problems.push("creative_short");
  if (problems.length) throw new Error(`buildAdName: invalid ${problems.join(", ")}`);
  const fields = [
    AD_NAME_PREFIX, PLATFORM_CODES[p.platform], p.level, p.brief_source, p.brief_ref, p.preset_key,
    p.day.replace(/-/g, ""), p.campaign_short, ...(p.creative_short ? [p.creative_short] : []),
  ];
  return fields.join("|");
}

/** The parts of a name we built, or null for any name we did not (an Ads-Manager object, D-AD4). */
export function parseAdName(name: string): AdNameParts | null {
  if (name.length > AD_NAME_MAX) return null;
  const f = name.split("|");
  if (f[0] !== AD_NAME_PREFIX || (f.length !== 8 && f.length !== 9)) return null;
  const [, code, level, brief_source, brief_ref, preset_key, ymd, campaign_short, creative_short] = f as string[];
  const platform = CODE_PLATFORMS[code!];
  if (!platform || !(AD_PLATFORMS as readonly string[]).includes(platform)) return null;
  if (!(AD_NAME_LEVELS as readonly string[]).includes(level!)) return null;
  if (!/^\d{8}$/.test(ymd!)) return null;
  const day = `${ymd!.slice(0, 4)}-${ymd!.slice(4, 6)}-${ymd!.slice(6, 8)}`;
  const parts: AdNameParts = {
    platform, level: level as AdNameLevel, brief_source: brief_source!, brief_ref: brief_ref!,
    preset_key: preset_key!, day, campaign_short: campaign_short!,
    ...(creative_short !== undefined ? { creative_short } : {}),
  };
  // Valid only if it would be built back to exactly the same string.
  try {
    return buildAdName(parts) === name ? parts : null;
  } catch {
    return null;
  }
}
