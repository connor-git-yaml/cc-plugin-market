# 代码质量审查报告 — Feature 182 增量缓存正确性

> 审查模式: fix（工程质量维度，正确性证伪已由三轮 Codex 对抗审查覆盖）
> 审查时间: 2026-06-13
> 审查范围: src/core/skeleton-hash.ts（新建）、src/batch/regen-plan.ts、src/batch/delta-regenerator.ts、src/batch/module-grouper.ts、src/batch/batch-orchestrator.ts、src/core/single-spec-orchestrator.ts、src/panoramic/builders/doc-graph-builder.ts、src/generator/frontmatter.ts、src/models/module-spec.ts（新增字段）、tests/unit/skeleton-hash.test.ts（新建）、tests/integration/batch-incremental-cache.test.ts（新建）

---

## 六维度评估

| 维度 | 评级 | 关键发现 |
|------|------|---------|
| 架构合理性 | GOOD | skeleton-hash 放 src/core/ 中性层，batch→core 方向正确；buildSpecCacheKey 封装在 src/batch/ 不外泄；frontmatter 纯路径不变保证 panoramic 零改动，层次边界清晰 |
| 设计模式合理性 | GOOD | 纯函数 combineSkeletonHashes + wrapper computeModuleSkeletonHash 两层设计合理；upsertCompletedModule/recordFailedModule 抽 helper 避免 4 处重复逻辑，命名表意 |
| 安全性 | EXCELLENT | 无硬编码凭据；无 SQL/XSS；路径用 path.resolve/path.relative 规范处理；新增 `as any` 零处（既有 :981/:989 行的 `as any` 属存量，不属本 diff） |
| 性能 | GOOD | 写侧复用已有 skeletons 避免二次 analyzeFiles，符合计划；`collectCurrentSnapshots` 内 `await computeModuleSkeletonHash` 按顺序迭代（非并发），对大型仓库有潜在串行瓶颈，但此为存量架构约束，非本次引入 |
| 可读性 | GOOD | compareCodeUnit 函数 why 注释说明 localeCompare 跨机不可移植问题；combineSkeletonHashes JSDoc 详细；batch-orchestrator 内联注释以 "Feature 182：" 前缀标注改动点，上下文清晰；单行可稍简化（见 INFO 项） |
| 可维护性 | GOOD | 新增 API 均有 JSDoc 讲清存在理由；SkeletonHashEntry 接口有字段语义注释；plan v2.1「不修项」(a)(b) 在 fix-report.md 有明确记录但代码现场无对应 TODO 注释（属轻微缺失，不影响正确性） |

---

## 问题清单

| 严重程度 | 维度 | 位置 | 描述 | 修复建议 |
|---------|------|------|------|---------|
| WARNING | 可维护性 | `src/batch/batch-orchestrator.ts:2417 行` | batch-orchestrator.ts 已达 2417 行（plan.md 标注 2191 行，本次新增约 50 行），整体体量持续增大。本次改动合规（新增 <50 行不触发前置 cleanup 规则），但连续多版本增长趋势值得记录，下一个 Feature 触碰该文件时建议评估是否按处理流程分拆 helper 模块 | 登记为下一 Feature 触碰时的评估项，不在本次 fix 范围内修复 |
| WARNING | 可维护性 | `tests/integration/batch-incremental-cache.test.ts:174-177` | 场景 B 断言 `sourceTargetKey` 具体字面值（如 `'src/utils/service.ts::ts-js'`）依赖文件系统路径与 language ID 的合成细节。若 language ID 命名规则变更（如 `ts-js` → `typescript`），测试会静默失效而非明确报错 | 考虑通过 `readFrontmatterField(tsSpecPath, 'sourceTargetKey')` 结果与 `readFrontmatterField(tsSpecPath, 'sourceTarget')` + `'::ts-js'` 拼接对账，减少对具体 language ID 字符串的直接绑定；或在测试注释中标注 language ID 规则来源 |
| INFO | 可读性 | `src/core/skeleton-hash.ts:50-62` | `combineSkeletonHashes` 中 `.slice().sort(...)` 先复制再排序，避免修改入参——意图正确但未在注释中说明。两年后维护者可能觉得 `.slice()` 是多余的 | 在 sort 行前加一行短注释：`// 不修改入参 entries 的顺序` |
| INFO | 可读性 | `src/batch/delta-regenerator.ts:252` | `collectCurrentSnapshots` 中 `sourceFiles` 处理链 `.map(...).sort(...)` 是内联的，与 hash 计算逻辑处于同一 push 块内，密度略高 | 可提取为 `const normalizedSourceFiles = ...`（一行即可），提升块级可读性；当前可接受，不阻断提交 |
| INFO | 可维护性 | `src/batch/batch-orchestrator.ts`（约 :960-:975 块）| plan v2.1「不修项」(a) scanPyFiles 不解析 .gitignore、(b) delta propagation fallback 在代码现场无 TODO/FIXME 注释。非阻断问题，但两年后维护者不知道为何有这两个 gap | 在相关注入点（files 注入处）添加一行 `// TODO(F182-后续): scanPyFiles 不解析 .gitignore，见 plan.md §"不修项" (a)`，留有意为之的痕迹 |
| INFO | 测试质量 | `tests/unit/skeleton-hash.test.ts:102-113` | 场景 (d) 单文件 wrapper 测试调用了 `analyzeFiles` 对同一文件做两次分析（wrapper 内一次 + 测试内直接调一次），在 CI 中不是问题，但在极慢文件系统上可感知延迟。属测试设计合理性轻微疑问，无需修改 | 已知，可接受；无需改动 |

