import type { BoxOnPage } from "@/features/apply/signing/signatureBox";

/**
 * The shapes the one signing walk passes between its parts (D-HB12): the packet's stops and the
 * handbook's places both fit `RailPlace`, and `LocatedPlaces` is what the viewer read out of the bytes.
 */
export interface RailPlace {
  id: string;
  /** The page it is on; null until the document says (the handbook's text flows). */
  page: number | null;
  what: string;
}

/** Where each place is in the document on screen: its page, and its box on that page. */
export type LocatedPlaces = Record<string, { page: number; box: BoxOnPage }>;
