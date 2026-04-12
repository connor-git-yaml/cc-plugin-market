import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const rootDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
export const sectionConfigs = [
  {
    key: 'branch-sync-policy',
    sourcePath: resolve(rootDir, 'docs/shared/agent-branch-sync-policy.md'),
    targets: ['AGENTS.md', 'CLAUDE.md'],
  },
  {
    key: 'mainline-focus',
    sourcePath: resolve(rootDir, 'docs/shared/agent-mainline-focus.md'),
    targets: ['AGENTS.md', 'CLAUDE.md'],
  },
  {
    key: 'context-layering',
    sourcePath: resolve(rootDir, 'docs/shared/agent-context-layering.md'),
    targets: ['AGENTS.md', 'CLAUDE.md'],
  },
  {
    key: 'release-contract',
    sourcePath: resolve(rootDir, 'docs/shared/agent-release-contract.md'),
    targets: ['AGENTS.md', 'CLAUDE.md'],
  },
  {
    key: 'repo-maintenance',
    sourcePath: resolve(rootDir, 'docs/shared/agent-repo-maintenance.md'),
    targets: ['AGENTS.md', 'CLAUDE.md'],
  },
  {
    key: 'behavior-rules',
    sourcePath: resolve(rootDir, 'docs/shared/agent-behavior-rules.md'),
    targets: ['AGENTS.md', 'CLAUDE.md'],
  },
  {
    key: 'code-quality',
    sourcePath: resolve(rootDir, 'docs/shared/agent-code-quality.md'),
    targets: ['AGENTS.md', 'CLAUDE.md'],
  },
];

export function syncSection(targetContent, key, sourceContent) {
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

export function syncSharedAgentDocs(projectRoot = rootDir) {
  const resolvedRoot = resolve(projectRoot);
  const touchedPaths = [];

  for (const section of sectionConfigs) {
    const sourceContent = readFileSync(section.sourcePath, 'utf8').trim();

    for (const targetPath of section.targets.map((target) => resolve(resolvedRoot, target))) {
      const targetContent = readFileSync(targetPath, 'utf8');
      const nextContent = syncSection(targetContent, section.key, sourceContent);

      if (nextContent !== targetContent) {
        writeFileSync(targetPath, nextContent, 'utf8');
        touchedPaths.push(targetPath);
      }
    }
  }

  return {
    projectRoot: resolvedRoot,
    touchedPaths: touchedPaths.map((targetPath) => targetPath.slice(resolvedRoot.length + 1)),
  };
}

export function validateSharedAgentDocs(projectRoot = rootDir) {
  const resolvedRoot = resolve(projectRoot);
  const errors = [];
  const checks = [];

  for (const section of sectionConfigs) {
    const sourceContent = readFileSync(section.sourcePath, 'utf8').trim();
    const targetResults = [];

    for (const targetPath of section.targets.map((target) => resolve(resolvedRoot, target))) {
      const targetContent = readFileSync(targetPath, 'utf8');
      const syncedContent = syncSection(targetContent, section.key, sourceContent);
      const inSync = syncedContent === targetContent;

      targetResults.push({
        path: targetPath.slice(resolvedRoot.length + 1),
        status: inSync ? 'pass' : 'fail',
      });

      if (!inSync) {
        errors.push(`${section.key} 在 ${targetPath.slice(resolvedRoot.length + 1)} 中存在漂移，请先运行 npm run docs:sync:agents`);
      }
    }

    checks.push({
      id: `shared-section:${section.key}`,
      title: `Shared agent section: ${section.key}`,
      status: targetResults.every((item) => item.status === 'pass') ? 'pass' : 'fail',
      evidence: {
        sourcePath: section.sourcePath.slice(rootDir.length + 1),
        targets: targetResults,
      },
    });
  }

  return {
    status: errors.length > 0 ? 'fail' : 'pass',
    checks,
    errors,
  };
}

function isDirectExecution() {
  if (!process.argv[1]) {
    return false;
  }
  return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
}

if (isDirectExecution()) {
  const result = syncSharedAgentDocs(rootDir);
  console.log(`Synced shared guidance sections into AGENTS.md and CLAUDE.md (${result.touchedPaths.length} updated)`);
}
