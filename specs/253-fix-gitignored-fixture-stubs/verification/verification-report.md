> 关联报告：[fix-report.md](../fix-report.md) ｜ 关联任务：[tasks.md](../tasks.md)

# 验证报告：fixture 忽略样本入库 + 前置存在性守卫（F253）

**模式**：fix ｜ **阶段**：Phase 4c 验证闭环 ｜ **验证时间**：2026-08-04

## 一、Layer 1：Spec-Code 对齐

本 fix 无独立 spec.md（fix 模式产物为 fix-report.md + plan.md + tasks.md）。tasks.md 全部 9 项任务（T001-T009）均已勾选完成，对应 fix-report.md 影响范围扫描登记的 3 处修复点（2 项任务登记 + 1 项影响面扫描新发现）已逐一核验：

| 修复点 | 状态 |
|---|---|
| `generated/StubOnly.java` 入库 | ✅ 已实现（`git ls-files` 确认 tracked） |
| `generated/stub.go` 入库 | ✅ 已实现（`git ls-files` 确认 tracked） |
| `build/Generated.java` 入库（影响面扫描新发现） | ✅ 已实现（`git ls-files` 确认 tracked） |
| 三条 ④ 用例加存在性前置守卫 | ✅ 已实现（Read 源码核实，行号见下） |

FR 覆盖率：4/4 修复点 = 100%。

## 二、Layer 1.5：验证铁律合规

**状态：COMPLIANT**

本轮验证由验证子代理独立真实执行全部命令（非引用 implement 阶段声明），过程与结论如下。

## 三、修复有效性证据核查

### 3.1 三样本 tracked 状态 + ignore 规则未被误改

```
$ git ls-files tests/fixtures/graph-quality-java/generated/StubOnly.java \
               tests/fixtures/graph-quality-go/generated/stub.go \
               tests/fixtures/graph-quality-java/build/Generated.java
tests/fixtures/graph-quality-go/generated/stub.go
tests/fixtures/graph-quality-java/build/Generated.java
tests/fixtures/graph-quality-java/generated/StubOnly.java
```
三样本均 tracked。

```
$ git check-ignore -v --no-index <各路径>
tests/fixtures/graph-quality-java/.gitignore:1:generated/  → StubOnly.java
tests/fixtures/graph-quality-go/.gitignore:1:generated/    → stub.go
.gitignore:7:build/                                        → Generated.java（仓库根规则）
```
三样本入库后依然被各自 `.gitignore` pattern 命中 —— 证明是 `git add -f` 强制入库而非误改 `.gitignore` 规则本体。三处 `.gitignore` 均未被改动（`git diff` 无涉及）。

### 3.2 existsSync 前置守卫位置核实（Read 源码）

`src/batch/generic-language-skeleton-collector.test.ts`：
- L63：`④ 内置忽略目录命中样本（build/Generated.java）` 用例 —— `existsSync` 断言在 `collectGenericLanguageCodeSkeletons` 调用（L64）**之前**
- L74：`④ .gitignore 命中样本（generated/StubOnly.java）` 用例 —— `existsSync` 断言在调用（L75）**之前**
- L94-95：`④ Go 联合用例` —— 两行 `existsSync`（`vendor/Generated.go` + `generated/stub.go`）均在调用（L96）**之前**

三处守卫位置均正确（先断言存在性，再跑 collector）。

### 3.3 Fresh-clone 模拟验证（核心验收：证明守卫闭合"空洞通过"盲区）

**步骤**：将三样本文件 `mv` 到 scratchpad 临时目录（模拟 fresh clone / CI 下样本缺失），重跑目标测试文件。

**结果（移除样本后）**：

```
Test Files  1 failed (1)
     Tests  10 tests | 3 failed
 × ④ 内置忽略目录命中样本（build/Generated.java）不进入 skeleton map
   → expected false to be true // Object.is equality
 × ④ .gitignore 命中样本（generated/StubOnly.java）不进入 skeleton map
   → expected false to be true // Object.is equality
 × ④ Go 内置忽略目录（vendor/）与 .gitignore（generated/）样本均不进入 skeleton map
   → expected false to be true // Object.is equality
```

三条 ④ 用例**显式失败**在 `existsSync` 断言行（而非在原有的负向断言行悄悄空洞通过）—— 证明修复前该场景下用例会静默绿过（fix-report Why 5 描述的原始缺陷），修复后同一场景下用例会**显式红**，缺陷不可再隐身。① 号数量断言（Java/Go）仍绿，符合预期（此前提删除后目录内文件数天然减少，数量断言本身不受影响，验证目标专注于 ④ 号守卫）。

