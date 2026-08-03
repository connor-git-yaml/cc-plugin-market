# 修复实施计划: F244 F220 stage 依赖矩阵守护对共置测试的结构性误报

**Branch**: `claude/strange-sammet-55b793` | **Date**: 2026-08-03 | **模式**: fix
**Input**: `specs/244-fix-stage-guard-colocated-tests/fix-report.md`（5-Why 根因追溯 + 方案 A 已锁定）

**Note**: fix 模式精简计划，聚焦最小变更范围、回归风险评估与修复验证方案；不产出
research.md / data-model.md / contracts/ / quickstart.md（本修复不涉及新实体、新契约、新架构，
仅是既有测试守护自身收集器逻辑的收窄 + 可测试性重构，改动范围严格限定在单一测试文件内）。

## Summary

**根因（fix-report.md 5-Why，Root Cause Reached at Why 5）**：`f220-export-surface.test.ts` 的
`listStageFilesRecursive`（L52-61）按 `.ts` 后缀全量收集 `src/batch/stages/**` 下文件，未排除
`*.test.ts`/`*.spec.ts`，导致仓库规范允许的共置测试文件被当作 stage 生产模块参与「未授权 stage
依赖边」判定（L136-168 的依赖矩阵 it 块），F243 在 `stages/` 下共置 `source-discovery.test.ts` 时
被误判为「未授权依赖边」，被迫规避迁移到 `tests/batch/`。同时该判定逻辑内联在 it 块中，无法用
fixture 独立驱动，守护自身缺少红/绿回归用例。

**修复方案（方案 A，已在 fix-report.md 锁定）**：
1. `listStageFilesRecursive` 收窄：排除匹配 `/\.(test|spec)\.(ts|mts)$/` 的文件——两处调用点
   （L100 导出面用例的 ts-morph project 填充 + L140 依赖矩阵判定）同时受益，单点修复。
2. 把依赖矩阵判定逻辑从 `it` 块内联提取为纯函数 `collectStageViolations(stageFiles, stagesDir,
   facadePath, allowedEdges?)`（仍在同测试文件内、不导出到文件外），使其可用 `mkdtemp` fixture
   目录独立驱动，与真实 `stages/` 扫描解耦。
3. 新增红/绿双向回归用例（`describe('F244 共置测试排除回归...')`，基于 `mkdtemp` 临时目录，
   不触碰真实 `src/batch/stages/`）。
4. 真实 `stages/` 目录的既有依赖矩阵 `it` 块保持语义不变，仅内部改为调用提取后的
   `collectStageViolations`。

## Scope

### In scope

1. `tests/unit/batch/f220-export-surface.test.ts`（唯一改动文件）：
   - `listStageFilesRecursive`：收窄文件收集，排除测试文件
   - 新增内部纯函数 `collectStageViolations`（从既有 it 块提取）
   - 既有「stage 依赖矩阵」it 块改为调用提取后的函数，断言不变
   - 新增 `describe` 块：绿用例（共置测试放行）+ 红用例（未授权 stage 边仍拦截、import facade
     仍拦截）
   - import 补充：`mkdtempSync`、`mkdirSync`、`writeFileSync`、`rmSync`（`fs`）、`tmpdir`（`os`）

### Out of scope（显式不做）

- 不迁回 `tests/batch/source-discovery.test.ts`（F243 规避迁移产物）——本修复只解除结构性限制，
  不强制迁移既有测试，保持原位
- 不改动 `src/batch/stages/**` 生产代码——本次是纯测试守护自身的收集口径修复，不触及被守护对象
- 不新增/修改其他守护文件——全仓 grep `listStageFilesRecursive`/`STAGES_DIR` 仅此一处命中，
  无其他守护复用该模式（见 fix-report.md 影响范围扫描）
- 不改变 `ALLOWED_STAGE_EDGES` 矩阵语义（仍仅 `graph-assembly.ts→source-discovery.ts` 一条允许边）

## Codebase Reality Check

| 目标文件 | LOC | 方法/函数数 | 已知 debt |
|---------|-----|------------|-----------|
| `tests/unit/batch/f220-export-surface.test.ts` | 169 | 3 个私有辅助函数（`listStageFilesRecursive`/`collectModuleSpecifiers`/`resolveSpecifier`）+ 4 个 `it` 用例 | 无 TODO/FIXME/HACK；无超长函数（最长函数 `listStageFilesRecursive` 10 行）；无循环依赖（纯测试文件，仅依赖 vitest/fs/path/url/ts-morph 与被测 facade） |

