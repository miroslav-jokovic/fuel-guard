#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const roles = JSON.parse(readFileSync(join(ROOT, 'src/theme/theme.roles.json'), 'utf8'));
const css = readFileSync(join(ROOT, 'global.css'), 'utf8');
const failures = [];
const themeNames = ['light', 'dark', 'highContrastLight', 'highContrastDark'];
const referenceRoles = Object.keys(roles.light ?? {}).sort();

for (const themeName of themeNames) {
  const theme = roles[themeName];
  if (!theme) {
    failures.push(`theme.roles.json is missing ${themeName}`);
    continue;
  }

  const themeRoles = Object.keys(theme).sort();
  if (themeRoles.join('|') !== referenceRoles.join('|')) {
    failures.push(`${themeName} does not expose the same roles as light`);
  }

  const start = `/* theme:${themeName}:start */`;
  const end = `/* theme:${themeName}:end */`;
  const startIndex = css.indexOf(start);
  const endIndex = css.indexOf(end);
  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
    failures.push(`global.css is missing the generated ${themeName} block markers`);
    continue;
  }
  const block = css.slice(startIndex, endIndex);

  for (const [role, value] of Object.entries(theme)) {
    if (!/^\d{1,3} \d{1,3} \d{1,3}$/.test(value)) {
      failures.push(`${themeName}.${role} must be an RGB channel triplet`);
      continue;
    }
    const channels = value.split(' ').map(Number);
    if (channels.some((channel) => channel < 0 || channel > 255)) {
      failures.push(`${themeName}.${role} contains a channel outside 0–255`);
    }
    if (!block.includes(`--color-${role}: ${value};`)) {
      failures.push(`global.css drift: ${themeName}.${role} must be ${value}`);
    }
  }
}

if (failures.length) {
  console.error('✗ driver theme parity failed:\n' + failures.map((failure) => `  ${failure}`).join('\n'));
  process.exit(1);
}

console.log(`✓ driver theme parity passed (${themeNames.length} themes × ${referenceRoles.length} roles)`);
