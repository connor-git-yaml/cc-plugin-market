import fs from 'node:fs';
import path from 'node:path';
export function slugToTitle(value) {
  return String(value)
    .split('-')
    .map((segment) => (segment ? segment[0].toUpperCase() + segment.slice(1) : segment))
    .join(' ');
}

export function toPosix(value) {
  return value.split(path.sep).join('/');
}

export function firstExistingPath(...candidates) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates.find(Boolean) ?? null;
}

export function readMarkdownHeading(filePath) {
  if (!fs.existsSync(filePath)) {
    return '';
  }

  const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
  const heading = lines.find((line) => line.trim().startsWith('# '));
  return heading ? heading.replace(/^#\s+/, '').trim() : '';
}

export function normalizeForCompare(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '');
}

export function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
