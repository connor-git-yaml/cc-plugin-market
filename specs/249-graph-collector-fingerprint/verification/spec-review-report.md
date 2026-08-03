# F249 Spec 合规审查报告（Phase 5a）

> 产出者：spec-driver:spec-review 子代理（sonnet），2026-08-03。该代理运行环境无 Write 工具，
> 应其明示请求由编排器逐字誊写落盘；内容为其原文，编排器未作实质修改。
> **时点说明**：本审查基于 Codex 实现审查修复轮（F1-F10）之前的实现状态；其中标记的
> 三项收尾缺口（verification/ 目录、T052-55 checkbox、FR-014 留痕）已在后续 verify 阶段
> 处置，见 verification-report.md。

## 逐条 FR 状态

| FR | 描述 | 状态 | 证据 |
|----|------|------|------|
| FR-001 | 三分量结构 fingerprint | 已实现 | `src/panoramic/graph/collector-fingerprint.ts:51-57` `CollectorFingerprint` 接口精确匹配（formatVersion/extensionSurface/behaviorVersion） |
| FR-002 | extensionSurface 按管线记录 + #4/#5/#6 引用收敛 | 已实现 | `src/collector-surface.ts` 五常量+`ALL_PRODUCER_SURFACES`；`ignore-oracle.ts:33-36,137-138`、`cache-key-builder.ts:19,42` 均引用 SSoT，非镜像硬编码 |
| FR-003 | dirty 判定按管线谓词分别应用 | 已实现 | `source-commit.ts:65-68` `isDirtyJudgedSourceFile` 遍历 `DIRTY_SOURCE_SURFACES` 逐管线按自身 `matchSemantics` 判定 |
| FR-004 | behaviorVersion 常量 + 结构化 bump 责任清单 | 已实现 | `collector-fingerprint.ts:76,85-115` `BEHAVIOR_VERSION_BUMP_RESPONSIBILITIES` 六类条件齐全，测试覆盖 SC-016 |
| FR-005 | 双轨重建-对比护栏 (a)-(e) | 已实现 | `scripts/regen-collector-fingerprint-fixtures.ts` 完整实现 fixture/双 pinned 资产/双轨比较器/二元拒绝判据/备份回滚写盘；`tests/integration/collector-fingerprint-regen-script.test.ts` 覆盖三分拒绝场景 + fixture 基线变更文案分流 |
| FR-006 | 两写入点共用同一指纹 + moduleDerivationScan 仅 full 消费 | 已实现 | `batch-orchestrator.ts:1507`、`graph-assembly.ts:262` 均调用 `computeCollectorFingerprint()`；T032 spy 回归测试锁定 `buildAstGraphOnly` 全程不调用 `buildModuleGraphForProject`（`tests/batch/graph-only-pipeline.test.ts:44-59`） |
| FR-007 | `spectra graph` 写 null | 已实现 | `src/cli/commands/graph.ts:201-203`：`graphJson.graph.fingerprint = null` |
| FR-008 | 公共导出 | 已实现 | `collector-fingerprint.ts` 经 `panoramic/graph/index.ts` barrel re-export（对应 T016） |
| FR-009 | 五级优先级 + staleReasons + schema 升级 | 已实现 | `source-commit.ts:188-244` `evaluateFreshness` 判定顺序与 FR-009 逐字对应；`graph-quality-report.schema.json:209-221` 已新增 `staleReasons` enum 四值 |
| FR-010 | fingerprint 缺失 → stale unrecorded，fail-closed | 已实现 | `source-commit.ts:157-159`：`null`/`undefined` 均归 `collector-fingerprint-unrecorded`，MUST NOT fresh |
| FR-011 | CLI 告警级别不低于 sourceCommit | 已实现 | `graph-quality.ts:186-195` `computeOverallVerdict`：任何 `stale`（无论原因）统一映射 `pass-with-warnings`；`describeStaleReason` 四类文案措辞对等 |
| FR-012 | repo:check 第12族 warn | 已实现 | `graph-quality-core.mjs:265-276`：stale → warn，文案+evidence 均含 `staleReasons` |
| FR-013 | reason-aware 四消费面 | 已实现 | CLI 文本/`--json`、repo:check、bootstrap-status 均已改造 |
| FR-014 | #9/#10 显式排除范围未越界 | 部分可验证（见偏差 1） | 静态检查两文件均无相关符号引用；T055 的 git diff 校验当时未执行留痕，且任务卡路径 `src/watch/file-watcher.ts` 有误（实际 `src/watcher/file-watcher.ts`） |
| FR-015 | YAGNI 移除：自动重建 | 合规 | 未见任何自动触发重建逻辑，仅产出诊断信号 |
| FR-016 | YAGNI 移除：多版本兼容解析 | 合规 | 非 `formatVersion===1` 一律判 invalid，无兼容解析分支 |
| FR-017 | 确定性序列化 | 已实现 | 排序构造（非 localeCompare）；canonical 深比较；跨进程 spawn byte-identical 断言（SC-014） |
| FR-018 | 畸形指纹 invalid | 已实现 | `isValidCollectorFingerprint` 全 try/catch、逐层结构校验，else-if 链与 unrecorded 互斥 |
| FR-019 | 零依赖叶子模块 | 已实现 | `src/collector-surface.ts` 顶层零 import；ts-morph 静态解析验证 SC-015 |

## 逐条关键 SC 抽查

| SC | 状态 | 证据 |
|----|------|------|
| SC-005（双重 oracle） | 已实现 | a1（`===`）+ a2（AST import + 无本地字面量重声明）+ b（行为探针逐管线钉死入口与 oracle），三层齐全 |
| SC-010（三件套） | 已实现 | 比较器灵敏度扰动注入 + 真实重建绿路径 + 拒绝真值表；脚本级三分拒绝场景 |
| SC-014（跨进程确定性） | 已实现 | spawn 独立 node 子进程 byte-identical 对比 |
| SC-017/SC-018 | 已实现 | `graph-quality-cli.test.ts:536-585` 覆盖 schemaVersion=1.0 双边界回归 + fingerprint 各状态组合下不改判 |

## 总体合规率

**19/19 FR 已实现或合规判定**（FR-014 为"部分可验证"；FR-015/016 为 YAGNI 移除合规）。
合规率：18/19 完全落地 + 1/19 部分可验证 ≈ 97%。无 FR 判定为未实现或过度实现。

## 偏差清单

1. **FR-014 / T055（WARNING）**：越权检查未执行留痕 + 任务卡路径 typo（`src/watch/` 应为 `src/watcher/`）——需用正确路径重验并留痕。
2. **T052–T055（WARNING）**：checkbox 未回写，与实质完成度（graph.json 已含 fingerprint）不一致——需核实后回写。
3. **T055 / SC-006（CRITICAL·流程收尾）**：`verification/` 目录当时不存在，SC-006 人工审查记录无持久化落点——需创建并写入。

## 过度实现检测

未发现 spec 未定义的额外公共 API / 配置项 / 用户可见行为；`--init` 参数判定为合理实施细节（tasks 已记账授权）。

## 总体结论：PASS（有条件）

核心机制实现质量高、与 spec 字面高度吻合（判定优先级、fail-closed、双轨三件套、canonical 比较、零依赖叶子静态验证均逐字核实）。条件 = 补齐 Phase 5 Closure 的流程收尾（上述三项偏差），由 verify 阶段处置。
