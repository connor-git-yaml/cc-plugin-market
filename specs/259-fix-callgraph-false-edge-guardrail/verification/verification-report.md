# Verification Report: F259 调用图确定性假边收口 + collector 指纹护栏 py 侧盲区补齐

**特性分支**: `claude/f259-call-graph-guardrail-fix-44d1e2`（基线 19bff52a）
**验证日期**: 2026-08-06
**验证范围**: Layer 1（Spec-Code 对齐，Fix 模式按 fix-report/tasks 判据）+ Layer 1.5（验证铁律证据）
+ Layer 1.75/1.8/1.9（深度检查/残留扫描/文档一致性）+ Layer 2（原生工具链）+ 亲自复现的对抗验证

## Layer 1: Spec-Code 对齐（Fix 模式，按 fix-report 缺陷 + tasks.md 判据）

| 条目 | 状态 | 对应 Task | 说明 |
|------|------|----------|------|
| 缺陷 1（TS/JS `require()` 路径字面量兜底覆写同名静态绑定的确定性假边） | ✅ 已实现 | T001-T006 | 亲自复现探针：post-fix `js()` 解析到 `src/lit.ts::js`（正确），pre-fix（临时还原判据）解析到 `src/dep.ts::js`（假边）。判据变更为唯一改动（`git diff` 24 insertions/1 deletion，含注释） |
| 缺陷 2（护栏对 `#2 pyWalk` 管线边面零独占覆盖） | ✅ 已实现 | T007-T016 | 亲自复现探针 C（剔除 `pythonSkeletons`）：4 failed / 19 passed（与 notes 记录逐字一致），还原后 23/23 绿、`git diff` 干净 |
| 回归护栏核对（本仓 graph-only 逐边 diff + 图质量六指标） | ✅ 已实现（由主编排器 A/B 复现，本报告未重跑建图） | T017-T018 | LOST=0/GAINED=0 结论已核实来源于主编排器受控 A/B（仅切换判据一行，其余变量完全一致）；本次亲自跑 `graph-quality` 命令复核，六指标 pass（freshness=dirty 属预期未提交状态） |
| F249 FR-005(c) 记账修订（只追加不改写） | ✅ 已实现 | T019 | `git diff` 确认为纯追加段落，未修改原有内容 |
| 全量验证五件套 | ✅ 已实现 | T020-T024 | 本报告亲自重跑，全部退出码 0（见 Layer 2） |
| Phase 4a/4b 两路独立异构对抗审查处置（0 CRITICAL / 2 WARNING，均已处置） | ✅ 已实现 | Phase 4a/4b（notes 记录） | W1（plan/tasks 记账不同步）已在 plan.md/tasks.md 补 `> ⚠️ 已撤回` 引用块；W2（注释 over-claim + 护栏覆盖缺口）已重写注释 + 新增 "F259 裁定 3 补充" 用例，本报告亲自跑该用例确认通过 |

### 覆盖率摘要

- **总条目数**: 6（按 fix-report 缺陷 + tasks.md Phase 结构归并）
- **已实现**: 6
- **未实现**: 0
- **部分实现**: 0
- **覆盖率**: 100%（tasks.md 24/24 任务勾选 `[x]`，含 1 处已如实标注撤回但未删除勾选的 T003）

## Layer 1.5: 验证铁律合规

**状态**: COMPLIANT

- `implementation-notes.md` 全文以"命令 + 真实终端输出 + 退出码"格式记录每一步验证（如
  `Tests 69 passed (69)`、`Tests 4 failed | 19 passed (23)`、`repo-check status=pass` 等），
  未见"should pass"/"看起来没问题"等推测性表述。
- 本报告对其中关键、决定性的验证点（缺陷 1 假边探针、缺陷 2 探针 C、1 个"可红"变异维度
  ignore-dirs-pruning、`stageFixture()` 结构性不可见性核实）做了**独立亲自复现**，结果与
  implementation-notes 记录逐字一致（详见下方"独立复现记录"）。
- 缺失验证类型: 无
- 检测到的推测性表述: 无

## Layer 1.75: 深度检查

### a. 调用链完整性（缺陷 1）

亲自搭建临时工程（`caller.ts` 含 `import { js } from './lit.js'` + `require('./dep.js')`），
完整走 `collectTsJsCodeSkeletons` → `buildImportIndex`（生产代码，未 mock）→ `buildUnifiedGraph`
全链路：

