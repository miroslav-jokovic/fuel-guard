/**
 * @hazmat/golden — the SME-authored acceptance-test suite for the HazmatGuard engine (plan H2).
 *
 * This is the one package that legitimately wires @hazmat/engine + @hazmat/data together: it runs
 * declarative, independently-authored scenarios through the real engine against the real shipped
 * dataset. It is deliberately NOT inside the engine or data packages (those must stay dependency-free
 * and extractable — CI enforces they never import each other).
 */
export * from "./schema.js";
export * from "./runner.js";
export * from "./load.js";
export * from "./report.js";
