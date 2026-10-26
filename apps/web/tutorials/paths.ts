import path from "node:path";

/** Where every generated file goes, one folder per tutorial (gitignored). Read by the spec and by `make.ts`. */
export const OUT_ROOT = path.resolve(import.meta.dirname, "out");
