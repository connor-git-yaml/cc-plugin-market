# Quickstart：验证 `.pyi` 符号采集面扩集生效

> **修订记录**：本版本已按 plan 阶段对抗审查结论（W1/W2/W3）修正——原 `npx tsx -e "import...await..."` 写法在实测中必失败（`tsx -e` 按 CJS 转译求值，不支持顶层 `import` 语句与顶层 `await` 组合）；`buildAstGraphOnly` 直接传入 pinned fixture 目录会在其内生成 `specs/_meta/graph.json` 等产物污染入库目录。以下步骤已改为"写入临时 `.mts` 文件 → `npx tsx <file>`"的可执行形态，并对 fixture 建图步骤增加了 staging 隔离。

本指南给出验证本 feature 已正确生效的最短路径，供实现者自查与验收阶段复核。**全部命令均在仓库根目录执行。**

## 1. 确认 SSoT 常量取值

```bash
grep -A3 "PYTHON_SYMBOL_SCAN_SURFACE: CollectorPipelineSurface" src/collector-surface.ts
```

期望看到 `extensions: new Set(['.py', '.pyi'])`。

## 2. 用护栏 fixture 实跑 graph-only 建图，检查 `.pyi` module/symbol 节点元数据（W1/W2 修正）

**W2 警告**：`buildAstGraphOnly(projectRoot)` 会在传入的 `projectRoot` 内生成 `specs/_meta/graph.json` 等产物。**MUST NOT** 直接把 `tests/fixtures/collector-fingerprint-guardrail`（入库目录）作为 `projectRoot` 传入，否则会在该入库目录内产生未跟踪的写入物。以下脚本先把 fixture 的 `src/` 复制到独立临时目录（与再生脚本 `stageFixture` 的隔离语义一致）再建图。

```bash
cat > tmp-f250-check-graph.mts << 'EOF'
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildAstGraphOnly } from './src/batch/batch-orchestrator.js';

const fixtureRoot = 'tests/fixtures/collector-fingerprint-guardrail';
const staged = fs.mkdtempSync(path.join(os.tmpdir(), 'f250-quickstart-'));
fs.cpSync(path.join(fixtureRoot, 'src'), path.join(staged, 'src'), { recursive: true });

try {
  const result = await buildAstGraphOnly(staged);
  const graph = JSON.parse(fs.readFileSync(result.graphPath, 'utf-8'));

  const moduleNode = graph.nodes.find((n: { id: string }) => n.id === 'src/py/mod.pyi');
  const symbolNode = graph.nodes.find((n: { id: string }) => n.id === 'src/py/mod.pyi::mod_fn');
  console.log('=== module node (src/py/mod.pyi) ===');
  console.log(JSON.stringify(moduleNode, null, 2));
  console.log('=== symbol node (src/py/mod.pyi::mod_fn) ===');
  console.log(JSON.stringify(symbolNode, null, 2));
} finally {
  fs.rmSync(staged, { recursive: true, force: true });
}
EOF
npx tsx tmp-f250-check-graph.mts
rm tmp-f250-check-graph.mts
```

期望 `symbolNode.metadata` 含 `signature`（有值）、`symbolKind: 'function'`、`confidence: 'EXTRACTED'`、`sourceTag: 'extraction'`，同时保留 `unifiedKind: 'symbol'`/`sourcePath`/`exportKind`（unified 路合并补缺的既有字段）。

## 3. 确认 module 节点 label 剥离

沿用第 2 步打印出的 `moduleNode`（无需重跑），期望其 `label === 'mod'`（不含扩展名），`id` 仍是完整 `src/py/mod.pyi`。

## 4. 确认 shadow 对 import 解析护栏 A 生效 + modules[] 视图完整性（W1/W3 修正）

以下脚本同时验证：(a) 绝对 import 恒解析到 `.py`（护栏 A）；(b) `ModuleGraph.modules[]` 视图完整包含 `.pyi` 条目（FR-003b）；(c) `.pyi` 文件自身作为 import **来源**时不受护栏 A 影响，仍能正常产生指向 `.py` 的 `depends-on` 边。

```bash
cat > tmp-f250-check-shadow.mts << 'EOF'
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PythonLanguageAdapter } from './src/adapters/python-adapter.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f250-shadow-probe-'));
try {
  fs.writeFileSync(path.join(tmpDir, 'mod.py'), 'def mod_fn(): pass\n');
  // mod.pyi 自身也发起一次 import，用于验证 .pyi 作为 import 来源时的行为（护栏 A 只排除 .pyi 作为目标）
  fs.writeFileSync(path.join(tmpDir, 'mod.pyi'), 'import helper\ndef mod_fn() -> None: ...\n');
  fs.writeFileSync(path.join(tmpDir, 'helper.py'), 'def helper_fn(): pass\n');
  fs.writeFileSync(path.join(tmpDir, 'user.py'), 'import mod\n');

  const adapter = new PythonLanguageAdapter();
  const graph = await adapter.buildModuleGraph(tmpDir);

  const sources = graph.modules.map((m) => m.source);
  console.log('=== modules[] sources ===');
  console.log(sources);
  console.log('=== edges ===');
  console.log(JSON.stringify(graph.edges, null, 2));

  // FR-003b：modules[] 应完整包含 .pyi 条目（不因护栏 A 被排除出拓扑分析视图）
  console.assert(sources.includes('mod.pyi'), 'FAIL: modules[] 应包含 mod.pyi');
  // 护栏 A：不应存在任何指向 mod.pyi 的边
  console.assert(
    !graph.edges.some((e) => e.to === 'mod.pyi'),
    'FAIL: 不应存在指向 mod.pyi 的 import 边',
  );
  // user.py 的绝对 import 必须解析到 mod.py
  console.assert(
    graph.edges.some((e) => e.from === 'user.py' && e.to === 'mod.py'),
    'FAIL: user.py -> mod 应解析到 mod.py',
  );
  // .pyi 自身作为 import 来源时不受护栏 A 影响，正常产生指向 .py 的边
  console.assert(
    graph.edges.some((e) => e.from === 'mod.pyi' && e.to === 'helper.py'),
    'FAIL: mod.pyi 自身的 import helper 应正常解析到 helper.py',
  );
  console.log('全部断言通过。');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
EOF
npx tsx tmp-f250-check-shadow.mts
rm tmp-f250-check-shadow.mts
```

期望所有 `console.assert` 均无输出（无输出即断言通过；`console.assert` 只在断言失败时打印 `Assertion failed: ...`），最终打印"全部断言通过。"。

## 5. 再生 pinned fixture 并核对 delta

```bash
npm run fixtures:regen:collector-fingerprint
git diff tests/fixtures/collector-fingerprint-guardrail/
```

按 `contracts/collector-surface-extension.md` 契约 3/4 逐字段核对 diff，确认没有出现"不应出现的 delta"清单中的任何一项。

## 6. 全量验证

```bash
npx vitest run
npm run build
npm run repo:check
```

三者均须零失败，才视为本 feature 生效且无回归。
