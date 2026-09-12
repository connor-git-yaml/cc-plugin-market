#!/usr/bin/env node
/**
 * F287 卡 A · G3 重算器：用 core 的 `PENDING_MARK_REGEX` / `countPendingSections` 扫全仓真实 verification-report，
 * 打印每份报告的命中节（标题 + 首条命中行）与总计，供 `pending-truth-set.md` 的人工真值集复算。
 * 用法：node specs/287-compliance-card-a-diag-canonical/verification/pending-truth-recompute.mjs [--alt]
 *   --alt：改扫「无 PENDING 标记但含替代词」的节（召回面候选），替代词表见下（启发式，只用于估召回上界）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PENDING_MARK_REGEX, countPendingSections } from '../../../plugins/spec-driver/scripts/lib/fix-compliance-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ALT_REGEX = /未回填|未执行|需人工|待办|待补|尚未|未完成|留待|待定|待验证|待复测|未闭合|人工验证|MANUAL|WAIT/;
const alt = process.argv.includes('--alt');

// verify 子代理 WARNING：首稿只扫 `specs/<数字>-*/verification/`，漏掉 `170a~170e-*`（数字后接字母）与嵌套目录
// （如 `158-*/impl-supplement/verification/`）；改为递归找所有 `**/verification/verification-report.md`。
function findReports(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) findReports(full, out);
    else if (e.name === 'verification-report.md' && path.basename(dir) === 'verification') out.push(path.relative(ROOT, full));
  }
  return out;
}
const files = findReports(path.join(ROOT, 'specs'), []).sort();

let hitFiles = 0; let hitSections = 0;
for (const rel of files) {
  const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const sections = [];
  let cur = { title: '(前言)', lines: [] };
  for (const line of text.split('\n')) {
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) { sections.push(cur); cur = { title: h[1].trim(), lines: [] }; } else cur.lines.push(line);
  }
  sections.push(cur);
  if (alt && text.split('\n').some((l) => PENDING_MARK_REGEX.test(l))) continue;
  const rx = alt ? ALT_REGEX : PENDING_MARK_REGEX;
  const hits = sections.map((s) => [s, s.lines.find((l) => rx.test(l))]).filter(([, l]) => l !== undefined);
  if (hits.length === 0) continue;
  hitFiles += 1; hitSections += hits.length;
  const counted = alt ? '' : `  countPendingSections=${countPendingSections(text)}`;
  console.log(`\n## ${rel}${counted}`);
  for (const [s, l] of hits) console.log(`  [${s.title.slice(0, 70)}] ${l.trim().slice(0, 140)}`);
}
console.log(`\n${alt ? 'ALT' : 'MARK'} files=${files.length} hitFiles=${hitFiles} hitSections=${hitSections}`);
