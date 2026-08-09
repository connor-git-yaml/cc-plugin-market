#!/usr/bin/env node
/**
 * F260 callSites / exports 快照导出器（P0 归因基线的取数工具）。
 *
 * 用法：node dump-skeletons.mjs <tag> [projectRoot]
 *   → 写出 verification/callsites-<tag>.json 与 verification/exports-<tag>.json
 *
 * ## 为什么需要单独一个导出器
 *
 * `callSites` **不进任何落盘图产物**（plan §2.2-5：`GraphJSON` 无 `callSites` 字段，
 * graph-builder 只写 module 节点的 `callSitesCount` 数值）。因此 B1 裁决要求的
 * 「callSites 产物指纹」无法从 `graph-P*.json` 里重算，必须直接跑采集器取数。
 *
 * 取数口径与 `buildAstGraphOnly`（graph-assembly.ts:203-223）**逐字对齐**：同样的三个
 * 采集器、同样的 `extractCallSites: true`、同样的合并顺序，保证快照与同一次 graph-only
 * 建图看到的是同一批骨架。
 *
 * `exports-<tag>.json` 是 `edge-diff.mjs --skeletons` 的输入：断言 2 的第二跳
 * （成员必须来自那个 `kind==='class'` 的 export 条目自己的 `members`，A6/R10b）
 * 在最终图上不可判——图节点不记录成员由哪个 export 条目提供，必须回骨架查。
 *
 * 路径一律相对化到 projectRoot（对齐 F193 图相对化），使快照可跨 worktree 比较。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const tag = process.argv[2];
if (!tag) {
  console.error('用法: node dump-skeletons.mjs <tag> [projectRoot]');
  process.exit(2);
}
const projectRoot = path.resolve(process.argv[3] ?? path.resolve(here, '../../..'));
const distDir = path.join(projectRoot, 'dist');
if (!fs.existsSync(distDir)) {
  console.error(`未找到 ${distDir} —— 必须先 npm run build（陈旧 / 缺失 dist 会造假信号）`);
  process.exit(2);
}

const { collectPythonCodeSkeletons, collectTsJsCodeSkeletons } = await import(
  path.join(distDir, 'batch/stages/source-discovery.js')
);
const { collectGenericLanguageCodeSkeletons } = await import(
  path.join(distDir, 'batch/generic-language-skeleton-collector.js')
);

const rel = (p) => path.relative(projectRoot, p).split(path.sep).join('/');

const pythonSkeletons = await collectPythonCodeSkeletons(projectRoot);
const tsJsSkeletons = await collectTsJsCodeSkeletons(projectRoot, { extractCallSites: true });
const genericSkeletons = await collectGenericLanguageCodeSkeletons(projectRoot);
const codeSkeletons = new Map([...pythonSkeletons, ...tsJsSkeletons, ...genericSkeletons]);

const callSites = [];
const exportsIndex = {};
for (const [filePath, sk] of codeSkeletons) {
  const file = rel(filePath);
  for (const cs of sk.callSites ?? []) {
    callSites.push({ callerFile: file, ...cs });
  }
  exportsIndex[file] = (sk.exports ?? []).map((e) => ({
    name: e.name,
    kind: e.kind,
    ...(e.members ? { members: e.members.map((m) => m.name) } : {}),
  }));
}

// 稳定排序：文件 → 行 → 列 → callee 名，保证同一输入两次导出 byte-stable
callSites.sort(
  (a, b) =>
    a.callerFile.localeCompare(b.callerFile) ||
    a.line - b.line ||
    (a.column ?? -1) - (b.column ?? -1) ||
    a.calleeName.localeCompare(b.calleeName) ||
    a.calleeKind.localeCompare(b.calleeKind),
);

const sortedExports = Object.fromEntries(Object.keys(exportsIndex).sort().map((k) => [k, exportsIndex[k]]));

const callsitesFile = path.join(here, `callsites-${tag}.json`);
const exportsFile = path.join(here, `exports-${tag}.json`);
// callSites 量级 ~12 万条：紧凑 JSON（不缩进）——这是机器比对用产物，
// 缩进只会让文件体积翻倍而不增加任何可判读性（逐条查看走 callsites-fingerprint.mjs 的清单输出）。
fs.writeFileSync(
  callsitesFile,
  JSON.stringify({ tag, files: codeSkeletons.size, total: callSites.length, callSites }) + '\n',
);
fs.writeFileSync(exportsFile, JSON.stringify({ tag, exportsIndex: sortedExports }, null, 2) + '\n');

console.log(`skeletons=${codeSkeletons.size}  callSites=${callSites.length}`);
console.log(`写出 ${rel(callsitesFile)}`);
console.log(`写出 ${rel(exportsFile)}`);