- **post-fix**（当前工作树代码）：`go()` 的 calls 边 `target` 为 `src/lit.ts::js`（正确，静态绑定未被覆写）
- **pre-fix**（临时把判据还原为 `if (!hasBindingNames(imp))`，验证后立即 `mv` 恢复并
  `git diff` 确认无残留改动）：`go()` 的 calls 边 `target` 为 `src/dep.ts::js`（假边，两端均真实节点）

链路无断点，判据变更在唯一生效点（`buildImportIndex` 第一遍循环）阻断了假边产生。

### b. 数据持久化验证

本次改动不涉及数据库/文件持久化写入路径（改动限于内存态图构建判据 + pinned fixture 资产），
`npm run fixtures:regen:collector-fingerprint` 的落盘写入已由 implementation-notes T011 逐项核对
（新增节点/边数量、`fixtureInputHash` 一致性），本报告未见异常。

### c. 配置贯穿验证

`BEHAVIOR_VERSION`（`collector-fingerprint.ts`）从 2 bump 至 3，`git diff` 确认改动范围仅限该常量
及其注释；`shouldRejectRegen` 判据消费该值的路径未改动，bump 后 regen 脚本按预期放行
（notes T011 记录的 `[regen] 放行` 输出）。

## Layer 1.8: 残留扫描

- 本次改动不含删除/重命名（只有新增判据条件、新增 fixture、新增测试用例、pinned 资产再生），
  无需做旧名称残留扫描。
- 亲自 `find` 确认 `tests/fixtures/collector-fingerprint-guardrail/src/py/` 下无 `__pycache__`/`.pyc`
  残留（notes Phase 5 记录的 `.pyc` 污染问题已清理，git status 干净）。

## Layer 1.9: 文档一致性检查

- `plan.md`（`> ⚠️ 已撤回` 引用块，L160-167）与 `tasks.md`（T003 同款引用块，L59-65）均已同步标注
  改动点 2 撤回事实，本报告 `grep` 确认两处引用块均存在，未见 plan/tasks 与 implementation-notes
  记账不一致处。
- `tests/fixtures/collector-fingerprint-guardrail/README.md` 覆盖表按 T015 判据修正（未逐字核对
  行数变化，但 `git diff --stat` 显示 25 行变更，量级与"1 行样本记录 + 1 行脚注 + 1 节补记"的
  声称相符）。

## Layer 2: 原生工具链

**检测到**: `package.json`（npm，JS/TS，Node 20.x+）
**项目目录**: 仓库根目录

| 验证项 | 命令 | 状态 | 详情 |
|--------|------|------|------|
| Test（vitest） | `npx vitest run` | ✅ PASS | 522 passed \| 4 skipped (526) files；7119 passed \| 18 skipped \| 21 todo (7158) tests；0 failed；退出码 0 |
| Test（插件） | `npm run test:plugins` | ✅ PASS | 1484 pass / 0 fail；退出码 0 |
| Build | `npm run build` | ✅ PASS | `tsc` 零错误；`[postbuild:stamp] 盖章: commit=19bff52a (dirty)`；退出码 0 |
| Repo Check | `npm run repo:check` | ✅ PASS | `[repo-check] status=pass`，全部子项（含 graph-quality 六指标、spec-drift、model-literal-gate、worktree-local-state 等）pass；退出码 0 |
| Release Check | `npm run release:check` | ✅ PASS | `Release contract valid (contracts/release-contract.yaml)`；退出码 0 |

以上 5 条命令均为本报告亲自实跑（非采信 implementation-notes 转述），输出结果与 notes 记录逐字一致。

## 独立复现记录（决定性验证点，本报告亲自动手）

1. **缺陷 1 假边探针**：新建临时工程于 scratchpad，`import { js } from './lit.js'` +
   `require('./dep.js')`，全链路走生产代码 `collectTsJsCodeSkeletons`/`buildImportIndex`/
   `buildUnifiedGraph`。post-fix：`js()` 调用边 target = `src/lit.ts::js`（正确）；临时把
   `buildImportIndex` 判据还原为修复前形式后重跑：target = `src/dep.ts::js`（假边，复现
   fix-report 描述的 bug）。验证后 `mv` 恢复文件，`git diff` 确认干净。
