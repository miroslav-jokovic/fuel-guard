#!/usr/bin/env node
// Fails the build on hardcoded hex colors, raw Tailwind palette classes, or inline color styles
// outside src/theme (plan §11.5 / D23). The RN equivalent of apps/web/scripts/check-design-tokens.mjs.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SCAN = ['app', 'src'];
const ALLOW = join('src', 'theme'); // the only place raw color values may live
const HEX = /#[0-9a-fA-F]{3,8}\b/;
const PALETTE =
  /\b(?:bg|text|border|ring|from|via|to|fill|stroke|shadow|divide|placeholder|caret|accent|decoration)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;
const INLINE = /style=\{\{[^}]*(?:[^A-Za-z]color|backgroundColor|borderColor)[^}]*\}\}/;

const fails = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!['.ts', '.tsx'].includes(extname(p)) || p.endsWith('.d.ts')) continue;
    if (p.includes(ALLOW)) continue;
    readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
      if (line.includes('token-check-disable-line')) return;
      if (HEX.test(line)) fails.push(`${p}:${i + 1}  hardcoded hex color`);
      if (PALETTE.test(line)) fails.push(`${p}:${i + 1}  raw palette class — use a semantic token`);
      if (INLINE.test(line)) fails.push(`${p}:${i + 1}  inline color style`);
    });
  }
}
for (const d of SCAN) { try { walk(join(ROOT, d)); } catch { /* dir may not exist yet */ } }

if (fails.length) {
  console.error('✗ design-token check failed:\n' + fails.map((f) => '  ' + f).join('\n'));
  process.exit(1);
}
console.log('✓ design-token check passed');
