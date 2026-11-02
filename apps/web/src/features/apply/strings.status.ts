import { sentenceCase } from "./sentenceCase";

/**
 * The status the three wait screens show (HIRING-WORKFLOW-AUDIT §13 SP1): four stages and what the
 * applicant still owes. Its own file for `strings.videos.ts`' reason, spread into `APPLY_COPY` so
 * `strings.test.ts` walks it.
 *
 * ⚠ Kinds, never details (D-SP3): "your drug test is booked", never where or when — a forwarded link is
 * read by whoever holds it. Each item says where the details went, and to call the office if they did not.
 */
export const APPLY_STATUS_COPY = {
  status: {
    heading: "Where your application is",
    stages: {
      permissions: "Permissions signed",
      application: "Application filled in and sent",
      review: (carrier: string): string => `${sentenceCase(carrier)} reads it`,
      visit: "Office visit: road test, orientation and signing",
    },
    stateWords: { done: "Done", current: "Now", later: "Later" },
    owesHeading: "For you to do",
    owes: {
      drug_test: (carrier: string): string =>
        `Go to your drug test. ${sentenceCase(carrier)} sent you where and when by text. If you did not get it, call them.`,
      videos: "Watch your orientation videos before you come in.",
      trip: (carrier: string): string =>
        `Your trip to ${carrier} is booked. The details were sent to you by email or text. If you did not get them, call them.`,
    },
    videosLink: "Open the videos",
  },
} as const;
