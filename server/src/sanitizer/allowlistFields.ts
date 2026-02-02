import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeFieldName } from './normalizeFieldName';

let cachedAllowList: Set<string> | null = null;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const allowListPath = path.resolve(__dirname, '../../config/allowlist-fields.json');

export const loadAllowListFields = (): string[] => {
  const raw = readFileSync(allowListPath, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('allowlist-fields.json deve ser um array de strings.');
  }
  return parsed.map((entry) => String(entry));
};

export const getAllowListSet = (): Set<string> => {
  if (cachedAllowList) return cachedAllowList;
  const entries = loadAllowListFields();
  cachedAllowList = new Set(entries.map((entry) => normalizeFieldName(entry)).filter(Boolean));
  return cachedAllowList;
};
