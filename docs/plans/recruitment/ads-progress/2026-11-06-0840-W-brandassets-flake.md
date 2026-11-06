**2026-11-06 · Track W · w-two-smalls, PR 1: the brandAssets flake (#PR)** — no migration, no readiness change.

- **The real cause was not the fixture.** The old cut was already deterministic: 544 of 1,088 bytes, inside IDAT.
  The non-determinism is libvips. `sharp(bytes, { failOn: "error" })` + `stats()` refused the cut PNG 0 of 200
  times alone, and 0 of 30 beside decodes that succeed. But with OTHER failing decodes in the same process it
  accepted it as a good image: 8 of 40 beside other cut PNGs, 15 of 40 beside non-images, and 123 of 320 with 16
  identical decodes in flight. libvips keeps its error state per process; vitest's worker threads share one libvips.
- **It was a production bug too.** Two bad uploads at once, or a Checker run beside one upload, could store a
  broken picture as `ready`.
- **Built:** `creative/imageComplete.ts`, a pure completeness check that `prepareAsset` runs before libvips.
  - PNG: the chunk walk (bounds, CRC32, IHDR first, IEND at the very end), and the joined IDAT inflated by Node's
    zlib to exactly the size the header needs (Adam7 included).
  - JPEG: ends in EOI. WebP: the RIFF size covers the file.
  - The refusal names what is wrong: "…cannot be read as one: it is cut short." and the like.
- **The fixture:** a 200×200 PNG built from constants (our own chunk writer and `deflateSync`, level 9), cut at a fixed
  offset 10 bytes into IDAT's data. The test asserts the offset lies inside IDAT, asserts the EXACT refusal (code
  and reason), and asserts that the uncut constant PNG is `ready`. Nothing was loosened.
- **New tests:**
  - The cut file is refused 40 rounds running beside 15 failing decodes. This is red without the check, so the
    race is real in the test process.
  - Chunks whole but picture data short (a cut stream re-wrapped with a valid CRC, and a whole stream of 100 of 200
    rows); one flipped byte (CRC); a cut JPEG and WebP.
- **50× loop of the cut-short tests: 50 passed, 0 failed.**
- Mutation: 6 mutants, all killed by a named test, each file restored byte for byte: the check removed, chunk bounds,
  CRC, the inflated-size check, JPEG EOI, WebP size. CRC and inflated-size first SURVIVED (no case reached them),
  and each got its own case.
