#!/usr/bin/env node
/* eslint-disable no-redeclare */
// Guardrails for the AI-facing driver design contract. This is intentionally narrow: it rejects
// generic brand/layout escapes without trying to replace visual review or product judgment.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SCAN = ['app', 'src'];
const forbidden = [
  { pattern: /\b(?:Inter|Roboto|Arial|Helvetica|Open Sans|Poppins)\b/i, message: 'use Hanken Grotesk through the font-sans-* classes' },
  { pattern: /\bAlert\.alert\s*\(/, message: 'use ConfirmSheet or an intentional Banner instead of native Alert' },
  { pattern: /from\s+['"]@\/theme\/ramps['"]/, message: 'screens and components must use semantic color roles, not primitive ramps' },
  { pattern: /(?:rounded|border|shadow|space|gap|p[trblxy]?|m[trblxy]?)-\[/, message: 'do not introduce arbitrary layout values; use the 8pt design scale or update DESIGN.md first' },
];

const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (['.ts', '.tsx'].includes(extname(path)) && !path.endsWith('.d.ts')) files.push(path);
  }
}
for (const directory of SCAN) walk(join(ROOT, directory));

const failures = [];
for (const path of files) {
  const lines = readFileSync(path, 'utf8').split('\n');
  lines.forEach((line, index) => {
    for (const rule of forbidden) {
      if (rule.pattern.test(line)) failures.push(`${path}:${index + 1} ${rule.message}`);
    }
  });
}

if (failures.length) {
  console.error('✗ driver design-contract check failed:\n' + failures.map((failure) => `  ${failure}`).join('\n'));
  process.exit(1);
}

console.log('✓ driver design-contract check passed');
