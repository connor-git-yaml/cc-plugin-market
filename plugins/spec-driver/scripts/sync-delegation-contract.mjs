#!/usr/bin/env node
/**
 * sync-delegation-contract — 从 templates/delegation-contract.md 单一事实源，把委派硬约束块
 * 按各 SKILL 显式锚点注入 5 个主编排器 SKILL.md 的 BEGIN/END marker 之间。
 *
 * 用法：
 *   node plugins/spec-driver/scripts/sync-delegation-contract.mjs --write   # 生成/更新（默认）
 *   node plugins/spec-driver/scripts/sync-delegation-contract.mjs --check   # 漂移检测（CI/repo:check）
 *
 * ⚠️ --write 只写 plugins 层 5 个源 SKILL；.codex wrapper 由 repo:sync 的
 * spec-driver-codex-wrappers 步骤再生（顺序已编排在本注入之后）。模板变更后单跑
 * --write 再跑 --check 会因 .codex stale 而 fail——这是预期信号，跑 `npm run repo:sync` 消除。
 *
 * 注入锚点（已实测，per-SKILL 精确匹配；锚点未找到 → fail-loud）：
 *   fix/story/implement → '## 工作流定义'
 *   feature             → '## 工作流执行（动态模式）'
 *   resume              → '## 恢复后执行流程'
 * 已有 marker：仅替换 marker 之间内容（锚点不移动，幂等）。
 *
 * 退出码：0 = 无漂移 / 写入完成；1 = --check 检测到漂移。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractCanonicalBlock,
  wrapWithMarkers,
  computeExpectedSkillContent,
  BEGIN_MARKER,
  END_MARKER,
} from '../lib/delegation-contract.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = path.resolve(__dirname, '..');

/** 显式 per-SKILL 注入锚点 map（已实测）。 */
const SKILL_ANCHORS = {
  fix: '## 工作流定义',
  story: '## 工作流定义',
  feature: '## 工作流执行（动态模式）',
  implement: '## 工作流定义',
  resume: '## 恢复后执行流程',
};

function resolvePaths(projectRoot) {
  const root = projectRoot ? path.resolve(projectRoot) : path.resolve(PLUGIN_DIR, '../..');
  const pluginDir = path.join(root, 'plugins/spec-driver');
  return {
    root,
    pluginDir,
    templatePath: path.join(pluginDir, 'templates/delegation-contract.md'),
  };
}

function skillPath(pluginDir, mode) {
  return path.join(pluginDir, 'skills', `spec-driver-${mode}`, 'SKILL.md');
}

function codexWrapperPath(root, mode) {
  return path.join(root, '.codex/skills', `spec-driver-${mode}`, 'SKILL.md');
}

/**
 * 供 repo:check（repo-maintenance-core）复用的漂移校验：
 * 返回 { status, checks, warnings, errors }，与 aggregateValidation 契约一致。
 */
