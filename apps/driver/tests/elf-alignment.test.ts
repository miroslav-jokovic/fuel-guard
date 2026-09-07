import { describe, expect, it } from 'vitest';
import {
  parseObjdumpLoadAlignments,
  readElfLoadAlignments,
  REQUIRED_ALIGNMENT,
  verdict,
} from '../scripts/check-16kb.mjs';

/**
 * The 16 KB page-size check (DIRECTION-B-PLAN §6 P1.5) reads ELF program headers itself rather than
 * shelling out to `llvm-objdump`, so the reader is the thing that has to be right. These build ELF
 * headers by hand — the only way to test the 32-bit path, the big-endian path and a malformed file
 * without shipping four binary fixtures into the repository.
 *
 * The script ALSO cross-checks against llvm-objdump whenever one is discoverable and fails on
 * disagreement; that is the check against reality, and it ran clean against expo-sqlite's four real
 * prebuilt libraries on 2026-09-07. This file is the check against the edges reality did not offer.
 */

const PT_LOAD = 1;
const PT_DYNAMIC = 2;

interface Segment {
  type: number;
  align: number;
}
interface ElfOptions {
  bits?: 32 | 64;
  endian?: 'LE' | 'BE';
  segments?: Segment[];
  phentsize?: number;
  phnum?: number;
  phoff?: number;
}

/** A minimal but structurally valid ELF: identification, the few header fields the reader looks at,
 *  and a program header table. Nothing else is needed, because nothing else is read.
 *
 *  `phnum` is deliberately allowed to disagree with `segments.length` — a header that CLAIMS more
 *  entries than the file holds is one of the malformed cases under test, and a helper that sized
 *  the buffer from the claim would make that case untestable. */
function elf({
  bits = 64,
  endian = 'LE',
  segments = [],
  phentsize = bits === 64 ? 56 : 32,
  phnum = segments.length,
  phoff = 64,
}: ElfOptions): Buffer {
  // Written entries need room for the natural header even when e_phentsize understates it.
  const stride = Math.max(phentsize, bits === 64 ? 56 : 32);
  const buffer = Buffer.alloc(Math.max(64, phoff + segments.length * stride));
  buffer[0] = 0x7f;
  buffer.write('ELF', 1, 'latin1');
  buffer[4] = bits === 64 ? 2 : 1;
  buffer[5] = endian === 'LE' ? 1 : 2;

  const w16 = (offset: number, value: number) =>
    endian === 'LE' ? buffer.writeUInt16LE(value, offset) : buffer.writeUInt16BE(value, offset);
  const w32 = (offset: number, value: number) =>
    endian === 'LE' ? buffer.writeUInt32LE(value, offset) : buffer.writeUInt32BE(value, offset);
  const w64 = (offset: number, value: number) =>
    endian === 'LE'
      ? buffer.writeBigUInt64LE(BigInt(value), offset)
      : buffer.writeBigUInt64BE(BigInt(value), offset);

  if (bits === 64) {
    w64(0x20, phoff);
    w16(0x36, phentsize);
    w16(0x38, phnum);
  } else {
    w32(0x1c, phoff);
    w16(0x2a, phentsize);
    w16(0x2c, phnum);
  }

  segments.forEach((segment: Segment, index: number) => {
    const entry = phoff + index * phentsize;
    w32(entry, segment.type);
    if (bits === 64) w64(entry + 48, segment.align);
    else w32(entry + 28, segment.align);
  });

  return buffer;
}