2. **缺陷 2 探针 C（决定性）**：先跑基线 `SPECTRA_TEST_SKIP_DIST_BUILD=1 npx vitest run
   tests/unit/guardrail/collector-fingerprint-guardrail.test.ts` → 23/23 绿；临时把
   `graph-assembly.ts` 的 `codeSkeletons` 合并中 `pythonSkeletons` 整体剔除后重跑 →
   **4 failed | 19 passed (23)**（与 implementation-notes T010 重做记录逐字一致）；用
   `git checkout -- src/batch/stages/graph-assembly.ts` 还原（`git diff` 确认干净），重跑确认
   恢复 23/23 绿。
3. **变异矩阵抽查·"可红"维度**：`(1) ignore-dirs-pruning`——临时在
   `PY_SKELETON_IGNORE_DIRS`（`source-discovery.ts`）新增 `'py'`（fixture 的 py 样本恰好都在
   `src/py/` 下）→ 重跑护栏 → **4 failed | 19 passed (23)**（与 notes 一致）；`git checkout --`
   还原确认干净，重跑恢复 23/23。
4. **变异矩阵抽查·"不可覆盖"维度**：`(2) gitignore-interpretation`——阅读
   `stageFixture()`（`collector-fingerprint-guardrail.test.ts` L77-82）源码确认其只
   `fs.cpSync(FIXTURE_ROOT/src, staged/src)`，从不复制任何 `.gitignore` 文件到 staged 根目录；
   结合护栏运行环境（`os.tmpdir()` 临时目录非 git 仓库），F255 的 git 事实源分支必然失败回退，
   过滤谓词恒为 `false`——该维度"结构性不可见"的诚实标注理由成立。
5. **回归护栏核对（T017/T018 逐边 diff）**：本报告未重跑建图，采信编排器已完成的受控 A/B
   （仅切换判据一行、其余变量完全一致，LOST=0/GAINED=0）结论；本报告独立跑
   `node dist/cli/index.js graph-quality --graph specs/_meta/graph.json --format text` 复核，
   六指标 pass（`freshness: dirty` 因工作树未提交，`recorded` 与 `current` commit hash 相同，
   与 T018 记录的解释一致）。**此项未做完整独立重建，标注为部分独立验证。**
6. **回归护栏（既有测试组）**：`git diff tests/unit/knowledge-graph/call-resolver.test.ts` 与
   `git diff tests/unit/guardrail/collector-fingerprint-guardrail.test.ts` 均确认**无 `it(`/
   `describe(` 块被删除**（纯增量），F242/F243/F250 既有用例未被删改，且全量 vitest 结果确认
   两文件全绿（70 tests、23 tests）。

## Summary

### 总体结果

| 维度 | 状态 |
|------|------|
| Spec Coverage | 100%（6/6 缺陷/条目，tasks.md 24/24 任务） |
| Build Status | ✅ PASS |
| Lint Status | ⏭️ 未检测到独立 lint 命令（`npm run repo:check` 已覆盖仓库自定义 lint/合规校验族） |
| Test Status | ✅ PASS（vitest 7119/7119；test:plugins 1484/1484） |
| **Overall** | **✅ READY FOR REVIEW** |

### 需要修复的问题（如有）

无。

### 未验证项 / 部分独立验证项

- **本仓 graph-only 全量重建的逐边 diff**（T017）：未在本次验证中重新跑全量建图独立复现，
  采信主编排器已完成的受控 A/B 结论（LOST=0/GAINED=0）；本报告仅独立复核了 `graph-quality`
  六指标命令结果一致，未对 7000+ 节点/12000+ 边做逐条独立 diff。
- **变异矩阵其余 3 个维度**（symlink-handling / file-size-guard / collection-failure-degradation）
  未逐一亲自复现，仅抽查 1 个"可红"+1 个"不可覆盖"维度，其余采信 implementation-notes 记录。
- **README.md 覆盖表逐字核对**：仅核对 `git diff --stat` 行数量级，未逐字核对表格内容变更。

## 工具使用反馈（Dogfooding，Feature 259 收尾）

- 本次验证以 Bash 直跑 `npx vitest`/`tsx` 探针 + `git diff`/`git checkout --` 为主，未使用
  Spectra MCP 工具（`impact`/`context`/`detect_changes` 等）——原因：验证任务的核心是
  "亲自复现代码行为差异"（判据变更前后的图构建结果对比），需要真实执行生产代码路径而非
  静态依赖分析，MCP 的 graph 查询工具在此场景下不适用。若未来需要评估本次改动的调用方
  影响面（如 `buildImportIndex` 的下游消费者），可用 `mcp__plugin_spectra_spectra__impact`
  做 blast radius 核查，本次未涉及该类需求。
