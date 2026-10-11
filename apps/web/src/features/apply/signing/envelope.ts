import { HANDBOOK_DRIVER_PLACEMENT_IDS } from "@silvicom/shared";

/**
 * The envelope's places: the packet's and then the handbook's, counted as one walk (D-AW16, C3s4b).
 *
 * ── WHY ONE COUNT ACROSS TWO DOCUMENTS ────────────────────────────────────────────────────────
 * The owner's model is one envelope at step 13, walked place by place: packet places → certification
 * (files the packet) → handbook places, and *"Place N of M" spans both*. A driver watching "Place 14 of
 * 14" and then meeting five more would be told the end twice; a count that runs 1..19 across the two
 * says where the end is from the first screen.
 *
 * ⚠ **Derived here and nowhere else.** The packet's part is whatever the server served this applicant
 * (`packetStops` — 14 for a company driver, 15 for an owner-operator since Q-HM14 and D-AW16's p25
 * withdrawal); the handbook's part is the shared placement list. Nothing is restated: a handbook that
 * gains a place, or a packet that loses one, moves this with it.
 *
 * ⚠ **The handbook's places are NOT in `record_packet_mark`'s `p_expected_count`** (D-AW16). They are
 * two filings on two tables, and only the count the driver READS is shared.
 */
export const HANDBOOK_PLACES = HANDBOOK_DRIVER_PLACEMENT_IDS.length;

/** "M" in "Place N of M": the packet's places for this applicant, then the handbook's. */
export const envelopePlaces = (packetPlaces: number): number => packetPlaces + HANDBOOK_PLACES;

/** "N" for a handbook place: after every packet place, and after the handbook places already signed. */
export const handbookPlaceNumber = (packetPlaces: number, handbookSigned: number): number =>
  packetPlaces + handbookSigned + 1;
