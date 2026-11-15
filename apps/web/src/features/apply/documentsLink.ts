import type { DocumentsLinkBundle } from "@silvicom/shared";

/**
 * Is what the link opened on the documents-only bundle (Q-AM19, 0608)? The application's own bundle has
 * no such key, so this one question is what the page branches on — before anything reads a phase, a
 * release or a draft, none of which this bundle has.
 */
export const isDocumentsLinkBundle = (bundle: unknown): bundle is DocumentsLinkBundle =>
  typeof bundle === "object" && bundle !== null && (bundle as { documentsOnly?: unknown }).documentsOnly === true;
