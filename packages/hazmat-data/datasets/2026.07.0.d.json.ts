// The type TypeScript sees for the JSON beside this file: `unknown`, because the loader validates it
// with zod and never reads the inferred literal type. Why this file exists: src/index.ts, above RAW.
declare const raw: unknown;
export default raw;
