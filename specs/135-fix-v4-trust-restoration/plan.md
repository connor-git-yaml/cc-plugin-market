---
feature: 135-fix-v4-trust-restoration
type: fix-plan
status: ready
version: v1
created: 2026-04-27
---

# 修复规划 — Feature 135：Spectra v4.0.1 信任修复

## 1. 概述

本次修复针对 v4.0.0 实测中发现的 4 类 bug，全部采用"临时治理"策略：
禁用错误默认行为 + 补全 WARNING 可观测性 + 修正文档和字符串。
不做任何架构改动，所有架构重构留给 Feature 136（v4.1）。

---

## 2. Codebase Reality Check

### 目标文件现状

| 文件 | 估计 LOC | 关键公开接口 | 已知 debt |
|------|---------|------------|---------|
| `src/panoramic/batch-project-docs.ts` | ~460 | `generateBatchProjectDocs`, `BatchProjectDocsOptions`, `generateDocsQualityReport` | 无需前置清理 |
| `src/batch/batch-orchestrator.ts` | ~1300 | `runBatch`, `BatchOptions` | 超 500 行，本次仅改 ~10 行，变更密度低，无需前置清理 |
| `src/generator/frontmatter.ts` | ~100 | `generateFrontmatter`, `FrontmatterInput` | 无 |
| `src/generator/index-generator.ts` | ~200 | `generateIndex` | 无 |
| `src/spec-store/spec-store.ts` | ~150 | `SpecStore` | 无 |
| `src/cli/index.ts` | ~200 | `main` | 无 |
| `src/cli/commands/batch.ts` | ~120 | `runBatchCommand` | 无 |
| `CHANGELOG.md` | ~400 | — | 无 |
| `scripts/check-plugin-sync.sh` | ~80 | — | 无 |

**结论**：无需前置 cleanup task，所有目标文件均可直接修复。

---

## 3. Impact Assessment

| 维度 | 评估 |
|------|------|
| 直接修改文件数 | 9 个（含测试和 CI 脚本） |
| 跨包影响 | 无（全部在 `src/` 内部，测试在 `tests/` 内部） |
| 数据迁移 | 无 |
| API/契约变更 | `BatchProjectDocsOptions` 新增可选字段 `enableAdr?: boolean`（向后兼容，默认 false） |
| CLI flag 新增 | `--enable-adr`（新增，不影响现有用法） |

**风险等级：LOW**（影响文件 < 10，无跨包影响，无 schema 变更）

---

## 4. 修复顺序与依赖关系

```
Bug 3（version string）           ← 无依赖，最独立，先做
        ↓
Bug 1（ADR disable）              ← 依赖 batch.ts 了解 CLI flag 模式
        ↓
Bug 2（hyperedges WARNING）       ← 与 Bug 1 共享 batch-orchestrator.ts 改动，串行更安全
        ↓
Bug 4（reading mode 文档）        ← 最后做，纯文档/help 改动，回归风险最低
        ↓
测试与验收                         ← 最后统一补测试 + CHANGELOG
```

**优先顺序依据**：
- Bug 3 完全独立，三处改同一函数，最适合热身
- Bug 1 需新增 `BatchProjectDocsOptions.enableAdr` + CLI flag，涉及接口变更，先确认再让 Bug 2 参照
- Bug 2 改 `batch-orchestrator.ts`，与 Bug 1 无文件交叉但逻辑相关，前置完成 Bug 1 接口后再做
- Bug 4 纯字符串改动，风险最低，放最后不影响其他测试

---

## 5. 各 Bug 变更文件清单

### Bug 1 — ADR Pipeline Hallucination（默认禁用）

