/**
 * Words that were typed straight into the page's templates until U7's gate (F4 PR 1,
 * `templateLiterals.test.ts`) — so a Spanish reader met English on the signing rail, under the
 * releases and in three "Optional" boxes. They are here, in `APPLY_COPY`, for the reason every other
 * string is: the page's language is a read of this object, and a template literal is a sentence no
 * language switch can reach.
 */
export const APPLY_SCREENS_COPY = {
  /** `choose` is a picker's empty box — `AppCombobox`'s own default is English, so every picker here passes it. */
  placeholders: { optional: "Optional", choose: "Select…" },
  /** The releases shown read-only while their wording is draft (Q-H3, `DisclosurePanel`). */
  disclosure: {
    heading: "What you will be asked to authorise",
    draftIntro:
      "These are the checks a carrier runs before hiring a driver. The final wording is still being prepared, so nothing here is being signed today — you will be asked to sign each one separately, and each is its own document. Read them now so nothing later is a surprise.",
    finalIntro: "Each of these is signed separately, on its own, after you submit this application.",
    notFinal: "Not final",
  },
  /** The places to sign (`SigningPlaceRail`, `PlaceWalk`, `PacketCeremony`). */
  signingWalk: {
    viewer: "The carrier's application",
    /** What the count is of comes in words of its own ("on the application"), so it is an argument. */
    done: (signed: number, of: number, scope: string): string => `${signed} of ${of} ${scope} done`,
    page: (n: number): string => `Page ${n}`,
    progress: (n: number): string => `Progress through ${n} places`,
    places: (n: number): string => `The ${n} places you are asked to sign`,
    place: (index: number, page: number | null, what: string, state: string): string =>
      `Place ${index}${page ? `, page ${page}` : ""}. ${what} — ${state}`,
    signed: "signed",
    signingNow: "the place you are signing now",
    toCome: "still to come",
    elsewhere: (page: number, at: number): string =>
      `You are reading page ${page}. The place you are signing is on page ${at}.`,
    takeMeBack: "Take me back",
    /** A document's page, to a screen reader: "Drug and alcohol release, page 2 of 3". */
    documentPage: (label: string, n: number, of: number): string => `${label}, page ${n} of ${of}`,
    labelOnPage: (label: string, page: number): string => `${label}, page ${page}`,
  },
} as const;
