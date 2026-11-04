/**
 * Higgsfield credits per model path (C3; workflow V4). EMPTY ON PURPOSE: the real prices are V4's
 * measurement against the owner's key (Q-AD20, gate G2), not yet made. A model missing here is refused
 * by `creditGate` (`price_unknown`) — a guessed price would let the monthly budget promise something it
 * cannot keep. Fill an entry only with a price read from Higgsfield's own pricing for that model, citing
 * the page and the date beside it. Tests inject their own table.
 */
export const HIGGSFIELD_CREDIT_PRICES: Readonly<Record<string, number>> = {};

/**
 * The Higgsfield model compose renders stills with (C5b2). NULL ON PURPOSE, for the same reason the price
 * table is empty: which model draws our trucks best, and at what price, is V4's measurement with the owner's
 * key (Q-AD20). Until then every compose stops at the render with "no still model chosen yet (V4)" — a
 * visible refusal, never a model somebody picked by name. Set it with its price, in the same PR.
 */
export const HIGGSFIELD_STILL_MODEL: string | null = null;