**前置清理规则判定**：LOC 169 < 500，预估新增（提取函数 + 新增 describe 块）约 60-80 行，均不满足
"LOC > 500 且新增 > 50 行"阈值的前半条件；无 > 3 个相关 TODO/FIXME；无 > 30 行重复逻辑。
**决策：不触发前置 `[CLEANUP]` 任务**。

## Impact Assessment

- **直接修改文件数**：1（`tests/unit/batch/f220-export-surface.test.ts`）
- **间接受影响（调用方/依赖方）**：无。`listStageFilesRecursive`/`collectModuleSpecifiers`/
  `resolveSpecifier` 均为测试文件内私有函数（未 export），两处调用点均在同文件内；本次改动不触及
  `src/batch/stages/**` 生产代码，不影响运行时行为、CLI、MCP 工具或任何消费图谱产物的下游测试
- **跨包影响**：无。改动完全局限于单一 `tests/unit/` 文件，不跨越 `plugins/`/`src/`/`scripts/`
  顶层边界
- **数据迁移**：无。不涉及 schema、配置格式、状态文件格式变更
- **API/契约变更**：无。不改变任何公共接口、CLI 参数、MCP tool 契约；`ALLOWED_STAGE_EDGES` 矩阵
  语义（生产 stage 间允许边）保持不变，仅收窄"谁参与判定"这一收集范围
- **风险等级：LOW**（影响文件数 1 < 10，无跨包影响，无数据迁移，无 API 契约变更）
- 未达 MEDIUM/HIGH 阈值，**不强制分阶段**，单一提交内完成

## 变更清单（精确到函数）

1. **收窄文件收集器**（原 L52-61 `listStageFilesRecursive`）：
   ```ts
   const COLOCATED_TEST_RE = /\.(test|spec)\.(ts|mts)$/;

   function listStageFilesRecursive(dir: string): string[] {
     if (!existsSync(dir)) return [];
     const out: string[] = [];
     for (const entry of readdirSync(dir, { withFileTypes: true })) {
       const abs = join(dir, entry.name);
       if (entry.isDirectory()) out.push(...listStageFilesRecursive(abs));
       else if (entry.isFile() && entry.name.endsWith('.ts') && !COLOCATED_TEST_RE.test(entry.name)) {
         out.push(abs);
       }
     }
     return out;
   }
   ```
   排除模式与仓库测试规范（`.claude/rules/tests.md`：`.test.ts`/`.spec.ts` 结尾）逐字对齐；额外
   兼容 `.mts` 变体（当前 stages/ 下无此形态，但收集器本身对 `.ts` 后缀判断也未区分 `.mts`，此处
   仅为正则完整性，不影响现有行为）。

2. **提取纯函数 `collectStageViolations`**（从原 L136-168 依赖矩阵 `it` 块内联逻辑提取，逻辑
   **一字不改**，仅替换硬编码的 `STAGES_DIR`/`FACADE_PATH`/`ALLOWED_STAGE_EDGES` 为形参）：
   ```ts
   function collectStageViolations(
     stageFiles: string[],
     stagesDir: string,
     facadePath: string,
     allowedEdges: ReadonlySet<string> = ALLOWED_STAGE_EDGES,
   ): string[] {
     const project = new Project({ skipAddingFilesFromTsConfig: true });
     const facadeResolved = facadePath.replace(/\.ts$/, '');
     const violations: string[] = [];

     for (const file of stageFiles) {
       const sf = project.addSourceFileAtPath(file);
       const fileName = file.slice(stagesDir.length + 1);
       for (const spec of collectModuleSpecifiers(sf)) {
         if (!spec.startsWith('.')) {
           if (/batch-orchestrator/.test(spec)) violations.push(`${fileName}: 非相对路径指向 facade (${spec})`);
           continue;
         }
         const resolved = resolveSpecifier(file, spec);
         if (resolved === facadeResolved) {
           violations.push(`${fileName}: import facade (${spec})`);
           continue;
         }
         if (resolved && resolved.startsWith(stagesDir)) {
           const target = resolved.slice(stagesDir.length + 1) + '.ts';
           const edge = `${fileName}→${target}`;
           if (fileName !== target && !allowedEdges.has(edge)) {
             violations.push(`${fileName}: 未授权 stage 依赖边 ${edge}`);
           }
         }
       }
     }
     return violations;
   }
   ```

