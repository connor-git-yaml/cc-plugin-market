import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const rootDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const sectionConfigs = [
  {
    key: 'branch-sync-policy',
    sourcePath: resolve(rootDir, 'docs/shared/agent-branch-sync-policy.md'),
    targets: [
      resolve(rootDir, 'AGENTS.md'),
      resolve(rootDir, 'CLAUDE.md'),
    ],
  },
];

function syncSection(targetContent, key, sourceContent) {
  const beginMarker = `<!-- BEGIN SHARED SECTION: ${key} -->`;
  const endMarker = `<!-- END SHARED SECTION: ${key} -->`;
  const start = targetContent.indexOf(beginMarker);
  const end = targetContent.indexOf(endMarker);

  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Missing sync markers for section "${key}"`);
  }

  const before = targetContent.slice(0, start + beginMarker.length);
  const after = targetContent.slice(end);
  return `${before}\n${sourceContent.trim()}\n${after}`;
}

for (const section of sectionConfigs) {
  const sourceContent = readFileSync(section.sourcePath, 'utf8').trim();

  for (const targetPath of section.targets) {
    const targetContent = readFileSync(targetPath, 'utf8');
    const nextContent = syncSection(targetContent, section.key, sourceContent);

    if (nextContent !== targetContent) {
      writeFileSync(targetPath, nextContent, 'utf8');
    }
  }
}

console.log('Synced shared agent guidance into AGENTS.md and CLAUDE.md');
