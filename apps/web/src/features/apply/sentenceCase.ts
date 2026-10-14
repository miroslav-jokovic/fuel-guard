/**
 * A name that opens a sentence, with its first letter capitalised (US6b F29).
 *
 * The carrier's name reaches sixteen applicant sentences as their first word, and when the carrier has
 * no name on file the API says "the carrier" instead (`publicApplicationBundle.ts`) — which then
 * opened a sentence in lower case: "the carrier has read your application." A real name is returned
 * unchanged, so "Silvicom Inc" and "acme logistics" read exactly as the carrier typed them mid-line.
 */
export const sentenceCase = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