3. **既有「stage 依赖矩阵」`it` 块**改为调用提取后的函数，断言与语义保持不变：
   ```ts
   it('stage 依赖矩阵：禁 import facade（任意拼写/动态 import）；stage 间仅允许 ②→①', () => {
     if (!existsSync(STAGES_DIR)) return;
     const stageFiles = listStageFilesRecursive(STAGES_DIR);
     const violations = collectStageViolations(stageFiles, STAGES_DIR, FACADE_PATH);
     expect(violations).toEqual([]);
   });
   ```

4. **新增回归 `describe` 块**（`describe('F244 共置测试排除回归（收集器 + 违规判定纯函数）', ...)`），
   使用 `mkdtempSync(join(tmpdir(), 'f243-stage-guard-'))` 构造临时 fixture，每个用例结束
   `rmSync(tmpDir, { recursive: true, force: true })` 清理：

   - **绿（放行侧，验证收集器排除 + 零 violation）**：
     fixture `stages/a.ts`（`export function a() {}`）+ 共置 `stages/a.test.ts`
     （`import { a } from './a.js'; ...`）。断言：
     - `listStageFilesRecursive(fixtureStagesDir)` 结果不含 `a.test.ts` 路径（收集器排除生效，
       独立于矩阵判定单独断言）
     - `collectStageViolations(listStageFilesRecursive(fixtureStagesDir), fixtureStagesDir,
       fixtureFacadePath)` 返回 `[]`（`a.ts` 本身无越界 import，测试文件已被排除不参与判定）

   - **红（拦截侧 1，验证矩阵外 stage 间边仍被拦截）**：
     fixture `stages/a.ts` import `./b.ts`（`stages/b.ts` 存在但非矩阵内允许边）。断言：
     `collectStageViolations(...)` 包含 `"a.ts: 未授权 stage 依赖边 a.ts→b.ts"`

   - **红（拦截侧 2，验证 import facade 仍被拦截）**：
     fixture `stages/a.ts` import 一个模拟 facade 路径（`../facade.ts`，仅需 `resolveSpecifier`
     可归一化解析，facade 文件本身不必真实存在于磁盘——`collectStageViolations` 只做路径字符串比对
     不读取 facade 内容）。断言：`collectStageViolations(...)` 包含 `"a.ts: import facade"` 前缀
     的 violation 消息

### 审查轮增量（Codex W1/W2 处置）

Codex 对抗审查发现「共置测试豁免」本身可被反向利用：`COLOCATED_TEST_RE` 只让收集器不把
`*.test.ts`/`*.spec.ts` 纳入 stage 依赖矩阵扫描，但没有任何合同禁止生产文件（facade/stages）反过来
`import` 一个测试命名文件，把它拖入编译闭包与 dist 产物（W1：facade 经 import 测试命名文件反向拉
测试图；W2：测试命名 specifier 解析落在 stages 目录外的第二盲区）。本轮增量：

- 新增合同函数 `collectTestNamedImportViolations(productionFiles)`：对每个生产文件的
  module specifier 做两类判定——相对路径经 `resolveSpecifier` 归一化后以 `.test`/`.spec` 结尾；
  非相对路径（裸包名/别名）字面量本身携带 `.test.<ext>`/`.spec.<ext>` 后缀
- F220 `describe` 块内新增对应 `it`：对 `[FACADE_PATH, ...listStageFilesRecursive(STAGES_DIR)]`
  真实源码树跑该合同，断言 `violations` 为空
- 新增红③ fixture（facade 经 import 测试命名文件反向拉测试图，W1 绕过场景复刻）与红④ fixture
  （测试命名 specifier 解析落在 stages 目录外，第二盲区），均断言 `collectTestNamedImportViolations`
  命中对应 violation；本次追加对红④断言的加强，从仅断"文案子串"收紧为断"含文件名前缀的完整子串"
  （如 `a.ts: 生产文件 import 测试命名模块`），与红③判别力对齐
- 合同函数内两处检测正则（`resolvedTestSuffixRe`/`bareTestSpecRe`）追加 `/i` 标志：检测侧大小写
  不敏感即保护面扩大（防 `.TEST.ts`/`.Spec.js` 等变体绕过），豁免侧 `COLOCATED_TEST_RE` 保持大小写
  敏感即保守 fail-closed（宁可少豁免不多放行），二者不对称是有意设计

> 补充说明：本节第 1 条示例代码块中的 `COLOCATED_TEST_RE = /\.(test|spec)\.(ts|mts)$/` 在实施时
> 已收敛为 `/\.(test|spec)\.ts$/`——`.mts` 分支在当前仓库 stages/ 下无实际形态、且收集器前置条件
> 本身已 `endsWith('.ts')` 与 `.mts` 互斥，属死分支，故未采纳原正则文本。

