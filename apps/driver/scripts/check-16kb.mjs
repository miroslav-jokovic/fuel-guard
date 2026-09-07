#!/usr/bin/env node
/**
 * Fail if any native library in a built artifact is not 16 KB page-aligned (DIRECTION-B-PLAN §6
 * P1.5, store fact "16 KB page sizes").
 *
 * WHY. Android 15 introduced devices whose kernel page size is 16 KB, and Play has required
 * 16 KB-compatible apps for anything targeting Android 15+ since 2025-11-01 (hard stop for updates
 * 2027-02-01). A `.so` whose LOAD segments are aligned to 4 KB does not load on such a device: the
 * app installs, the icon appears, and it crashes on the first screen that touches that library.
 * There is no build warning. `useLegacyPackaging=false` and NDK r28's defaults are what SHOULD make
 * this true here — which is exactly why it needs measuring rather than asserting. The check, not a
 * sentence in a plan, decides (§7 Q-PR5).
 *
 * WHAT IT MEASURES. Every PT_LOAD program header of every `lib/**​/*.so` inside the artifact must
 * declare `p_align >= 16384`. That is the whole rule.
 *
 * DEVIATION FROM THE PLAN, stated rather than hidden: P1.5 specified `llvm-objdump -p` from the
 * NDK. This reads the ELF program headers directly instead, in Node. Three reasons — it needs no
 * toolchain, so it runs identically on a laptop, in `driver-android.yml` and in a future EAS lane;
 * it can be unit-tested against synthesised headers, so the parser itself is held by tests
 * (tests/elf-alignment.test.ts) rather than by having once agreed with a tool; and it reports per
 * library rather than per invocation. `llvm-objdump` has NOT been dropped: when one is discoverable
 * this script runs it too and FAILS on any disagreement, so the hand-rolled reader is checked
 * against the reference wherever the reference exists. The summary line always says which of the
 * two happened — a cross-check that silently did not run would be worse than none.
 *
 *   node scripts/check-16kb.mjs <app.apk | app.aab | universal.apk | directory>
 *   node scripts/check-16kb.mjs --min-align 4096 <artifact>      (loosen, for an experiment)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

/** Play's requirement. 2**14. */
export const REQUIRED_ALIGNMENT = 16384;

const PT_LOAD = 1;

/**
 * Read the PT_LOAD alignments out of an ELF file.
 *
 * Handles both classes and both byte orders because Android ships four ABIs and armeabi-v7a and
 * x86 are still 32-bit. Throws on anything that is not an ELF — a `.so` that is not one is a
 * finding, not something to skip quietly.
 *
 * @param {Buffer} buffer whole file
 * @returns {{ bits: 32|64, endian: 'LE'|'BE', loadAlignments: number[] }}
 */
export function readElfLoadAlignments(buffer) {
  if (buffer.length < 64) throw new Error('file is too short to be an ELF');
  if (buffer[0] !== 0x7f || buffer.toString('latin1', 1, 4) !== 'ELF') {
    throw new Error('file does not start with the ELF magic');
  }

  const bits = buffer[4] === 2 ? 64 : buffer[4] === 1 ? 32 : null;
  if (bits === null) throw new Error(`unknown ELF class byte 0x${buffer[4].toString(16)}`);
  const endian = buffer[5] === 1 ? 'LE' : buffer[5] === 2 ? 'BE' : null;
  if (endian === null) throw new Error(`unknown ELF data byte 0x${buffer[5].toString(16)}`);

  const u16 = (offset) => (endian === 'LE' ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset));
  const u32 = (offset) => (endian === 'LE' ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset));
  // Program-header offsets and alignments are u64 on ELF64. They are small in practice, but reading
  // them as Number via BigInt keeps the arithmetic honest rather than assuming they fit.
  const u64 = (offset) => {
    const value = endian === 'LE' ? buffer.readBigUInt64LE(offset) : buffer.readBigUInt64BE(offset);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('64-bit field exceeds 2^53');
    return Number(value);
  };

  const phoff = bits === 64 ? u64(0x20) : u32(0x1c);
  const phentsize = u16(bits === 64 ? 0x36 : 0x2a);
  const phnum = u16(bits === 64 ? 0x38 : 0x2c);

  const expectedEntry = bits === 64 ? 56 : 32;
  if (phentsize < expectedEntry) {
    throw new Error(`e_phentsize ${phentsize} is smaller than an ELF${bits} program header`);
  }
  if (phoff === 0 || phnum === 0) throw new Error('ELF has no program header table');
  if (phoff + phnum * phentsize > buffer.length) {
    throw new Error('program header table runs past the end of the file');
  }

  const loadAlignments = [];
  for (let i = 0; i < phnum; i += 1) {
    const entry = phoff + i * phentsize;
    if (u32(entry) !== PT_LOAD) continue;
    loadAlignments.push(bits === 64 ? u64(entry + 48) : u32(entry + 28));
  }
  return { bits, endian, loadAlignments };
}

/**
 * `llvm-objdump -p` prints one `align 2**N` per program header. Parsing only the LOAD lines keeps
 * this comparable with the reader above, which ignores every other segment type.
 *
 * @returns {number[]} alignments in BYTES, in file order
 */
export function parseObjdumpLoadAlignments(text) {
  const alignments = [];
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*LOAD\b.*?\balign\s+2\*\*(\d+)/);
    if (match) alignments.push(2 ** Number(match[1]));
  }
  return alignments;
}

