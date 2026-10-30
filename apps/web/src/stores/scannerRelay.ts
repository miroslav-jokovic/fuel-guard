import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { deliverRelayedScan } from "@/composables/useScanInput";
import { scannerApi } from "@/composables/useScanners";
import { useToastStore } from "@/stores/toast";

/**
 * "Use the office scanner" on THIS device (SCANNER-RELAY-PLAN.md SR4; D-SR3, D-SR6).
 *
 * ── ONE TAB HOLDS ONE SCANNER ────────────────────────────────────────────────────────────────
 * The tab has a random id (`session`), kept in sessionStorage so a reload is the same tab and keeps
 * its scanner — the lease outlives a reload by design (90 s). Taking a scanner starts the WAIT: a
 * long poll that renews the lease, brings this tab's reads, and says when somebody else took it.
 *
 * ── A READ GOES WHERE A KEYSTROKE WOULD ──────────────────────────────────────────────────────
 * Each read is handed to `deliverRelayedScan`, i.e. to every enabled `useScanInput` on the page —
 * the Scan page, Assign equipment, a unit check, Add equipment's sticker field, the scanner test. No
 * screen of its own. With no scan screen open the read is shown as a notice, never dropped silently.
 *
 * ── THE WAIT NEVER GIVES UP ON ITS OWN ───────────────────────────────────────────────────────
 * A dropped connection is retried with a growing pause; the lease (90 s) rides out a short outage.
 * Only three things end the wait: "Stop using", somebody else taking it (said by name), or the
 * scanner being retired.
 */

const SESSION_KEY = "silvicom:scanner-session";
const HELD_KEY = "silvicom:scanner-held";
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000];

/** sessionStorage, when the browser has one — a private window or jsdom may not. */
function stored(key: string): string | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function store(key: string, value: string | null) {
  try {
    if (typeof sessionStorage === "undefined") return;
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // no storage: the tab simply forgets its scanner on reload
  }
}

function tabSession(): string {
  const existing = stored(SESSION_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  store(SESSION_KEY, id);
  return id;
}

export interface HeldScanner {
  id: string;
  name: string;
}

export type TakeResult = { ok: true } | { ok: false; heldBy: string } | { ok: false; error: string };

export const useScannerRelayStore = defineStore("scannerRelay", () => {
  const toast = useToastStore();
  const session = tabSession();
  const held = ref<HeldScanner | null>(null);
  /** The last read and when — the bar's proof that a scan arrived. */
  const lastRead = ref<{ code: string; at: number; used: boolean } | null>(null);
  /** True while the connection is being retried. */
  const reconnecting = ref(false);
  /** Bumped on every take and stop, so a wait that was in flight knows it is no longer wanted. */
  let generation = 0;
  let cursor = 0;

  const holding = computed(() => held.value !== null);

  function remember(next: HeldScanner | null) {
    held.value = next;
    store(HELD_KEY, next ? JSON.stringify(next) : null);
  }

  function lost(message: string, detail?: string) {
    generation += 1;
    remember(null);
    reconnecting.value = false;
    toast.warning(message, detail);
  }

  function receive(code: string) {
    const used = deliverRelayedScan(code);
    lastRead.value = { code, at: Date.now(), used };
    if (!used) toast.info(`Scanned ${code}`, "Open Scan, or a screen with a scan field, to use it.");
  }

  async function loop(mine: number, scanner: HeldScanner) {
    let failures = 0;
    while (generation === mine) {
      try {
        const answer = await scannerApi.wait(scanner.id, session, cursor);
        if (generation !== mine) return;
        failures = 0;
        reconnecting.value = false;
        if (!answer.held) {
          lost(
            answer.holderName ? `${answer.holderName} is using ${scanner.name} now` : `${scanner.name} is no longer yours`,
            "Its scans go to them. Take it back from Scan or Settings.",
          );
          return;
        }
        for (const read of answer.reads) {
          cursor = Math.max(cursor, read.id);
          receive(read.code);
        }
      } catch (e) {
        if (generation !== mine) return;
        if ((e as { status?: number }).status === 404) {
          lost(`${scanner.name} was removed`, "It was retired in Settings.");
          return;
        }
        reconnecting.value = true;
        await new Promise((r) => setTimeout(r, BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)]));
        failures += 1;
      }
    }
  }

  function start(scanner: HeldScanner) {
    generation += 1;
    cursor = 0;
    remember(scanner);
    void loop(generation, scanner);
  }

  /** "Use on this device". Held by somebody else and not forced: says who, and changes nothing. */
  async function take(scanner: HeldScanner, force = false): Promise<TakeResult> {
    try {
      const r = await scannerApi.take(scanner.id, session, force);
      if (r.outcome === "held") return { ok: false, heldBy: r.holderName };
      if (held.value && held.value.id !== scanner.id) void scannerApi.release(held.value.id, session).catch(() => {});
      start(scanner);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Could not use the scanner" };
    }
  }

  /** "Stop using". The lease is cleared at once, so the next person need not wait 90 seconds. */
  async function release() {
    const scanner = held.value;
    generation += 1;
    remember(null);
    reconnecting.value = false;
    lastRead.value = null;
    if (scanner) await scannerApi.release(scanner.id, session).catch(() => {});
  }

  /** After a reload: the same tab resumes the scanner it held, if the lease is still its own. */
  function resume() {
    if (held.value) return;
    const saved = stored(HELD_KEY);
    if (!saved) return;
    try {
      const scanner = JSON.parse(saved) as HeldScanner;
      if (typeof scanner?.id === "string" && typeof scanner?.name === "string") start(scanner);
    } catch {
      store(HELD_KEY, null);
    }
  }

  return { session, held, holding, lastRead, reconnecting, take, release, resume };
});
