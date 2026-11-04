import { AD_NAME_LANGUAGES, type AdNameLanguage } from "@silvicom/shared";

/**
 * Where a campaign keeps its Instant Form ids (B2c1): `platform_refs.meta_form_ids`, one per language,
 * because a Spanish ad opens a Spanish form. Every reader that finds a campaign BY its form — the webhook,
 * the fetch, the backfill — reads them through here, with the languages taken from `AD_NAME_LANGUAGES`
 * (the list the publisher makes a form for), so a third language reaches intake the day it reaches the
 * publisher. Before B2c2 intake read one `meta_form_id`; no campaign ever held it (`createPaused` was null).
 */
export const FORM_ID_PATHS: ReadonlyArray<{ language: AdNameLanguage; path: string }> =
  AD_NAME_LANGUAGES.map((language) => ({ language, path: `platform_refs->meta_form_ids->>${language}` }));

/** A campaign's form ids from its `platform_refs`, by language; languages with none are absent. */
export function campaignFormIds(refs: Record<string, unknown> | null | undefined): Array<{ language: AdNameLanguage; form_id: string }> {
  const ids = refs?.meta_form_ids;
  if (!ids || typeof ids !== "object") return [];
  return AD_NAME_LANGUAGES.flatMap((language) => {
    const id = (ids as Record<string, unknown>)[language];
    return typeof id === "string" && id ? [{ language, form_id: id }] : [];
  });
}
