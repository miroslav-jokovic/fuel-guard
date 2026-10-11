import { z } from "zod";
import { APPLICATION_SECTION_ORDER, type ApplicationSection } from "./applicationSections.js";
import { AUTHORIZATION_PURPOSES, type AuthorizationPurpose } from "./authorizationContract.js";

/**
 * The screens of the applicant's link, by name, and the batch the page reports them in
 * (APPLICATION-FLOW-V2-PLAN.md §6.8, AW14, C3d3a).
 *
 * ── WHAT THE NAMES ARE FOR ─────────────────────────────────────────────────────────────────────
 * 0376's `application_screen_events` holds one row per screen visit, and §6.8 measures Part 1 and
 * Part 2 from it: the time spent on `part1.*` screens, and on `part2.*` ones, per link. So a name has
 * to say which part it belongs to, and nothing else. **Names only, never values (D-APP16):** the
 * database's CHECK (`^[a-z0-9_.-]{1,60}$`) would still take `dob-1990-01-01`, so the api refuses any
 * name not built below — a leaked link can write screen visits, and nothing that is an answer.
 *
 * ── BUILT FROM THE LISTS THE SCREENS ARE, NEVER COPIED FROM THEM ───────────────────────────────
 * Part 1's screens, Part 2's sections and the permissions are each already a list the page walks.
 * The names are derived from those lists, so a screen added to one is a name the api accepts on the
 * same merge, and a name cannot outlive its screen.
 */

/**
 * Part 1's screens, in order (§6.2, D-AW11, AW3, C3a). Moved here from the web's `partOneScreens.ts` in
 * C3d3a so that the screen names below can be derived from it; the web re-exports it unchanged.
 *
 * ⚠ **The CDL's two photographs come FIRST** (Q-AW31, default built in C3b1). §6.2's table put them at
 * 8–9, after the typed licence screens, while the same table says those screens are "prefilled from
 * the barcode on screen 9" — which no order but this can do: a prefill that never overwrites typed
 * input (§6.6.4) has nothing left to fill once screens 3–5 are typed, and the date of birth, once
 * written, is fill-only for the applicant (0376 → `record_applicant_identity`), so a later "correction"
 * from the barcode would be dropped. Captures are open from the 7001(c) consent onward (AF3), so
 * photographing first needs nothing from the server. The medical card stays after the questions.
 */
export const PART_ONE_SCREENS = [
  "cdl_front",
  "cdl_back",
  "about",
  "address",
  "licence",
  "otherLicences",
  "screening",
  "medical_card",
  "selfie",
  "rights",
] as const;
export type PartOneScreen = (typeof PART_ONE_SCREENS)[number];

/**
 * One name per branch of the page's phase chain (`ApplyPhaseRouter.vue`), each a screen of its own.
 * `part1` and `ceremony` are what shows between their own screens (a Part 1 still loading its inputs,
 * a ceremony that has just finished), and the finer names below replace them while a screen is up.
 */
export const APPLY_PHASE_SCREENS = [
  "expectations",
  "consent",
  "part1",
  "identity",
  "ceremony",
  "wait.permissions",
  "wait.office",
  "wait.review",
  "unlock",
  "signoff",
  "filed",
  "handbook",
] as const;
export type ApplyPhaseScreen = (typeof APPLY_PHASE_SCREENS)[number];

export type ApplyScreen =
  | ApplyPhaseScreen
  | `part1.${string}`
  | "part2.hub"
  | `part2.${ApplicationSection}`
  | `ceremony.${AuthorizationPurpose}`;

/**
 * A Part 1 screen's reported name. ⚠ Snake-cased, because 0376's CHECK is lowercase
 * (`^[a-z0-9_.-]{1,60}$`) and one screen is `otherLicences`: reported as-is it would fail the CHECK
 * and take the whole report with it. The screen keeps its own name everywhere else — it is a key in
 * the phone's Part 1 copy (`partOneLocal.ts`).
 */
export const partOneScreenName = (screen: PartOneScreen): `part1.${string}` =>
  `part1.${screen.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`;

/** Every name the page may report and the api will store. */
export const APPLY_SCREENS: readonly ApplyScreen[] = [
  ...APPLY_PHASE_SCREENS,
  ...PART_ONE_SCREENS.map(partOneScreenName),
  "part2.hub",
  ...APPLICATION_SECTION_ORDER.map((s) => `part2.${s}` as const),
  ...AUTHORIZATION_PURPOSES.map((p) => `ceremony.${p}` as const),
];

const SCREEN_SET: ReadonlySet<string> = new Set(APPLY_SCREENS);
export const isApplyScreen = (name: string): name is ApplyScreen => SCREEN_SET.has(name);

/**
 * Most visits one report carries. A page reports about once a minute, so a real batch is a handful;
 * fifty is a morning with the phone offline, and the page sends the oldest fifty first.
 */
export const SCREEN_EVENTS_MAX = 50;

/**
 * One screen visit. `id` is minted by the page, so a visit reported open and later closed is ONE row:
 * the second report fills `left_at`. `left_at` null is a screen still showing when the report went.
 */
export const applicationScreenEventSchema = z
  .object({
    id: z.uuid(),
    screen: z.string().refine(isApplyScreen, { message: "Not a screen of this page." }),
    entered_at: z.iso.datetime(),
    left_at: z.iso.datetime().nullable(),
  })
  .refine((e) => e.left_at === null || Date.parse(e.left_at) >= Date.parse(e.entered_at), {
    message: "A screen is left after it is entered.",
    path: ["left_at"],
  });
export type ApplicationScreenEvent = z.infer<typeof applicationScreenEventSchema>;

/**
 * A report. `sent_at` is the phone's clock at sending, so the api can move every time in the batch by
 * the difference between the two clocks — a phone set ten minutes fast would otherwise add ten
 * minutes to nothing, but put every visit in the future.
 */
export const applicationScreenEventsSchema = z.object({
  sent_at: z.iso.datetime(),
  events: z.array(applicationScreenEventSchema).min(1).max(SCREEN_EVENTS_MAX),
});
export type ApplicationScreenEvents = z.infer<typeof applicationScreenEventsSchema>;
