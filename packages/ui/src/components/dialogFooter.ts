/**
 * The footer of the one drawer (`SlideOver`) and the one centred dialog (`BaseModal`): the buttons on
 * the right, 12 px apart, secondary first and the primary last (DESIGN-SYSTEM-CONTRACT §6.2), wrapping
 * onto a second row when a phone is too narrow for them.
 *
 * It is the primitive's, not each caller's (small-screens audit, 2026-11-15). Until then the footer
 * slot was a plain block and every caller wrote this row itself: forty-odd drawers did, identically,
 * and the ones that forgot shipped with their buttons at the left edge touching each other — Correct
 * mileage's drawer, and every chat dialog with two buttons. None of them wrapped, so three buttons
 * at 390 px ran off the panel.
 *
 * A footer that is NOT a row of buttons (a note field above them, an action held apart on the left)
 * passes one element with `w-full` and lays itself out inside it.
 */
export const DIALOG_FOOTER_CLASS = "flex flex-wrap items-center justify-end gap-3";