**还原后复测**：三样本 `mv` 回原位，重跑目标测试文件：

```
Test Files  1 passed (1)
     Tests  10 passed (10)
```

全绿恢复。`git status --short` 复核：仅剩预期 4 处改动（3 新样本 + 1 测试文件），无变异/模拟验证残留。

## 四、4a / 4b 结论汇总

| 阶段 | 结论 | CRITICAL | WARNING | INFO | 处置 |
|---|---|---|---|---|---|
| 4a Spec 合规审查 | PASS | 0 | 0 | 1（流程改进建议，非阻断） | 无需动作 |
| 4b 代码质量审查 | EXCELLENT | 0 | 0 | 2 | INFO 1（样本注释叙事）已修复并重跑目标测试 10/10 绿；INFO 2（Go 样本 `Noop() string` 与 vendor `Noop()` 签名差异）有意不修，理由已记 commit message，零锚定力影响 |

## 五、变异验证证据链复核

implement 阶段执行的两轮变异验证结论经复核逻辑自洽，还原状态已由本轮 `git status` 再次确认无残留：

- **变异 A**（注释 `ignore-oracle.ts:157` gitignoreCheck）：④ Java gitignore / ④ Go 联合 / ① Java(6≠5) / ① Go(5≠4) 转红，④ build 保持绿（防线独立性反证成立，符合两条排除路径互不依赖的设计预期）
- **变异 B**（废 `collector.ts:79` 剪枝 + oracle 目录段检查）：④ build / ① Java 转红，属于共用 `walkFiles` 的合理连带
- 两轮变异均 `git checkout` 还原，`diff` 为空

两轮变异验证共同证明：`.gitignore` 驱动排除路径与内置忽略目录驱动排除路径是两条独立防线，样本入库后均具备真实锚定力（而非空洞通过）。

## 六、Layer 2：原生工具链验证（全部本轮真实执行）

| 命令 | 退出码 | 关键结果 |
|---|---|---|
| `npx vitest run` | 0 | 516 个测试文件通过（4 skipped），6962 tests passed / 18 skipped / 21 todo，0 failed；耗时 102.28s；无 flaky 文件触发失败（watch-command / batch-orchestrator-incremental / community-analysis perf / cli-e2e --version 本轮均绿，未触发已知 flaky） |
| `npm run build` | 0 | `tsc` 类型检查零错误；postbuild 盖章 commit=68eb7e5f (dirty) |
| `npm run repo:check` | 0（status=warn，非阻断） | 79 项检查中 78 项 pass，1 项 warn：`graph-quality:freshness`（图产物 stale：sourceCommit 与当前 HEAD 不一致 + collector fingerprint 未记录）。此为**已知 pre-existing** 状态（图构建于更早的 HEAD，与本次 fix 改动的三个 fixture 样本 + 测试文件无关联，非本次改动引入的回归） |

## 七、最终判定

**PASS —— READY FOR REVIEW**

- 全部 4 处改动（3 新样本入库 + 1 测试文件加守卫）与 fix-report.md 影响范围扫描登记项一致，无 scope creep
- `git diff HEAD -- src/` 确认生产代码零改动（仅测试文件改动）
- 三样本仍被各自 `.gitignore` 规则命中，规则本体未被误改，证明入库通过 `-f` 强制而非移除规则
- Fresh-clone 模拟验证核心验收达成：移除样本后三条 ④ 用例显式失败（非空洞通过），还原后全绿恢复，无残留
- 两轮变异验证（implement 阶段）证据链自洽，独立防线锚定力证明成立，已完全还原
- 4a（PASS）/ 4b（EXCELLENT）审查结论确认，INFO 项处置合理
- 全量 `npx vitest run` / `npm run build` / `npm run repo:check` 三命令本轮真实执行零失败（repo:check 唯一 warn 为已知 pre-existing 图 staleness，非本次改动引入）

## 八、工具使用反馈（Dogfooding）

本次验证任务性质为测试基础设施 fix（fixture 入库 + 断言守卫），核心验证手段是 fresh-clone 模拟（mv 文件 + 重跑测试）与 git 原生命令（ls-files/check-ignore/diff/status），未使用 Spectra MCP 工具。原因：改动面明确且局限（3 fixture 文件 + 1 测试文件），无需 impact/context 等结构化代码库查询；Read 直接核对源码行号即可满足验证需求。无 MCP 可用性或结果准确性问题需反馈。
