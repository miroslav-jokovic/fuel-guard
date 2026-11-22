import { onBeforeUnmount, watchEffect, type Ref } from "vue";

/**
 * The careers pages' `<title>`, `<meta name="description">` and `<link rel="canonical">` (APPLY-PAGE-PLAN AP3).
 *
 * Nothing else in the app sets a head: the office's pages are behind a sign-in and the applicant's link is not for
 * search engines. These pages are the opposite. They are what Google and Indeed read (Q-APX32), and the same job
 * answers on two hosts (`careers.silvicominc.com` and the office host's `/careers`, D-AP9). So the canonical link
 * names the one the API says is the page's address (`pageUrl`), and a search engine keeps one copy.
 *
 * Everything put in is taken out on leaving, so an office page opened afterwards in the same tab inherits none of it.
 */
export interface PageHead {
  title: string;
  description: string;
  canonical: string;
}

/** index.html's title, read once when this module loads: before any careers page has set one of its own. */
const APP_TITLE = document.title;

export function usePageHead(head: Ref<PageHead | null>): void {
  let setTitle: string | null = null;
  // Each page makes its OWN two elements and removes only those. Going from the list to a job mounts the job before
  // the list unmounts, so elements shared by a selector would be removed from under the page that just arrived.
  const description = document.createElement("meta");
  description.setAttribute("name", "description");
  const canonical = document.createElement("link");
  canonical.setAttribute("rel", "canonical");
  watchEffect(() => {
    const h = head.value;
    if (!h) return;
    document.title = setTitle = h.title;
    description.setAttribute("content", h.description);
    canonical.setAttribute("href", h.canonical);
    if (!description.isConnected) document.head.append(description, canonical);
  });
  onBeforeUnmount(() => {
    description.remove();
    canonical.remove();
    // Only a title this page still owns: the next page may already have set its own.
    if (setTitle !== null && document.title === setTitle) document.title = APP_TITLE;
  });
}