/**
 * The verdict. A library passes when EVERY LOAD segment is aligned to at least `minAlign`; the
 * worst segment is what is reported, because that is the one that decides.
 *
 * @param {{ name: string, loadAlignments: number[] }[]} libraries
 */
export function verdict(libraries, minAlign = REQUIRED_ALIGNMENT) {
  return libraries.map((library) => {
    const worst = library.loadAlignments.length === 0 ? 0 : Math.min(...library.loadAlignments);
    return { name: library.name, worst, ok: worst >= minAlign };
  });
}

// ── everything below touches the filesystem ─────────────────────────────────────────────────────

/** Android puts natives at `lib/<abi>/x.so` in an APK and `base/lib/<abi>/x.so` in an AAB, so the
 *  search is by extension under any directory rather than by a fixed path. */
function findSharedObjects(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findSharedObjects(path));
    else if (entry.name.endsWith('.so')) found.push(path);
  }
  return found;
}

function extract(archive) {
  const dir = mkdtempSync(join(tmpdir(), 'check-16kb-'));
  const result = spawnSync('unzip', ['-o', '-q', archive, '*.so', '-d', dir], {
    encoding: 'utf8',
  });
  // unzip exits 11 for "no matching files", which is a real answer (an artifact with no natives)
  // rather than an error. Anything else is a broken archive or a missing unzip.
  if (result.error) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`could not run unzip: ${result.error.message}`);
  }
  if (result.status !== 0 && result.status !== 11) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`unzip failed (${result.status}): ${result.stderr}`);
  }
  return dir;
}

/** The NDK's copy is the one Android ships; a system llvm-objdump is fine too. Absent is fine — the
 *  cross-check is a bonus, not the measurement. */
function findObjdump() {
  if (process.env.LLVM_OBJDUMP) return process.env.LLVM_OBJDUMP;
  const home = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (home && existsSync(join(home, 'ndk'))) {
    for (const version of readdirSync(join(home, 'ndk')).sort().reverse()) {
      const prebuilt = join(home, 'ndk', version, 'toolchains/llvm/prebuilt');
      if (!existsSync(prebuilt)) continue;
      for (const host of readdirSync(prebuilt)) {
        const candidate = join(prebuilt, host, 'bin/llvm-objdump');
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  const onPath = spawnSync('which', ['llvm-objdump'], { encoding: 'utf8' });
  return onPath.status === 0 ? onPath.stdout.trim() : null;
}

function main() {
  const args = process.argv.slice(2);
  let minAlign = REQUIRED_ALIGNMENT;
  const minIndex = args.indexOf('--min-align');
  if (minIndex >= 0) {
    minAlign = Number(args[minIndex + 1]);
    args.splice(minIndex, 2);
  }
  const target = args[0];
  if (!target) {
    console.error('usage: check-16kb.mjs <app.apk | app.aab | directory> [--min-align N]');
    process.exit(2);
  }
  if (!existsSync(target)) {
    console.error(`::error::${target} does not exist`);
    process.exit(2);
  }

  const isDirectory = statSync(target).isDirectory();
  const root = isDirectory ? target : extract(target);
  try {
    const paths = findSharedObjects(root);
    if (paths.length === 0) {
      // Not a pass. An artifact with no natives is either not the artifact that was meant or an
      // extraction that silently did nothing, and calling that "16 KB clean" is the exact shape of
      // green-for-the-wrong-reason this repo keeps finding.
      console.error(`::error::no .so files found in ${target} — nothing was checked`);
      process.exit(1);
    }

    const objdump = findObjdump();
    const libraries = [];
    let disagreements = 0;

    for (const path of paths) {
      // Relative to the artifact root, not a basename: an APK carries the SAME library name under
      // four ABI directories, and `libsql_experimental.so` failing tells nobody which of the four.
      const name = relative(root, path);
      const { bits, endian, loadAlignments } = readElfLoadAlignments(readFileSync(path));
      libraries.push({ name, bits, endian, loadAlignments });

      if (objdump) {
        const dump = spawnSync(objdump, ['-p', path], { encoding: 'utf8', maxBuffer: 32 << 20 });
        if (dump.status === 0) {
          const reference = parseObjdumpLoadAlignments(dump.stdout);
          if (reference.join(',') !== loadAlignments.join(',')) {
            console.error(
              `::error::${name}: this script read LOAD alignments [${loadAlignments}] but ` +
                `llvm-objdump read [${reference}]. The ELF reader is wrong, not the library.`,
            );
            disagreements += 1;
          }
        }
      }
    }

    const results = verdict(libraries, minAlign);
    const failures = results.filter((r) => !r.ok);
    for (const result of results) {
      const library = libraries[results.indexOf(result)];
      console.log(
        `${result.ok ? '✓' : '✗'} ${result.name}  ELF${library.bits}${library.endian}  ` +
          `${library.loadAlignments.length} LOAD  worst align ${result.worst}`,
      );
    }
    console.log(
      `\n${results.length} librar${results.length === 1 ? 'y' : 'ies'} checked against ` +
        `${minAlign} bytes; cross-check against llvm-objdump: ${objdump ? objdump : 'NOT RUN (none found)'}`,
    );

    if (disagreements > 0) process.exit(1);
    if (failures.length > 0) {
      console.error(
        `\n::error::${failures.length} librar${failures.length === 1 ? 'y is' : 'ies are'} not ` +
          `${minAlign}-byte aligned: ${failures.map((f) => `${f.name} (${f.worst})`).join(', ')}. ` +
          'Bump that library; if no aligned release exists, replace it (plan §7 Q-PR5).',
      );
      process.exit(1);
    }
  } finally {
    if (!isDirectory) rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
