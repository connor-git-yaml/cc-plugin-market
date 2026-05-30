#!/usr/bin/env node
/**
 * sync-preference-rules — 从 templates/preference-rules.md 单一事实源，按各 agent frontmatter
 * tools 过滤渲染「工具优先使用规则」块，写入 5 个 agent 文件的 BEGIN/END marker 之间。
 *
 * 用法：
 *   node plugins/spec-driver/scripts/sync-preference-rules.mjs --write   # 生成/更新（默认）
 *   node plugins/spec-driver/scripts/sync-preference-rules.mjs --check   # 漂移检测（CI/repo:check）
 *
 * 插入锚点（首次）：`## 角色` 段之后、下一个 `## ` 标题之前；无 `## 角色` 则首个 `## ` 前。
 * 已有 marker：仅替换 marker 之间内容（锚点不移动）。
 *
 * 退出码：0 = 无漂移 / 写入完成；1 = --check 检测到漂移。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  renderInjectionBlock,
  parseFrontmatterTools,
  wrapWithMarkers,
  BEGIN_MARKER,
  END_MARKER,
} from '../lib/preference-rules.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = path.resolve(__dirname, '..');
const TEMPLATE_PATH = path.join(PLUGIN_DIR, 'templates/preference-rules.md');
const AGENTS = ['plan', 'implement', 'verify', 'spec-review', 'quality-review'];

/** 计算 agent 文件应有的内容（插入或替换 marker 块）。 */
export function computeExpectedAgentContent(agentText, templateText) {
  const tools = parseFrontmatterTools(agentText);
  const rendered = renderInjectionBlock(templateText, tools);
  const wrapped = wrapWithMarkers(rendered);

  const beginIdx = agentText.indexOf(BEGIN_MARKER);
  // 在 BEGIN 之后查找 END，避免匹配到文档引用里的字面 marker
  const endIdx = beginIdx >= 0 ? agentText.indexOf(END_MARKER, beginIdx + BEGIN_MARKER.length) : -1;
  if (beginIdx >= 0 && endIdx > beginIdx) {
    // 替换现有 marker 区（含 marker 本身）
    const before = agentText.slice(0, beginIdx);
    const after = agentText.slice(endIdx + END_MARKER.length);
    return before + wrapped + after;
  }

  // 首次插入：定位锚点
  const lines = agentText.split('\n');
  const roleIdx = lines.findIndex((l) => /^##\s+角色/.test(l));
  let insertAt;
  if (roleIdx >= 0) {
    insertAt = lines.findIndex((l, i) => i > roleIdx && /^##\s/.test(l));
    if (insertAt < 0) insertAt = lines.length; // 角色 是最后一段
  } else {
    insertAt = lines.findIndex((l) => /^##\s/.test(l));
    if (insertAt < 0) insertAt = lines.length;
  }
  const head = lines.slice(0, insertAt).join('\n').replace(/\n+$/, '');
  const tail = lines.slice(insertAt).join('\n').replace(/^\n+/, '');
  return `${head}\n\n${wrapped}\n\n${tail}`;
}

function agentPath(name, pluginDir = PLUGIN_DIR) {
  return path.join(pluginDir, 'agents', `${name}.md`);
}

/**
 * 供 repo:check（repo-maintenance-core）复用的漂移校验：
 * 返回 { checks, warnings, errors }，与 aggregateValidation 契约一致。
 */
export function validatePreferenceRules({ projectRoot } = {}) {
  const root = projectRoot ? path.resolve(projectRoot) : path.resolve(PLUGIN_DIR, '../..');
  const pluginDir = path.join(root, 'plugins/spec-driver');
  const templatePath = path.join(pluginDir, 'templates/preference-rules.md');
  const errors = [];
  const drifted = [];

  if (!fs.existsSync(templatePath)) {
    return { checks: [{ id: 'agent-block-sync', title: 'preference-rules 单一源同步', status: 'fail', evidence: { reason: 'template 缺失' } }], warnings: [], errors: ['template 缺失: templates/preference-rules.md'] };
  }
  const templateText = fs.readFileSync(templatePath, 'utf-8');
  for (const agent of AGENTS) {
    const p = agentPath(agent, pluginDir);
    if (!fs.existsSync(p)) { drifted.push(`${agent}(缺失)`); errors.push(`agent 文件缺失: ${agent}.md`); continue; }
    const actual = fs.readFileSync(p, 'utf-8');
    if (actual !== computeExpectedAgentContent(actual, templateText)) {
      drifted.push(agent);
      errors.push(`${agent}.md preference-rules 块与 template 漂移；运行 sync-preference-rules.mjs --write`);
    }
  }
  const status = drifted.length > 0 ? 'fail' : 'pass';
  return {
    checks: [{ id: 'agent-block-sync', title: '5 agent preference-rules 块与单一源一致', status, evidence: { drifted } }],
    warnings: [],
    errors,
  };
}

/** 计算 plugin/template/agent 路径（projectRoot 可选，默认 module-relative）。 */
function resolvePaths(projectRoot) {
  const root = projectRoot ? path.resolve(projectRoot) : path.resolve(PLUGIN_DIR, '../..');
  const pluginDir = path.join(root, 'plugins/spec-driver');
  return { pluginDir, templatePath: path.join(pluginDir, 'templates/preference-rules.md') };
}

/**
 * 程序化写入（repo:sync 复用）：按 template 重新生成 5 agent 的 preference-rules 块。
 * 返回 { written: string[] }。
 */
export function syncPreferenceRules({ projectRoot } = {}) {
  const { pluginDir, templatePath } = resolvePaths(projectRoot);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`[sync-preference-rules] template 不存在: ${templatePath}`);
  }
  const templateText = fs.readFileSync(templatePath, 'utf-8');
  const written = [];
  for (const agent of AGENTS) {
    const p = agentPath(agent, pluginDir);
    if (!fs.existsSync(p)) throw new Error(`[sync-preference-rules] agent 文件不存在: ${p}`);
    const actual = fs.readFileSync(p, 'utf-8');
    const expected = computeExpectedAgentContent(actual, templateText);
    if (actual !== expected) { fs.writeFileSync(p, expected, 'utf-8'); written.push(agent); }
  }
  return { written };
}

function run(mode) {
  if (mode === 'check') {
    const result = validatePreferenceRules({});
    if (result.errors.length > 0) {
      result.errors.forEach((e) => console.error(`[sync-preference-rules] ${e}`));
      console.error('  运行 `node plugins/spec-driver/scripts/sync-preference-rules.mjs --write` 重新同步');
      process.exit(1);
    }
    console.log('[sync-preference-rules] 无漂移 ✅');
    return;
  }
  const { written } = syncPreferenceRules({});
  written.forEach((a) => console.log(`[sync-preference-rules] 已更新 ${a}.md`));
  console.log(`[sync-preference-rules] 完成（更新 ${written.length} 个 agent 文件）`);
}

const isCliEntry = process.argv[1] != null
  && path.resolve(process.argv[1]).endsWith('sync-preference-rules.mjs');
if (isCliEntry) {
  const mode = process.argv.includes('--check') ? 'check' : 'write';
  run(mode);
}