describe('readElfLoadAlignments', () => {
  it('reads the alignment of every LOAD segment of a 64-bit little-endian object', () => {
    const buffer = elf({
      segments: [
        { type: PT_LOAD, align: 16384 },
        { type: PT_LOAD, align: 16384 },
      ],
    });
    expect(readElfLoadAlignments(buffer)).toEqual({
      bits: 64,
      endian: 'LE',
      loadAlignments: [16384, 16384],
    });
  });

  it('reads a 32-bit object, where the alignment lives at a different offset in a shorter entry', () => {
    const buffer = elf({ bits: 32, segments: [{ type: PT_LOAD, align: 4096 }] });
    expect(readElfLoadAlignments(buffer)).toEqual({
      bits: 32,
      endian: 'LE',
      loadAlignments: [4096],
    });
  });

  it('reads a big-endian object', () => {
    const buffer = elf({ endian: 'BE', segments: [{ type: PT_LOAD, align: 65536 }] });
    expect(readElfLoadAlignments(buffer)).toEqual({
      bits: 64,
      endian: 'BE',
      loadAlignments: [65536],
    });
  });

  it('ignores segments that are not LOAD', () => {
    const buffer = elf({
      segments: [
        { type: PT_DYNAMIC, align: 8 },
        { type: PT_LOAD, align: 16384 },
        { type: PT_DYNAMIC, align: 8 },
      ],
    });
    // The 8-byte DYNAMIC alignments would fail the check if they were counted, and they are normal.
    expect(readElfLoadAlignments(buffer).loadAlignments).toEqual([16384]);
  });

  it('reports a mixed object honestly rather than reporting only its first segment', () => {
    const buffer = elf({
      segments: [
        { type: PT_LOAD, align: 16384 },
        { type: PT_LOAD, align: 4096 },
      ],
    });
    expect(readElfLoadAlignments(buffer).loadAlignments).toEqual([16384, 4096]);
  });

  it('refuses a file that is not an ELF instead of returning an empty pass', () => {
    expect(() => readElfLoadAlignments(Buffer.alloc(64))).toThrow(/ELF magic/);
  });

  it('refuses a truncated file', () => {
    expect(() => readElfLoadAlignments(Buffer.alloc(8))).toThrow(/too short/);
  });

  it('refuses an unknown ELF class', () => {
    const buffer = elf({ segments: [{ type: PT_LOAD, align: 16384 }] });
    buffer[4] = 9;
    expect(() => readElfLoadAlignments(buffer)).toThrow(/unknown ELF class/);
  });

  it('refuses a program header table that runs past the end of the file', () => {
    const buffer = elf({ segments: [{ type: PT_LOAD, align: 16384 }], phnum: 400 });
    expect(() => readElfLoadAlignments(buffer)).toThrow(/past the end/);
  });

  it('refuses an object with no program header table', () => {
    expect(() => readElfLoadAlignments(elf({ segments: [], phnum: 0 }))).toThrow(
      /no program header table/,
    );
  });

  it('refuses an entry size too small to hold the alignment field it would read', () => {
    const buffer = elf({ segments: [{ type: PT_LOAD, align: 16384 }], phentsize: 32 });
    expect(() => readElfLoadAlignments(buffer)).toThrow(/e_phentsize/);
  });

  it('walks the table by e_phentsize, not by the size it assumes', () => {
    // A larger-than-standard entry size is legal. Reading at a fixed 56-byte stride would land in
    // the middle of the second header and report whatever happened to be there.
    const buffer = elf({
      phentsize: 64,
      segments: [
        { type: PT_LOAD, align: 16384 },
        { type: PT_LOAD, align: 32768 },
      ],
    });
    expect(readElfLoadAlignments(buffer).loadAlignments).toEqual([16384, 32768]);
  });
});

describe('parseObjdumpLoadAlignments', () => {
  // Real `llvm-objdump -p` output, trimmed to the fields the parser looks at.
  const output = [
    'libexample.so:\tfile format elf64-littleaarch64',
    '',
    'Program Header:',
    '    PHDR off    0x0000000000000040 vaddr 0x0000000000000040 align 2**3',
    '    LOAD off    0x0000000000000000 vaddr 0x0000000000000000 align 2**14',
    '         filesz 0x00000000000138ac memsz 0x00000000000138ac flags r--',
    '    LOAD off    0x0000000000014000 vaddr 0x0000000000018000 align 2**14',
    ' DYNAMIC off    0x0000000000030000 vaddr 0x0000000000034000 align 2**3',
  ].join('\n');

  it('converts each LOAD exponent to bytes and ignores every other segment', () => {
    expect(parseObjdumpLoadAlignments(output)).toEqual([16384, 16384]);
  });

  it('reads a 4 KB library as 4096, which is the failure it exists to see', () => {
    expect(parseObjdumpLoadAlignments('    LOAD off 0x0 vaddr 0x0 align 2**12')).toEqual([4096]);
  });

  it('finds nothing in output that mentions LOAD without an alignment', () => {
    expect(parseObjdumpLoadAlignments('Sections:\n  0 .text LOAD 000138ac')).toEqual([]);
  });
});

describe('verdict', () => {
  it('fails a library on its WORST segment, not its first or its best', () => {
    expect(
      verdict([{ name: 'arm64-v8a/lib.so', loadAlignments: [16384, 4096, 16384] }]),
    ).toEqual([{ name: 'arm64-v8a/lib.so', worst: 4096, ok: false }]);
  });

  it('passes a library aligned above the requirement', () => {
    expect(verdict([{ name: 'x/lib.so', loadAlignments: [65536] }])[0]?.ok).toBe(true);
  });

  it('passes at exactly the requirement', () => {
    expect(verdict([{ name: 'x/lib.so', loadAlignments: [REQUIRED_ALIGNMENT] }])[0]?.ok).toBe(true);
  });

  it('fails one byte under it', () => {
    expect(verdict([{ name: 'x/lib.so', loadAlignments: [REQUIRED_ALIGNMENT - 1] }])[0]?.ok).toBe(
      false,
    );
  });

  it('fails a library with no LOAD segments rather than passing it vacuously', () => {
    // `every()` over an empty list is true, which would call a library nobody could read "aligned".
    expect(verdict([{ name: 'x/lib.so', loadAlignments: [] }])).toEqual([
      { name: 'x/lib.so', worst: 0, ok: false },
    ]);
  });

  it('honours a loosened threshold', () => {
    expect(verdict([{ name: 'x/lib.so', loadAlignments: [4096] }], 4096)[0]?.ok).toBe(true);
  });

  it('requires 16384 by default — the number Play checks', () => {
    expect(REQUIRED_ALIGNMENT).toBe(16384);
  });
});