---

## 累积劣化检测（维度 1.5）

| 文件 | 当前行数 | 状态 |
|------|---------|------|
| `src/batch/batch-orchestrator.ts` | 2417 行 | WARNING（原 2191，增长 226 行；总量已过 500 但本次增量 <50，不触发 CRITICAL 阻断规则） |
| `src/core/single-spec-orchestrator.ts` | 1290 行 | 正常（含本次约 50 行增加） |
| `src/batch/delta-regenerator.ts` | 372 行 | 正常 |
| `src/batch/regen-plan.ts` | 143 行 | 正常 |
| `src/core/skeleton-hash.ts` | 95 行（新建）| 正常 |

---

## 跨模块一致性检查（维度 1.7）

- import 路径：`skeleton-hash.js`（ESM .js 后缀）在 delta-regenerator.ts 和 skeleton-hash.test.ts 均一致
- `sourceTargetKey ?? sourceTarget` 回落模式在 batch-orchestrator.ts(:520)、delta-regenerator.ts(:268) 两处一致
- SkeletonHashEntry 类型在 skeleton-hash.ts 导出，single-spec-orchestrator.ts 正确 import 使用，无重复定义
- `languageSplit` 字段在 module-grouper.ts 设置、regen-plan.ts buildSpecCacheKey 读取、batch-orchestrator.ts 传 outputFileName/sourceTargetKey — 三处口径一致

---

## 类型质量专项

| 检查项 | 结论 |
|--------|------|
| `combineSkeletonHashes` 返回 `string`（非 undefined）| 正确：entries.length===1 分支直接 return，多文件 sha256 始终有值；调用方无需额外判空 |
| `computeModuleSkeletonHash` 返回 `Promise<string \| undefined>` | 正确：空文件集 / analyzeFiles 全失败时返回 undefined，调用方在 delta 对比前有 `!snapshot.currentHash` 守卫 |
| `GenerateSpecOptions.files?: string[]` | 可选，向后兼容 CLI 路径；类型为绝对路径数组，JSDoc 已标注 |
| `GenerateSpecOptions.outputFileName?: string` | 可选，JSDoc 说明含后缀的纯文件名；无长度/格式约束（轻微，可接受） |
| `GenerateSpecOptions.sourceTargetKey?: string` | 可选，JSDoc 说明语义；透传至 FrontmatterInput 类型链一致 |
| `StoredModuleSpecSummary.sourceTargetKey?: string` | 在 Zod schema（module-spec.ts:111）和 TypeScript interface（doc-graph-builder.ts）均正确声明为 optional |
| 新增 `as any` | 零处；既有 batch-orchestrator.ts:981/989 的 `as any` 属存量，非本次引入 |

---

## 测试质量专项

| 检查项 | 结论 |
|--------|------|
| 单元测试恒真断言 | 无；(b) 场景同时断言 `toBe(expectedCodeUnit)` 和 `not.toBe(localeCompareResult)`，双向验证 |
| 脆断言（依赖实现细节）| E2E 场景 B/C 对 `sourceTargetKey` 字面值的断言（见 WARNING 项）有一定实现绑定，但可追溯 |
| 伪 mock 结构 | 已修正：仅 mock `callLLM` 而非整个 `generateSpec`，写侧链路真实执行 |
| 共享可变状态 | 无；beforeEach 创建独立 tmpdir，afterEach 清理 |
| async/await 使用 | 全部测试函数用 async/await，无 done callback |
| 测试规范 `any` | 测试中无裸 `any`；`vi.hoisted` 返回类型可由 TS 推断，合规 |
| `computeHashFor` 私有复刻删除 | 已删，替换为 import `computeModuleSkeletonHash`，假绿根因消除 |

---

## 总体质量评级

**GOOD**

评级依据:
- CRITICAL: 0 个
- WARNING: 2 个（batch-orchestrator 体量增长趋势 + E2E 场景字面值绑定）
- INFO: 4 个（均为可读性/可维护性轻微改进建议，无功能影响）

零 CRITICAL，2 个 WARNING 均为轻量的长期可维护性建议，不阻断本次提交。代码整体设计清晰，关键改动点有充分 why 注释，新增 API 类型约束完整，测试结构修复了原假绿根因。

---

## 问题分级汇总

- CRITICAL: 0 个
- WARNING: 2 个
- INFO: 4 个
