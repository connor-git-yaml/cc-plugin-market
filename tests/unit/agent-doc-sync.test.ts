import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const rootDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const targetPaths = [
  resolve(rootDir, 'AGENTS.md'),
  resolve(rootDir, 'CLAUDE.md'),
];
const sections = [
  {
    key: 'branch-sync-policy',
    sourcePath: resolve(rootDir, 'docs/shared/agent-branch-sync-policy.md'),
  },
  {
    key: 'mainline-focus',
    sourcePath: resolve(rootDir, 'docs/shared/agent-mainline-focus.md'),
  },
];

function readSyncedSection(filePath: string, key: string): string {
  const beginMarker = `<!-- BEGIN SHARED SECTION: ${key} -->`;
  const endMarker = `<!-- END SHARED SECTION: ${key} -->`;
  const content = readFileSync(filePath, 'utf8');
  const start = content.indexOf(beginMarker);
  const end = content.indexOf(endMarker);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return content.slice(start + beginMarker.length, end).trim();
}

describe('agent doc sync', () => {
  it('keeps AGENTS.md and CLAUDE.md aligned with all shared agent guidance sources', () => {
    for (const section of sections) {
      const expected = readFileSync(section.sourcePath, 'utf8').trim();

      for (const targetPath of targetPaths) {
        expect(readSyncedSection(targetPath, section.key)).toBe(expected);
      }
    }
  });
});
