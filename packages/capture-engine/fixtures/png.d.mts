/**
 * Types for the fixture corpus's PNG codec. The implementation is `.mjs` because it is tooling that
 * imports `node:zlib` and must stay outside `src/`, which is contractually Node-free (see
 * `png.mjs`'s header for why).
 *
 * `Uint8Array` rather than `Buffer` deliberately: a `Buffer` IS a `Uint8Array`, so every caller works
 * unchanged, and declaring the narrower type keeps this file free of Node's globals. That matters
 * because THIS PACKAGE HAS NO `@types/node` ON PURPOSE. `src/contracts.ts` states the package
 * "imports NOTHING platform-specific (no React Native, no Node, no crypto)", and nothing mechanical
 * enforces that — no lint gate covers it (checked 2026-09-06; `check-feature-boundaries.mjs` guards
 * the hazmat packages, not this one). The absence of Node types in `tsconfig.json` is the only guard
 * the rule has.
 *
 * So if your editor reports "Cannot find name 'Buffer'" or "Cannot find name 'node:fs'" in
 * `tests/fixtures.test.ts`: that is the guard working, not a bug. Those files are excluded from
 * `tsconfig.json` (`include: ["src/**\/*.ts"]`, `exclude: ["tests"]`) and are typechecked by no gate.
 * Installing `@types/node` to silence it would hand `src/` the Node globals it is promised not to
 * have, and the promise would then be kept only by everybody remembering it.
 */
export declare function encodePng(rgb: Uint8Array, width: number, height: number): Uint8Array;
export declare function decodePng(buf: Uint8Array): { width: number; height: number; rgb: Uint8Array };
