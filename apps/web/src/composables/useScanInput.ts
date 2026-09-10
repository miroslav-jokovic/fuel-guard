import { onBeforeUnmount, onMounted, type Ref } from "vue";

/**
 * Read a Bluetooth HID barcode scanner (INVENTORY-PLAN.md I6, the scanner half; D-INV2, D-INV17).
 *
 * ── WHAT A HID SCANNER ACTUALLY IS, AND WHY THAT DECIDES THIS FILE ────────────────────────────
 * A Bluetooth scanner in HID mode is a keyboard. It pairs in iOS Settings like an Apple keyboard,
 * and on a decode it types the barcode's characters and then — by factory default on every model in
 * the shop's price bracket — an Enter. There is no API, no permission prompt, no WebAssembly and no
 * camera: the browser sees `keydown`, and the entire integration is deciding which keystrokes came
 * from a machine and which came from a thumb.
 *
 * That is why this path was built BEFORE the camera. A1 — does the free WASM decoder read a greasy
 * supplier UPC on the shop's phones — gates the camera and nothing else; a hardware imager makes the
 * question moot for the receiving desk, which is where UPCs are actually scanned. The camera half of
 * I6 still lands, for whoever is standing at a shelf with no scanner in their pocket, and it lands
 * behind the same `resolve → verb` path this composable already feeds.
 *
 * ── SPEED IS THE ONLY SIGNAL, AND THE THRESHOLD IS PUBLISHED ──────────────────────────────────
 * A scanner emits its characters in a burst of a few milliseconds each; a person types at 100–200 ms
 * per character, and even a fast typist rarely sustains under 100 ms across a whole barcode. So the
 * rule the keyboard-wedge literature settles on, and the one implemented here, is: a gap longer than
 * `HUMAN_GAP_MS` between two characters means a human, and the burst starts over from that
 * character. Everything still in the buffer therefore arrived within 100 ms of its predecessor —
 * which means a buffer that has reached `MIN_SCAN_LENGTH` IS a machine-speed burst by construction,
 * and no second "was it fast?" test is needed at the point of emission.
 *
 * ⚠ A false positive here is cheap and a false negative is not, and the design leans that way
 * deliberately. If somebody types fifteen characters at machine speed with nothing focused, this
 * emits a scan, the resolve endpoint answers `malformed`, and the screen says it did not recognise
 * the code — a dead end that costs one tap. If a real scan were missed, a technician would stand in
 * a bay pulling a trigger at a label that works, which is the failure that makes people stop using
 * a product.
 *
 * ── WHY A DOCUMENT LISTENER AND NOT A HIDDEN FOCUSED INPUT ────────────────────────────────────
 * The other common shape is a permanently focused off-screen `<input>` that re-focuses on every
 * blur. It was rejected for three reasons, each of which is a bug on a phone rather than a
 * preference. It fights every other control on the page for focus, so a drawer's own fields lose it
 * mid-typing. It is an editable element, so on a phone with NO scanner paired it raises the soft
 * keyboard over half the screen and there is no honest way to stop it. And it makes "scan while a
 * result card is on screen" — the continuous flow the whole surface exists for — depend on focus
 * having survived whatever the technician last touched.
 *
 * A document listener has none of those properties: it does not care what is focused, it raises no
 * keyboard, and it keeps working while a result is being read.
 *
 * ⚠ **The one thing that must be checked on a real device, and is written down rather than
 * assumed.** iOS is documented as inconsistent about delivering hardware-keyboard events to a page
 * with no focused element. If the A1 device session finds that keystrokes do not reach `document` on
 * iOS Safari, the fix is one line — focus the page's typed-entry field on mount and let the wedge
 * type into it — and the rest of this file is unaffected, because the timing rule is what does the
 * work either way. It is stated here so that the next reader tests it rather than trusting it.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ─────────────────────────────────────────────────────────────
 * Decode feedback. Research §4.3 requires it to be obvious, and on this path the SCANNER ITSELF
 * beeps on a successful read — a hardware beep from the device in the technician's hand, which is
 * better than anything a web page can do and needs no permission. What the hardware cannot say is
 * whether the code RESOLVED, and that is the screen's job, not this file's.
 */

/**
 * A gap longer than this between two characters means a person is typing, and the burst restarts.
 *
 * 100 ms is the published wedge-detection threshold and it sits in a wide gap: scanners in this
 * class emit at roughly 5–20 ms per character, and human typing — even fast, even practised —
 * clusters well above it. Lowering it would start dropping characters from a scanner on a busy
 * Bluetooth channel; raising it would start accepting a fast typist as a machine.
 */