| 文件 | 变更类型 | 具体位置 | 变更说明 |
|------|---------|---------|---------|
| `src/panoramic/batch-project-docs.ts` | 修改类型 + 逻辑 | L55 附近 `BatchProjectDocsOptions` 类型 | 新增 `enableAdr?: boolean` 字段 |
| `src/panoramic/batch-project-docs.ts` | 修改逻辑 | L338 `generateBatchAdrDocs` 调用处 | 包裹 `if (options.enableAdr)` guard，默认跳过 |
| `src/panoramic/batch-project-docs.ts` | 修改逻辑 | ADR skip 路径 | 添加 `logger.warn` 提示 ADR 已临时禁用 |
| `src/cli/commands/batch.ts` | 修改 CLI 参数解析 | `runBatchCommand` 中 `runBatch` 调用 | 传递 `enableAdr: command.enableAdr ?? false` |
| `src/cli/commands/batch.ts` | 修改输出提示 | batch 结果打印块末尾 | 当 `!enableAdr` 时打印 hint 提示用 `--enable-adr` 显式开启 |
| `src/cli/index.ts` | 修改 help 文字 | L98 附近 `--hyperedges` 帮助行之后 | 新增 `--enable-adr` flag 的帮助说明 |

> 注意：`CLICommand` 类型（`src/cli/utils/parse-args.ts`）需同步新增 `enableAdr?: boolean` 字段，以及 arg 解析逻辑。实际改动文件取决于该文件的 arg 解析实现，任务中单独列出。

### Bug 2 — `--hyperedges` Flag 静默无效（补 WARNING）

| 文件 | 变更类型 | 具体位置 | 变更说明 |
|------|---------|---------|---------|
| `src/batch/batch-orchestrator.ts` | 修改日志级别 | L994-1000 `!semanticIntegrationAllowed` 分支 | `logger.info` → `logger.warn`，同时向 stderr 打印可见 WARNING |
| `src/batch/batch-orchestrator.ts` | 新增条件判断 | L1037-1043 `hyperedgesOptIn` 为 true 但 `designDocAbsPaths.length === 0` 时 | 新增 WARNING：前置条件未满足 + 修复建议 |
| `src/batch/batch-orchestrator.ts` | 修改 summary 打印 | batch 末尾结果汇总输出 | 新增 `hyperedge 状态` 行（0 条 + WARNING 原因 或 N 条） |

### Bug 3 — `generatedBy: spectra v3.0` 版本字符串回归（共 4 个文件）

| 文件 | 变更类型 | 具体位置 | 变更说明 |
|------|---------|---------|---------|
| `src/generator/frontmatter.ts` | 新增辅助函数 + 修改 | L60 `generatedBy: 'spectra v3.0'` | 新增 `getSpectraVersionString()` 函数，用 `createRequire` 读 package.json.version；本文件内替换为调用 |
| `src/generator/index-generator.ts` | 修改 | L139 `generatedBy: 'spectra v3.0'` | 改为调用 `getSpectraVersionString()` |
| `src/spec-store/spec-store.ts` | 修改 | L80 `generatedBy: 'spectra v3.0'` | 改为调用 `getSpectraVersionString()` |
| `scripts/check-plugin-sync.sh` | 新增检查规则 | 末尾 | 添加 hardcoded version string grep 检查（`grep -rn "spectra v[0-9]" src/` 发现硬编码即 exit 1） |

### Bug 4 — Reading Mode 文档误导（纯文字改动）

| 文件 | 变更类型 | 具体位置 | 变更说明 |
|------|---------|---------|---------|
| `src/cli/index.ts` | 修改 help 文字 | L97 `--mode` 行 | 明确三档差异：full（完整，含 LLM 推断）、reading（省约 38% 时间，模块级 LLM 仍运行）、code-only（纯 AST < 30s，无 LLM）；并指向 code-only |
| `src/cli/commands/batch.ts` | 新增运行时提示 | mode 解析后 | 当 `mode === 'reading'` 且 `process.stdout.isTTY` 时打印 hint |
| `CHANGELOG.md` | 新增版本节 | 文件顶部 | 新增 v4.0.1 节，列出 4 项修复 |

---

## 6. 回归风险评估

### 修改 `BatchProjectDocsOptions` 新增可选字段（Bug 1）

**风险**：低。字段为可选 `enableAdr?: boolean`，默认 false，所有未传该字段的现有调用方行为与加 guard 后一致（均不生成 ADR）。

