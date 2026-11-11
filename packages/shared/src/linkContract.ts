/**
 * "No narrowing", for a page parameter whose ABSENCE means a default (F21 R4b link contracts): the
 * Applicants board opens on "waiting on you" and the Drivers roster on active drivers, so a link for
 * everybody must spell it. ⚠ RESTATED from `@silvicom/ui`'s `ANY_PARAM`, the value
 * `useQueryState.param` reads: `packages/ui` takes no workspace dependency, so it cannot import this.
 * The two are pinned equal by the web test "the link contracts' any is the query state's ANY_PARAM".
 * Removed when `ANY_PARAM` moves to a package both can import.
 */
export const LINK_ANY = "any";