const HUMAN_GAP_MS = 100;

/**
 * The shortest burst that may be emitted as a scan.
 *
 * Six, because nothing shorter is a real symbology anybody in this shop will present: our own tag is
 * fifteen characters (`SIL1:BIN:7K3M9P`), a UPC-E is eight, a UPC-A twelve, an EAN-13 thirteen. The
 * floor exists to keep an accidental fast two-key press from becoming a resolve call, and it is set
 * below every real code rather than at one of them so that a symbology nobody anticipated still
 * arrives intact.
 */
const MIN_SCAN_LENGTH = 6;

/**
 * How long to wait after the last character before emitting a burst that never got its Enter.
 *
 * Every scanner in the shop's bracket ships with an Enter suffix on by default, so the normal path
 * ends on `Enter` and never reaches this timer. It exists for the scanner whose suffix somebody has
 * turned off in a configuration barcode months ago and cannot remember — a case that otherwise
 * presents as "the scanner beeps and nothing happens", which is unattributable from the shop floor.
 * 200 ms is long enough that no scanner is still mid-burst and short enough to feel immediate.
 */
const IDLE_FLUSH_MS = 200;

/**
 * The same code scanned again within this window is one scan, not two.
 *
 * Research §4.3 takes this from Zebra's DataWedge, which calls it Same Symbol Timeout: a scanner
 * held in continuous or auto-sense mode pointed at one label fires repeatedly, and without this a
 * single carton would open the verb sheet five times. A deliberate second read of the same label —
 * a technician checking they scanned the right bin — is slower than 800 ms and comes through.
 */
const SAME_CODE_MS = 800;

/** Characters typed into a form field belong to that field, never to the scan stream. */
function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
}

export interface ScanInputOptions {
  /**
   * Whether to listen at all. False while a drawer owns the keyboard, so that a scan cannot fire a
   * second verb sheet on top of a half-completed form — and false is what the page sets, because the
   * page is the only thing that knows a drawer is open.
   */
  enabled: Ref<boolean>;
  /** A machine-speed burst, exactly as the scanner typed it. Never trimmed of its own characters. */
  onScan: (code: string) => void;
}

export function useScanInput({ enabled, onScan }: ScanInputOptions) {
  let buffer = "";
  let lastKeyAt = 0;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let lastEmitted = "";
  let lastEmittedAt = 0;

  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  function reset() {
    buffer = "";
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  /** Emit, unless this is the same label the scanner is still pointed at (`SAME_CODE_MS`). */
  function emit() {
    const code = buffer;
    reset();
    if (code.length < MIN_SCAN_LENGTH) return;
    const at = now();
    if (code === lastEmitted && at - lastEmittedAt < SAME_CODE_MS) return;
    lastEmitted = code;
    lastEmittedAt = at;
    onScan(code);
  }

  function onKeydown(event: KeyboardEvent) {
    if (!enabled.value) return;
    // A shortcut, not a scan. A scanner sends Shift for `:` and for upper case and sends nothing
    // else, so Shift is the one modifier that must NOT disqualify a keystroke.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (isEditable(event.target)) return;

    if (event.key === "Enter" || event.key === "Tab") {
      const complete = buffer.length >= MIN_SCAN_LENGTH;
      // Only swallow the key when it terminated a scan. An Enter that did not is somebody
      // activating a focused button, and stealing it would break every control on the page.
      if (complete) event.preventDefault();
      if (complete) emit();
      else reset();
      return;
    }

    // Shift, Escape, the arrows, an F-key: not content, and — this is the half that matters — not a
    // reason to drop the burst. A scanner presses Shift between characters.
    if (event.key.length !== 1) return;

    const at = now();
    if (buffer.length > 0 && at - lastKeyAt > HUMAN_GAP_MS) buffer = "";
    buffer += event.key;
    lastKeyAt = at;

    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = setTimeout(emit, IDLE_FLUSH_MS);
  }

  onMounted(() => document.addEventListener("keydown", onKeydown));
  onBeforeUnmount(() => {
    document.removeEventListener("keydown", onKeydown);
    reset();
  });

  return {
    /**
     * Feed a code in as though it had been scanned — the typed-entry field's path, so that a
     * technician who types a code by hand lands in exactly the same place as one who scans it.
     * Bypasses the timing rule, which is about the input stream and not about intent, and bypasses
     * the same-code window, because typing the same code twice is deliberate every time.
     */
    submit(code: string) {
      const trimmed = code.trim();
      if (trimmed.length === 0) return;
      lastEmitted = trimmed;
      lastEmittedAt = now();
      onScan(trimmed);
    },
  };
}