**潜在问题**：若测试中有 mock 断言 `generateBatchAdrDocs` 一定被调用，需要同步更新 test 期望值。

### 修改日志级别 `info` → `warn`（Bug 2）

**风险**：极低。仅日志级别变更，不影响数据流。若测试 spy 日志输出，需更新断言。

### `getSpectraVersionString()` 读 package.json（Bug 3）

**风险**：低。需确认 `createRequire(import.meta.url)` 在 ESM 构建目标下可正确解析 package.json 路径（项目已有此模式，参考其他使用 createRequire 的文件）。若项目不在 Node.js ESM 模式，可改用 `fs.readFileSync` + `JSON.parse`。

**回归点**：三处调用替换后，若 package.json 路径解析失败会让版本字段变为 `spectra vundefined`——需要在辅助函数中加 fallback 保护。

### Help 文字修改（Bug 4）

**风险**：极低。纯字符串修改，无逻辑变更。若有测试 snapshot 测试 help 输出，需更新 snapshot。

---

## 7. 验证方案

### Bug 1 验证

1. `npx spectra batch ./test-project` （不带 `--enable-adr`）→ 观察 batch summary 中无 `adr-pipeline`，且末尾打印 ADR 禁用 hint
2. `npx spectra batch ./test-project --enable-adr` → 观察 `adr-pipeline` 重新出现在 summary 中
3. 单元测试：`runBatch` 不传 `enableAdr` 时 `generateBatchAdrDocs` 未被调用

### Bug 2 验证

1. 新项目（无 project docs）执行 `npx spectra batch . --hyperedges` → stderr 应出现 WARNING，说明前置条件未满足
2. batch summary 末尾出现 `hyperedge 状态: 0（WARNING: 前置条件未满足）`
3. 旧项目（已有 project docs，mode=full）执行 `--hyperedges` → 正常运行，无 WARNING

### Bug 3 验证

1. 生成一个新 spec，检查 frontmatter 中 `generatedBy` 字段等于当前 `package.json.version`（如 `spectra v4.0.1`）
2. 单元测试：`generateFrontmatter(...)` 输出的 `generatedBy` = `` `spectra v${pkg.version}` ``
3. `npm run release:check` 通过，新的 grep 规则不报告 hardcoded string

### Bug 4 验证

1. `npx spectra batch --help` → 观察 `--mode` 行含有三档时间预估信息
2. `npx spectra batch ./project --mode reading` → stderr / stdout 输出 reading 模式 hint
3. CHANGELOG.md 含 v4.0.1 节并列出 4 项修复

---

## 8. Constitution Check

| 原则 | 适用性 | 评估 | 说明 |
|------|-------|------|------|
| I. 双语文档规范 | 适用 | PASS | plan/tasks 中文散文，代码标识符英文 |
| II. Spec-Driven Development | 适用 | PASS | 通过 spec-driver 流程执行 |
| III. YAGNI | 适用 | PASS | 仅加 guard + WARNING + 字符串替换，无新抽象；`getSpectraVersionString` 是消除重复的最小提取 |
| IV. 诚实标注不确定性 | 适用 | PASS | `createRequire` 路径解析风险已标注 |
| V. AST 精确性优先 | 不适用 | N/A | 本次修复不涉及 AST 分析路径 |
| VII. 只读安全性 | 不适用 | N/A | 不修改 spectra 分析工具的只读保证 |
| VIII. 纯 Node.js 生态 | 适用 | PASS | `createRequire` 是 Node.js 内置 API |
| XIII. 向后兼容 | 适用 | PASS | `enableAdr` 默认 false，现有调用方行为不变 |
| XIV. 可观测性 | 适用 | PASS | Bug 2 补全 WARNING 正是落实此原则 |

---

## 9. 不在本次修复范围内（留 Feature 136）

- `buildGenericCoreSeparationCandidate` 内部 evidence-binding 重构
- hyperedge 数据流从 extractionResults 解耦
- context budget 动态裁剪策略
- ADR 跨项目隔离测试补全
- reading mode 真实时间基准测试（需真实项目数据）
