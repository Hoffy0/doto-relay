import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const THEMES_DIR = join(__dirname, '..', 'themes');

export function loadTheme(name = 'default') {
  const path = join(THEMES_DIR, `${name}.json`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function pickAgentName(theme, usedLabels = []) {
  const available = theme.agents.filter(n => !usedLabels.includes(n));
  if (available.length > 0) return available[0];
  return `agent-${usedLabels.length + 1}`;
}

export function formatMessage(theme, key, vars = {}) {
  const template = theme.messages[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}
