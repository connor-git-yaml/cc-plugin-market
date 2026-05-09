#!/usr/bin/env node
/**
 * Feature 157 — graph.json fixture 归一化脚本（一次性）
 *
 * 输入：spectra batch 产生的 _meta/graph.json
 * 输出：归一化后的 graph.json（剔除时变字段，可作 snapshot 测试 fixture）
 *
 * 归一化字段（Codex C-3 修订）：
 *   - graph.generatedAt → 固定为 '2026-05-09T00:00:00.000Z'
 *   - graph.inputHash   → 固定为 '<normalized>'（每次跑都变）
 *   - nodes[].metadata.currentRun → 删除
 *
 * 用法：
 *   node scripts/normalize-graph-fixture.mjs <src.json> <dst.json>
 *
 * 注：此脚本是 Feature 157 的 implement 产物（不入 npm scripts）；
 *      若未来同样需求多次出现，可考虑迁移到 lib/。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, '..');

const NORMALIZED_TIMESTAMP = '2026-05-09T00:00:00.000Z';
const NORMALIZED_HASH = '<normalized>';

/**
 * 路径归一化（Codex plan/tasks CRITICAL 1 修订 + self-dogfood 实测增强）
 *
 * 实测 graph.json 节点 id / links source/target 含三类不稳定路径：
 *   1. `../<project>-output/<tool>-<mode>/modules/X.spec.md`（micrograd/nanoGPT 形态）
 *   2. `../../../../../../.spectra-baselines/<project>-output/<tool>-<mode>/modules/X.spec.md`（self-dogfood spec 节点形态）
 *   3. **`/Users/<user>/.../<worktree>/path/to/file.ts::Symbol`（self-dogfood callSite 节点形态）**
 *
 * 跨机器 / 跨 worktree 时这三类前缀都会变 → fixture 不稳定
 *
 * 归一化规则：
 *   - 类 1/2：`_meta/modules/<name>.spec.md`
 *   - 类 3：strip PROJECT_ROOT 前缀，转为 repo-relative POSIX path（保留 `::Symbol` 后缀）
 */
// 已知 baseline 项目 allowlist（Phase 5b quality-review WARNING 2 修订：
// 之前 regex `[^/]+-output` 过宽，会把任何 `*-output/<x>/modules/` 当作 spec 节点 path 吞掉。
// 收紧为已知 baseline 项目 + 兜底 `.spectra-baselines/` 前缀，避免误吞产品代码 `xxx-output/builder.ts`。
const BASELINE_PROJECT_NAMES = ['self-dogfood', 'micrograd', 'nanoGPT', 'hono', 'HikariCP', 'gorm'];
const BASELINE_OUTPUT_PATTERN = new RegExp(
  `(?:^|\\/)(?:\\.spectra-baselines\\/)?(?:${BASELINE_PROJECT_NAMES.join('|')})-output\\/([^/]+)\\/modules\\/(.+)$`
);

function normalizePath(p, projectRoot = DEFAULT_PROJECT_ROOT) {
  if (typeof p !== 'string') return p;

  // 类 1/2：spec.md 节点（仅匹配已知 baseline 项目结构）
  const specMatch = p.match(BASELINE_OUTPUT_PATTERN);
  if (specMatch) {
    return `_meta/modules/${specMatch[2]}`;
  }

  // 类 3：绝对路径 strip PROJECT_ROOT 前缀（保留 ::Symbol / #Symbol 后缀）
  if (path.isAbsolute(p)) {
    const projectRootNorm = projectRoot.replace(/\/$/, '');
    if (p.startsWith(projectRootNorm + '/') || p === projectRootNorm) {
      const rel = p.slice(projectRootNorm.length + 1);
      // POSIX 化（防 windows 反斜杠）
      return rel.split(path.sep).join('/');
    }
    // 不在 PROJECT_ROOT 下的绝对路径（外部库 / temp dir）— 标记 <ext> 占位避免泄露用户路径
    return `<ext>${p.slice(p.lastIndexOf('/'))}`;
  }

  return p;
}

function main() {
  const [, , src, dst] = process.argv;
  if (!src || !dst) {
    console.error('用法: node scripts/normalize-graph-fixture.mjs <src.json> <dst.json>');
    process.exit(2);
  }
  if (!fs.existsSync(src)) {
    console.error(`源文件不存在: ${src}`);
    process.exit(1);
  }

  const g = JSON.parse(fs.readFileSync(src, 'utf-8'));

  if (g.graph?.generatedAt) {
    g.graph.generatedAt = NORMALIZED_TIMESTAMP;
  }
  if (g.graph?.inputHash !== undefined) {
    g.graph.inputHash = NORMALIZED_HASH;
  }

  for (const n of g.nodes ?? []) {
    if (n.id) n.id = normalizePath(n.id);
    if (n.sourceFile) n.sourceFile = normalizePath(n.sourceFile);
    if (n.metadata) {
      delete n.metadata.currentRun;
      if (n.metadata.sourcePath) n.metadata.sourcePath = normalizePath(n.metadata.sourcePath);
      if (n.metadata.sourceTarget) n.metadata.sourceTarget = normalizePath(n.metadata.sourceTarget);
      if (Array.isArray(n.metadata.relatedFiles)) {
        n.metadata.relatedFiles = n.metadata.relatedFiles.map(normalizePath);
      }
    }
  }

  for (const e of g.links ?? []) {
    if (e.source) e.source = normalizePath(e.source);
    if (e.target) e.target = normalizePath(e.target);
  }

  const audit = {
    nodes: (g.nodes ?? []).length,
    links: (g.links ?? []).length,
    callsEdges: (g.links ?? []).filter((l) => l.relation === 'calls').length,
    sizeBytes: 0,
  };

  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const out = JSON.stringify(g, null, 2) + '\n';
  fs.writeFileSync(dst, out, 'utf-8');
  audit.sizeBytes = Buffer.byteLength(out);

  console.log(`[normalize-graph-fixture] ${path.basename(src)} → ${path.relative(process.cwd(), dst)}`);
  console.log(`  audit: nodes=${audit.nodes} links=${audit.links} callsEdges=${audit.callsEdges} size=${audit.sizeBytes}B`);
}

main();
