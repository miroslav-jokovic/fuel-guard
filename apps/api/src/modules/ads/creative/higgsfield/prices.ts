/**
 * Higgsfield credits per model path (C3; workflow V4). EMPTY ON PURPOSE: the real prices are V4's
 * measurement against the owner's key (Q-AD20, gate G2), not yet made. A model missing here is refused
 * by `creditGate` (`price_unknown`) — a guessed price would let the monthly budget promise something it
 * cannot keep. Fill an entry only with a price read from Higgsfield's own pricing for that model, citing
 * the page and the date beside it. Tests inject their own table.
 */
export const HIGGSFIELD_CREDIT_PRICES: Readonly<Record<string, number>> = {};
