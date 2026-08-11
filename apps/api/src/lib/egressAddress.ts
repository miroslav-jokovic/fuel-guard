/**
 * The address WEX sees when this process dials them.
 *
 * ── Why the probes report this ───────────────────────────────────────────────────────────────────
 * Card operations have been refused, then worked (199 cards), then been refused again, from the same
 * build and the same credentials. An entitlement does not flap. An IP allowlist does — if this API's
 * egress address is drawn from a pool and only some of that pool is allowlisted, every run is a coin
 * toss, which is exactly the pattern observed. Naming the address turns that from a theory into a
 * value WEX can paste into their allowlist, and comparing it across runs settles whether it moves.
 *
 * It matters twice over on a second EFS environment: WEX allowlists per environment, so "the same
 * three IPs" being added to QA is a claim we can check rather than assume, and a QA login that fails
 * at step 1 is a very different problem depending on whether we left from an allowlisted address.
 *
 * Best-effort by construction: three seconds, and any failure returns null. A diagnostic that can
 * fail because an unrelated third party is down is not a diagnostic.
 *
 * Lives in lib/ rather than in either probe because both of them need it and neither owns it.
 */
export async function egressAddress(): Promise<string | null> {
  try {
    const res = await fetch("https://checkip.amazonaws.com", { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const text = (await res.text()).trim();
    // Whatever comes back is echoed into a response and an audit row, so accept only an IP literal.
    return /^[0-9a-f.:]{7,45}$/i.test(text) ? text : null;
  } catch {
    return null;
  }
}