export function validateDelegationContract({ projectRoot } = {}) {
  const { root, pluginDir, templatePath } = resolvePaths(projectRoot);
  const errors = [];
  const checks = [];

  if (!fs.existsSync(templatePath)) {
    return {
      status: 'fail',
      checks: [{ id: 'skill-block-sync', title: 'delegation-contract 单一源同步', status: 'fail', evidence: { reason: 'template 缺失' } }],
      warnings: [],
      errors: ['template 缺失: templates/delegation-contract.md'],
    };
  }
  const templateText = fs.readFileSync(templatePath, 'utf-8');
  const drifted = [];
  for (const [mode, anchor] of Object.entries(SKILL_ANCHORS)) {
    const p = skillPath(pluginDir, mode);
    if (!fs.existsSync(p)) {
      drifted.push(`${mode}(缺失)`);
      errors.push(`SKILL 文件缺失: spec-driver-${mode}/SKILL.md`);
      continue;
    }
    const actual = fs.readFileSync(p, 'utf-8');
    let expected;
    try {
      expected = computeExpectedSkillContent(actual, templateText, anchor);
    } catch (err) {
      drifted.push(`${mode}(锚点错)`);
      errors.push(`spec-driver-${mode}/SKILL.md: ${err.message}`);
      continue;
    }
    if (actual !== expected) {
      drifted.push(mode);
      errors.push(`spec-driver-${mode}/SKILL.md delegation-contract 块与 template 漂移；运行 sync-delegation-contract.mjs --write`);
    }
  }
  const status = drifted.length > 0 ? 'fail' : 'pass';
  checks.push({
    id: 'skill-block-sync',
    title: '5 SKILL delegation-contract 块与单一源一致',
    status,
    evidence: { drifted },
  });

  // .codex 双层守护（codex Warning-4）：resume 原始事故正是 .codex 层 stale。
  // 断言每个 .codex wrapper 内嵌的委派块与单一源一致——若 source 改了但未跑 repo:sync
  // 再生 wrapper，这里 fail-loud（不依赖 codex-skills.sh 的 marker-only 校验）。
  const expectedBlock = wrapWithMarkers(extractCanonicalBlock(templateText));
  const codexDrifted = [];
  for (const mode of Object.keys(SKILL_ANCHORS)) {
    const cp = codexWrapperPath(root, mode);
    if (!fs.existsSync(cp)) {
      codexDrifted.push(`${mode}(缺失)`);
      errors.push(`.codex wrapper 缺失: .codex/skills/spec-driver-${mode}/SKILL.md`);
      continue;
    }
    if (!fs.readFileSync(cp, 'utf-8').includes(expectedBlock)) {
      codexDrifted.push(mode);
      errors.push(`.codex/skills/spec-driver-${mode}/SKILL.md 未含最新委派块（stale wrapper）；运行 npm run repo:sync 再生`);
    }
  }
  const codexStatus = codexDrifted.length > 0 ? 'fail' : 'pass';
  checks.push({
    id: 'codex-wrapper-block-sync',
    title: '5 .codex wrapper 委派块与单一源一致',
    status: codexStatus,
    evidence: { codexDrifted },
  });

  return { status: status === 'fail' || codexStatus === 'fail' ? 'fail' : 'pass', checks, warnings: [], errors };
}

/**
 * 程序化写入（repo:sync 复用）：按 template 重新注入 5 SKILL 的 delegation-contract 块。
 * 返回 { written: string[] }。
 */
export function syncDelegationContract({ projectRoot } = {}) {
  const { pluginDir, templatePath } = resolvePaths(projectRoot);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`[sync-delegation-contract] template 不存在: ${templatePath}`);
  }
  const templateText = fs.readFileSync(templatePath, 'utf-8');
  const written = [];
  for (const [mode, anchor] of Object.entries(SKILL_ANCHORS)) {
    const p = skillPath(pluginDir, mode);
    if (!fs.existsSync(p)) throw new Error(`[sync-delegation-contract] SKILL 文件不存在: ${p}`);
    const actual = fs.readFileSync(p, 'utf-8');
    const expected = computeExpectedSkillContent(actual, templateText, anchor);
    if (actual !== expected) { fs.writeFileSync(p, expected, 'utf-8'); written.push(mode); }
  }
  return { written };
}

function run(mode) {
  if (mode === 'check') {
    const result = validateDelegationContract({});
    if (result.errors.length > 0) {
      result.errors.forEach((e) => console.error(`[sync-delegation-contract] ${e}`));
      console.error('  运行 `node plugins/spec-driver/scripts/sync-delegation-contract.mjs --write` 重新同步');
      process.exit(1);
    }
    console.log('[sync-delegation-contract] 无漂移 ✅');
    return;
  }
  const { written } = syncDelegationContract({});
  written.forEach((m) => console.log(`[sync-delegation-contract] 已更新 spec-driver-${m}/SKILL.md`));
  console.log(`[sync-delegation-contract] 完成（更新 ${written.length} 个 SKILL 文件）`);
  if (written.length > 0) {
    console.log('[sync-delegation-contract] ⚠️ .codex wrapper 未在此步再生；跑 `npm run repo:sync` 同步双层（--check 含 .codex 校验）');
  }
}

// 显式 re-export 供测试直接消费（避免测试重复 import lib）
export { extractCanonicalBlock, wrapWithMarkers, computeExpectedSkillContent, BEGIN_MARKER, END_MARKER };

const isCliEntry = process.argv[1] != null
  && path.resolve(process.argv[1]).endsWith('sync-delegation-contract.mjs');
if (isCliEntry) {
  const cliMode = process.argv.includes('--check') ? 'check' : 'write';
  run(cliMode);
}