## 回归风险处置

| 类别 | 预期变化 | 处置方式 |
|------|---------|---------|
| 真实 `stages/` 目录的「stage 依赖矩阵」`it` 块 | **零变化**（逻辑一字不改，仅提取为函数调用）| 若变红，判定为提取过程引入 bug，立即修复而非改断言 |
| 真实 `stages/` 目录的「导出面」`it` 块（L95-124，L100 调用 `listStageFilesRecursive`）| **零变化**（当前 `stages/` 下无共置测试文件，收窄前后收集结果相同）| 若未来 `stages/` 下新增共置测试，本条不再触发误报（即本次修复目标） |
| `tests/batch/source-discovery.test.ts`（F243 规避迁移产物）| 不受影响，保持原位不迁回 | 无需处置，fix-report 已明确决策 |
| 新增回归 `describe` 块 | 全新用例，本身即验证目标 | 首次落地即须红/绿分明：绿用例先临时保留旧收集器逻辑验证会失败（证明修复前误报存在），修复后转绿；红用例修复前后均应保持红（拦截行为不变），防止"矫枉过正"误放行 |

## 验证方案

**前置**：无需 `npm run build`（本次改动是纯 `.test.ts` 文件，不产出 `dist/` 消费的编译产物）。

1. **目标文件单测**：
   ```bash
   npx vitest run tests/unit/batch/f220-export-surface.test.ts
   ```
   验证 4 个既有 it 块 + 新增 describe 块（绿 1 + 红 2 共 3 个新用例）全部通过。

2. **全量回归**：
   ```bash
   npx vitest run
   ```
   零失败（已知负载 flaky 名单——`watch-command`/`community-analysis` perf/`cli-e2e --version`/
   `batch-orchestrator-incremental`——若失败先隔离单独重跑定性，不计入本次回归判断）。

3. **类型检查 + 构建**：
   ```bash
   npm run build
   ```
   零错误（确认新增 `describe`/纯函数提取无 TypeScript 类型错误）。

**验收标准**：
- `f220-export-surface.test.ts` 全部 it 用例（含新增 3 个）通过，两轮结果一致
- 全量 `npx vitest run` 零失败（已知 flaky 除外）
- `npm run build` 零错误
- 手动核对：修复前（临时还原 `listStageFilesRecursive` 到全收集逻辑）新增绿用例应先失败
  （复现 F243 遇到的误报），修复后转绿——确认红/绿双向验证真实覆盖了本次问题场景，而非只测放行侧

## Constitution Check

*基于 `.specify/memory/constitution.md`*

| 原则 | 适用性 | 评估 | 说明 |
|------|--------|------|------|
| I. 双语文档规范 | 适用 | PASS | 本 plan.md 与 fix-report.md 均中文散文 + 英文代码标识符 |
| II. Spec-Driven Development | 适用 | PASS | 走 fix 模式完整链路（fix-report → plan → 实现 → 验证）|
| III. YAGNI / 奥卡姆剃刀 | 适用 | PASS | 未引入新抽象层；提取 `collectStageViolations` 是使判定逻辑可被 fixture 独立驱动的最小必要重构（否则无法写红/绿回归），非过度设计；`allowedEdges` 形参提供默认值，调用点零改动 |
| IV. 诚实标注不确定性 | 适用 | PASS | 无推测性内容，修复逻辑均基于对现有代码的确定性阅读 |
| V. AST 精确性优先 | 适用 | PASS | 判定逻辑本身（ts-morph AST 解析）未改动，仅收窄参与判定的文件集合口径 |
| VI-VIII（混合分析流水线/只读安全性/纯 Node.js 生态）| 不适用 | N/A | 本次改动不触及生产分析流水线代码，仅测试守护文件 |
| IX-XIV（Plugin: spec-driver 约束）| 不适用 | N/A | 本次改动不触及 `plugins/spec-driver/` |

**结论**：无 VIOLATION 项，无需 Complexity Tracking / 豁免论证。

## Non-Goals（显式排除，防止范围蔓延）

- 不迁移 `tests/batch/source-discovery.test.ts` 回 `src/batch/stages/`
- 不改动 `src/batch/stages/**` 任何生产代码
- 不扩展/修改 `ALLOWED_STAGE_EDGES` 矩阵内容
- 不新建独立的守护辅助模块或共享 helper（`collectStageViolations` 保留为本文件私有函数，未来若
  有第二个守护需要类似判定逻辑再评估是否提取为共享模块）
