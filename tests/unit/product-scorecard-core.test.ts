import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

async function importScriptModule<T>(relativePath: string): Promise<T> {
  return import(pathToFileURL(resolve(relativePath)).href) as Promise<T>;
}

describe('product-scorecard core module', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'product-scorecard-core-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('mergeRule 只合并允许的 metadata 字段并保留 evaluator', async () => {
    const { mergeRule } = await importScriptModule<{
      mergeRule: (base: Record<string, unknown>, override: Record<string, unknown>) => Record<string, unknown>;
    }>('plugins/spec-driver/scripts/lib/product-scorecard-core.mjs');

    const merged = mergeRule(
      {
        id: 'docs-coverage',
        title: 'Docs Coverage',
        evaluator: 'docs-coverage',
        weight: 10,
        enabled: true,
        appliesTo: { kinds: ['plugin'] },
        thresholds: { passCoverageRatio: 1 },
      },
      {
        id: 'docs-coverage',
        title: 'Required Docs Coverage',
        weight: 15,
        appliesTo: { productIds: ['spec-driver'] },
        thresholds: { warnCoverageRatio: 0.8 },
      },
    );

    expect(merged).toEqual({
      id: 'docs-coverage',
      title: 'Required Docs Coverage',
      evaluator: 'docs-coverage',
      weight: 15,
      enabled: true,
      appliesTo: {
        kinds: ['plugin'],
        productIds: ['spec-driver'],
      },
      thresholds: {
        passCoverageRatio: 1,
        warnCoverageRatio: 0.8,
      },
    });
  });

  it('collectFeatureInputs 正确区分 implemented feature、draft feature 与 blueprint', async () => {
    const { collectFeatureInputs } = await importScriptModule<{
      collectFeatureInputs: (projectRoot: string, specs: Array<{ id: string }>) => Array<{
        id: string;
        artifactType: string;
        governed: boolean;
      }>;
    }>('plugins/spec-driver/scripts/lib/product-scorecard-core.mjs');

    mkdirSync(join(projectRoot, 'specs', '001-core', 'verification'), { recursive: true });
    mkdirSync(join(projectRoot, 'specs', '002-draft'), { recursive: true });
    mkdirSync(join(projectRoot, 'specs', '003-blueprint'), { recursive: true });

    writeFileSync(join(projectRoot, 'specs', '001-core', 'spec.md'), '# 001 Core\n\n**Status**: Implemented\n', 'utf-8');
    writeFileSync(join(projectRoot, 'specs', '001-core', 'verification', 'verification-report.md'), '# Verification\n', 'utf-8');
    writeFileSync(join(projectRoot, 'specs', '002-draft', 'spec.md'), '# 002 Draft\n\n**Status**: Draft\n', 'utf-8');
    writeFileSync(join(projectRoot, 'specs', '003-blueprint', 'blueprint.md'), '# 003 Blueprint\n\n**状态**: Implemented\n', 'utf-8');

    const inputs = collectFeatureInputs(projectRoot, [
      { id: '001-core' },
      { id: '002-draft' },
      { id: '003-blueprint' },
    ]);

    expect(inputs).toEqual([
      expect.objectContaining({
        id: '001-core',
        artifactType: 'feature',
        governed: true,
      }),
      expect.objectContaining({
        id: '002-draft',
        artifactType: 'feature',
        governed: false,
      }),
      expect.objectContaining({
        id: '003-blueprint',
        artifactType: 'blueprint',
        governed: false,
      }),
    ]);
  });

  it('detectBranchPolicy 读取 branch sync 共享区块与 policy 文件', async () => {
    const { detectBranchPolicy } = await importScriptModule<{
      detectBranchPolicy: (projectRoot: string) => {
        hasPolicyFile: boolean;
        agentsDocumented: boolean;
        claudeDocumented: boolean;
      };
    }>('plugins/spec-driver/scripts/lib/product-scorecard-core.mjs');

    mkdirSync(join(projectRoot, 'docs', 'shared'), { recursive: true });
    writeFileSync(join(projectRoot, 'docs', 'shared', 'agent-branch-sync-policy.md'), '- `feature/*` 提交前使用 `git rebase master`\n', 'utf-8');
    writeFileSync(join(projectRoot, 'AGENTS.md'), '<!-- BEGIN SHARED SECTION: branch-sync-policy -->\n', 'utf-8');
    writeFileSync(join(projectRoot, 'CLAUDE.md'), '<!-- BEGIN SHARED SECTION: branch-sync-policy -->\n', 'utf-8');

    expect(detectBranchPolicy(projectRoot)).toEqual({
      hasPolicyFile: true,
      agentsDocumented: true,
      claudeDocumented: true,
    });
  });
});
