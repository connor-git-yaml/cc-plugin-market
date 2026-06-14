#!/usr/bin/env node
/**
 * F186 T2 — wrapper body 提取（单一 Node 实现，shell 生成端与 JS 校验端共用）。
 *
 * 动机（FINAL 设计审查 WARNING-1）：原 codex-skills.sh 用 awk|sed 管道生成 wrapper body，
 * 若 JS 校验端另写一套提取逻辑，两者极易逐字节漂移 → wrapper sha256 假阳性 fail。
 * 抽为单一 helper 后，shell 的 write_skill_body 与 validate-wrapper-sources.mjs 都调用本模块，
 * 杜绝双实现分叉。
 *
 * 提取逻辑 = codex-skills.sh:150-168 的 awk 等价（剥除首个 frontmatter 块）
 *          + codex-skills.sh:79-90 rewrite_codex_runtime_text 的 9 条 sed 替换纯 JS 等价。
 *
 * 一致性约束：本文件的 frontmatter 剥除 + 9 条替换必须与 codex-skills.sh 逐字节等价；
 * 任一端改动须同步另一端，并由 wrapper-sha256.test.ts 的 helper 单测 + T019 字节一致性验证守护。
 */

import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

/**
 * 剥除 SKILL.md 首个 frontmatter 块（awk write_skill_body 等价）。
 *
 * awk 语义：NR==1 且 $0=="---" 进入 frontmatter；其后遇到下一个 "---" 退出 frontmatter
 * 且该 "---" 行本身也被跳过（next）；frontmatter 外的行原样 print。
 *
 * 与 awk 逐字节对齐的两个关键点（WARNING-1）：
 *  1. CRLF 规范化：awk 以 RS=\n 切记录，CRLF 文件的 "---\r" 不会等于 "---"，故先把
 *     \r\n → \n（否则 frontmatter 匹配失败、frontmatter 不被剥除）。
 *  2. 尾换行（ORS）：awk 对每条 print 的记录补 ORS=\n，故 N 行输出 = 各行 join('\n') + 末尾 '\n'。
 *     同时 awk 以 RS 切记录时，文件末尾的 \n 不产生额外空记录；而 JS split('\n') 会在尾随 \n
 *     处留一个空串元素，须丢弃以避免多出一行。
 */
function stripFrontmatter(content) {
  // CRLF → LF（对齐 awk 的 RS=\n 行切分）
  const normalized = content.replace(/\r\n/g, '\n');
  // 丢弃尾随 \n 产生的空记录（awk 不会为文件末尾 \n 生成额外空行）
  const body = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
  const lines = body.split('\n');
  const out = [];
  let inFrontmatter = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (i === 0 && line === '---') {
      // 进入 frontmatter，跳过首个 ---
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter) {
      if (line === '---') {
        inFrontmatter = false;
      }
      // frontmatter 内（含闭合 ---）全部跳过
      continue;
    }
    out.push(line);
  }
  // 空输出（全部为 frontmatter）时 awk 不 print 任何记录 → 空串；
  // 非空时还原 awk ORS：每条记录补 \n，等价 join('\n') + '\n'。
  if (out.length === 0) {
    return '';
  }
  return `${out.join('\n')}\n`;
}

/**
 * rewrite_codex_runtime_text 的 9 条 sed 替换纯 JS 等价（codex-skills.sh:80-89）。
 * 全部为全局替换（sed 的 g 标志）。逐条照搬，顺序与 shell 一致。
 */
function rewriteCodexRuntimeText(text) {
  const replacements = [
    ['/spec-driver:spec-driver-feature', '$spec-driver-feature'],
    ['/spec-driver:spec-driver-implement', '$spec-driver-implement'],
    ['/spec-driver:spec-driver-story', '$spec-driver-story'],
    ['/spec-driver:spec-driver-fix', '$spec-driver-fix'],
    ['/spec-driver:spec-driver-resume', '$spec-driver-resume'],
    ['/spec-driver:spec-driver-sync', '$spec-driver-sync'],
    ['/spec-driver:spec-driver-doc', '$spec-driver-doc'],
    ['Claude Code 的 Task tool', 'Task tool（Codex 下按内联子代理执行）'],
    [
      '在同一消息中同时发出多个 Task tool 调用。Claude Code 的 function calling 机制支持在单个 assistant 消息中发出多个 tool calls，这些 tool calls 会被并行执行。',
      '若当前环境支持并行工具调用，则在同一消息中并行执行；否则按本 Skill 的回退规则串行执行。',
    ],
  ];
  let result = text;
  for (const [from, to] of replacements) {
    result = result.split(from).join(to);
  }
  return result;
}

/**
 * 提取 wrapper body 文本（frontmatter 剥除 + 9 条 runtime text 替换）。
 * @param {string} sourceSkillPath canonical SKILL.md 绝对路径
 * @returns {string}
 */
export function extractWrapperBody(sourceSkillPath) {
  const content = fs.readFileSync(sourceSkillPath, 'utf-8');
  return rewriteCodexRuntimeText(stripFrontmatter(content));
}

/**
 * 计算 wrapper body 的 sha256（hex）。
 * @param {string} sourceSkillPath canonical SKILL.md 绝对路径
 * @returns {string} 64 位 hex
 */
export function computeWrapperBodySha256(sourceSkillPath) {
  const body = extractWrapperBody(sourceSkillPath);
  return crypto.createHash('sha256').update(body, 'utf-8').digest('hex');
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  try {
    // CRITICAL-1：用 fileURLToPath 而非 new URL(...).pathname——后者在安装路径含空格/非 ASCII 时
    // 保留 %20/%E4... 转义，与 process.argv[1] 比对失败 → main() 不执行 → 静默生成空 wrapper。
    // 与 validate-wrapper-sources.mjs 的 isDirectExecution 保持同一实现。
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

// CLI 入口：shell write_skill_body 调 `node extract-wrapper-body.mjs <source>` 取 body（写 stdout）
if (isDirectExecution()) {
  const sourcePath = process.argv[2];
  if (!sourcePath) {
    console.error('用法: node extract-wrapper-body.mjs <source-skill-path> [--sha256]');
    process.exit(1);
  }
  if (process.argv[3] === '--sha256') {
    process.stdout.write(computeWrapperBodySha256(sourcePath));
  } else {
    process.stdout.write(extractWrapperBody(sourcePath));
  }
}
