---
feature: 091-sync-deterministic-merge
title: sync 合并算法确定性化 — 技术规划
branch: claude/agitated-hamilton
created: 2026-04-06
status: Draft
research_mode: tech-only
---

# Feature 091: sync 合并算法确定性化 — 技术规划

## 1. 技术上下文

### 1.1 当前状态

sync 子代理（`agents/sync.md`，约 8,800 bytes）承担了从 spec 扫描、产品映射、时间线排序、增量合并、冲突解决到验证的全部逻辑。其中约 4,100 bytes 的确定性操作（排序、匹配、差集、格式校验）由 LLM 执行，导致结果不可复现。

### 1.2 目标状态

采用 **Plan-then-Execute** 模式（LangGraph 风格），将确定性操作提取为 `sync-merge-engine.mjs` + 5 个 `scripts/lib/sync-*.mjs` 纯函数模块。Agent Prompt 瘦身至 <5,000 bytes，仅保留语义决策层。

### 1.3 技术选型

| 决策 | 选择 | 理由 | 替代方案 |
|------|------|------|---------|
| 架构方案 | 方案 A：全量提取 | 一步到位，避免多次 Prompt 迭代；与现有脚本风格一致 | 方案 B 渐进提取（周期长）、方案 C 纯 Prompt 瘦身（不满足目标） |
| 分工模式 | LangGraph Plan-then-Execute | Agent 决策 -> 脚本执行，接口清晰 | Aider 编辑指令模式（过于底层） |
| dry-run 输出 | 混合格式（Terraform plan 风格） | 兼顾人类可读和机器消费 | 纯 diff（不适用）、纯 JSON（不直观） |
| 解析策略 | 轻量 section parser（H2 分割） | 宽松容错，零依赖 | unified.js AST（违反宪法原则 X） |
| 接口格式 | JSON + schemaVersion | 防止接口漂移，支持降级 | YAML（解析器已有但 JSON 更适合 stdout 通信） |

### 1.4 宪法合规性

| 原则 | 合规说明 |
|------|---------|
| III YAGNI | 只提取当前 sync.md 已有的确定性操作，不扩展功能 |
| IV 诚实标注 | 脚本无法判定的操作留给 Agent，不强行确定性化 |
| X 零运行时依赖 | 脚本仅用 Node.js 内置模块，零 npm 依赖 |
| XIII 向后兼容 | 降级路径确保脚本不可用时 sync 流程不中断 |
| XIV 可观测性 | JSON 输出含 schemaVersion + warnings + stats |

---

## 2. sync.md 逐段分离策略

### 2.1 分离决策矩阵

| Section | 当前内容 | 字节数 | 分离决策 | 目标归属 | 理由 |
|---------|---------|--------|---------|---------|------|
| 1 扫描功能目录 | 遍历 specs/ 匹配 NNN-* 目录 | ~300 | 提取到脚本 | `sync-merge-engine.mjs` 入口 | 纯文件系统操作，完全确定性 |
| 2.1 显式映射 | 读取 product-mapping.yaml | ~800 | 提取到脚本 | `sync-product-mapping.mjs` | YAML 解析 + 数据加载，确定性 |
| 2.2 内容分析推断 | 分析标题/User Stories 推断归属 | ~600 | **保留给 Agent** | 瘦身后 sync.md | 需要 LLM 理解自然语言内容 |
| 2.3 产品名修正 | 已知旧名映射为新名 | ~500 | 提取到脚本 | `sync-product-mapping.mjs` | 规则表驱动，完全确定性 |
| 2.4 未映射 spec 检测 | 差集计算 + 自动发现 | ~500 | 提取到脚本 | `sync-product-mapping.mjs` | 集合差集运算，确定性 |
| 2.5 生成/更新映射 | 写入 product-mapping.yaml | ~200 | 提取到脚本 | `sync-product-mapping.mjs` | 文件写入，确定性 |
| 3a 构建时间线 | 按编号排序 + 类型标记 | ~400 | 提取到脚本 | `sync-timeline-builder.mjs` | 排序 + 正则匹配，确定性 |
| 3b 增量合并策略 | 按类型的确定性合并规则 | ~800 | 提取到脚本 | `sync-merge-strategy.mjs` | 规则固定，不需语义判断 |
| 3c 冲突解决 | 编号更大优先 | ~300 | 提取到脚本 | `sync-conflict-resolver.mjs` | 数值比较，完全确定性 |
| 4 (14 章生成) | 14 章结构的语义融合 | ~2,500 | **保留给 Agent** | 瘦身后 sync.md | 需要 LLM 综合推理和内容提炼 |
| 5 验证 | 功能数量、矛盾检测、结构校验 | ~400 | 提取到脚本 | `sync-validator.mjs` | 阈值检查和格式校验，确定性 |
| 信息推断规则表 | 推断来源 -> 推断方法映射 | ~1,200 | **保留给 Agent** | 瘦身后 sync.md | LLM 按规则执行语义推断 |
| 内容质量标准表 | 章节最低要求 + 容错策略 | ~800 | 部分提取 | 阈值部分入脚本，内容质量留 Agent | 数值阈值确定性，内容质量需语义判断 |

### 2.2 分离后字节预算

| 组件 | 预计字节数 | 占比 |
|------|-----------|------|
| 瘦身后 sync.md（Agent 语义层） | ~4,700 bytes | — |
| sync-merge-engine.mjs + 5 个 lib 模块 | ~1,500-2,000 行 MJS | — |

**结论**：从 ~8,800 bytes 缩至 ~4,700 bytes，满足 <5,000 bytes 目标。

---

## 3. 模块接口设计

### 3.1 模块总览

```
scripts/
  sync-merge-engine.mjs              # CLI 入口，编排所有 lib 模块
  lib/
    sync-product-mapping.mjs         # 产品映射：读写、修正、差集
    sync-timeline-builder.mjs        # 时间线：排序 + 类型标记
    sync-merge-strategy.mjs          # 合并策略：按类型增量合并
    sync-conflict-resolver.mjs       # 冲突解决：编号更大优先
    sync-validator.mjs               # 验证：数量/矛盾/结构检查
```

### 3.2 各模块职责与导出函数

**详见 `data-model.md` 的完整 JSDoc 接口定义。**

#### sync-product-mapping.mjs

| 导出函数 | 输入 | 输出 | 职责 |
|---------|------|------|------|
| `parseProductMapping(yamlContent)` | YAML 字符串 | `ProductMapping` 对象 | 解析 product-mapping.yaml |
| `correctProductNames(mapping, rules)` | 映射 + 修正规则 | 修正后的 `ProductMapping` | 旧名 -> 新名自动修正 |
| `detectUnmappedSpecs(mapping, scannedSpecs)` | 映射 + 扫描到的 spec 列表 | `UnmappedSpec[]` | 差集计算 |
| `mergeUnmappedSpecs(mapping, unmappedSpecs, agentDecisions)` | 映射 + 未映射列表 + Agent 归属决策 | 更新后的 `ProductMapping` | 合并 Agent 推断结果 |
| `serializeProductMapping(mapping)` | `ProductMapping` 对象 | YAML 字符串 | 序列化回 YAML |

#### sync-timeline-builder.mjs

| 导出函数 | 输入 | 输出 | 职责 |
|---------|------|------|------|
| `buildTimeline(specEntries)` | `SpecEntry[]` | `Timeline` | 按编号排序 + 类型标记 |
| `classifySpecType(specEntry)` | 单个 `SpecEntry` | `SpecType` 枚举值 | 判定 spec 类型 |

#### sync-merge-strategy.mjs

| 导出函数 | 输入 | 输出 | 职责 |
|---------|------|------|------|
| `executeMerge(timeline)` | `Timeline` | `MergeSkeleton` | 按类型规则执行增量合并 |

#### sync-conflict-resolver.mjs

| 导出函数 | 输入 | 输出 | 职责 |
|---------|------|------|------|
| `resolveConflicts(skeleton)` | `MergeSkeleton` | `{ skeleton, conflicts }` | 冲突检测 + 编号更大优先 |

#### sync-validator.mjs

| 导出函数 | 输入 | 输出 | 职责 |
|---------|------|------|------|
| `validateMergeResult(skeleton, timeline)` | 骨架 + 时间线 | `ValidationReport` | 三项验证检查 |

---

## 4. sync-merge-engine.mjs 执行流水线

### 4.1 完整流程

```
CLI 解析
  │
  ▼
[Phase 1] 扫描 specs/ 目录
  │  输入: projectRoot
  │  输出: scannedSpecs[]（编号、目录名、spec.md 摘要）
  │
  ▼
[Phase 2] 加载产品映射
  │  输入: product-mapping.yaml 路径
  │  输出: ProductMapping 对象
  │  容错: 文件不存在 → 返回空映射 + 警告
  │
  ▼
[Phase 3] 产品名修正
  │  输入: ProductMapping + NAME_CORRECTION_RULES
  │  输出: 修正后的 ProductMapping
  │
  ▼
[Phase 4] 差集检测
  │  输入: ProductMapping + scannedSpecs
  │  输出: unmappedSpecs[]
  │
  ▼
[Phase 5] 逐产品处理
  │  对每个产品:
  │    ├─ buildTimeline(productSpecs) → Timeline
  │    ├─ executeMerge(timeline) → MergeSkeleton
  │    ├─ resolveConflicts(skeleton) → { skeleton, conflicts }
  │    └─ validateMergeResult(skeleton, timeline) → ValidationReport
  │
  ▼
[Phase 6] 组装输出
  │  输入: 所有产品的处理结果
  │  输出: MergeEngineOutput JSON
  │
  ▼
[Phase 7] 写入（非 dry-run 模式）
  │  仅写入: product-mapping.yaml（差集更新）
  │  不写入: current-spec.md（由 Agent 根据 JSON + 语义融合后写入）
  │
  ▼
stdout JSON 输出
```

### 4.2 CLI 参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--project-root <path>` | string | `process.cwd()` | 项目根目录 |
| `--dry-run` | boolean | `false` | 不修改文件，仅预览 |
| `--json` | boolean | `false` | JSON 格式输出（非 dry-run 时也有效） |

### 4.3 入口脚本骨架

遵循现有 `generate-product-entity-catalog.mjs` 的双入口模式：

```javascript
#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// lib 模块导入
import { parseProductMapping, correctProductNames, detectUnmappedSpecs, serializeProductMapping } from './lib/sync-product-mapping.mjs';
import { buildTimeline } from './lib/sync-timeline-builder.mjs';
import { executeMerge } from './lib/sync-merge-strategy.mjs';
import { resolveConflicts } from './lib/sync-conflict-resolver.mjs';
import { validateMergeResult } from './lib/sync-validator.mjs';

// 复用现有 helper
import { getProductsRoot } from './lib/product-artifact-paths.mjs';
import { writeYamlArtifact } from './lib/script-report-io.mjs';
import { parseYamlDocument } from './lib/simple-yaml.mjs';

function parseArgs(argv) {
  const args = { projectRoot: process.cwd(), dryRun: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--dry-run') { args.dryRun = true; continue; }
    if (token === '--json') { args.json = true; continue; }
    if (token === '--project-root') { args.projectRoot = argv[index + 1] ?? args.projectRoot; index += 1; }
  }
  args.projectRoot = path.resolve(args.projectRoot);
  return args;
}

export function syncMergeEngine(options = {}) { /* 主逻辑 */ }

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const result = syncMergeEngine(args);
  printResult(result, args);
}
```

### 4.4 错误处理策略

| 场景 | 处理方式 | 退出码 |
|------|---------|--------|
| `--project-root` 指向不存在的路径 | 输出 `{ "error": "...", "code": "INVALID_PROJECT_ROOT" }` | 1 |
| `specs/` 目录不存在 | 输出 `{ "error": "...", "code": "NO_SPECS_DIR" }` | 1 |
| `product-mapping.yaml` 不存在 | 返回空映射，warnings 中记录 | 0 |
| spec.md 解析失败（Markdown 格式异常） | 返回 raw text 摘要，warnings 中记录 | 0 |
| spec.md 缺少标题行或 YAML Front Matter | 宽松解析，返回可用字段 | 0 |
| 编号重复的 spec（不同目录名） | 按目录名字母序排列，warnings 中记录 | 0 |

---

## 5. 瘦身后 sync.md 骨架设计

### 5.1 目标约束

- 总大小 <5,000 bytes（目标约 4,500-4,700 bytes）
- 只保留 LLM 强项的语义决策
- 包含脚本调用方式和 JSON 消费指令
- 包含降级路径（约 500 bytes）

### 5.2 骨架结构

```markdown
# 产品规范聚合子代理

## 角色
（精简版角色描述，约 200 bytes）

## 输入
（输入说明，约 200 bytes）

## 工具权限
（与当前一致，约 100 bytes）

## 执行流程

### Step 1: 调用合并引擎
（约 400 bytes）
- 调用脚本命令
- 解析 JSON 输出
- schemaVersion 兼容性检查

### Step 2: 补充语义决策
（约 600 bytes）
- 消费 unmappedSpecs，通过内容分析推断归属
- 将归属决策传回脚本（或直接更新 mapping）

### Step 3: 语义融合生成 current-spec.md
（约 1,200 bytes）
- 基于脚本返回的 MergeSkeleton 骨架
- 按 14 章模板执行语义填充
- 每章的语义融合要点（精简版）

### Step 4: 验证与输出
（约 300 bytes）

## 信息推断规则
（约 800 bytes — 此表保留完整，是 Agent 语义融合的核心指导）

## 降级路径
（约 500 bytes）
- 脚本不存在或执行失败时的简化合并规则
- 降级标记格式

## 输出
（约 200 bytes）

## 约束
（约 200 bytes）
```

### 5.3 降级路径设计

```markdown
## 降级路径

当合并引擎不可用时（脚本文件缺失或执行返回非零退出码），
按以下简化规则执行 LLM 全量合并：

1. 扫描 specs/ 目录，按编号排序
2. 如有 product-mapping.yaml，读取归属；否则按内容推断
3. 对每个产品，按编号顺序遍历 spec，执行简化合并：
   - 编号最小的作为基础
   - 后续 spec 追加/更新功能描述
   - 冲突时编号更大者优先
4. 按 14 章模板生成 current-spec.md
5. 在输出摘要中标注: [降级: 合并引擎不可用，使用 LLM 全量合并]

降级模式不执行: 产品名修正、差集自动检测、结构化验证。
```

---

## 6. 复杂度追踪

### 6.1 必须项（P0/P1）

| # | 工作项 | 复杂度 | 估算行数 | 依赖 |
|---|--------|--------|---------|------|
| M1 | `sync-merge-engine.mjs` CLI 入口 + 流水线编排 | 中 | ~200 | M2-M6 |
| M2 | `sync-product-mapping.mjs` 模块 | 中 | ~250 | 复用 `simple-yaml.mjs` |
| M3 | `sync-timeline-builder.mjs` 模块 | 低 | ~120 | 无 |
| M4 | `sync-merge-strategy.mjs` 模块 | 中 | ~200 | M3 输出的 Timeline 结构 |
| M5 | `sync-conflict-resolver.mjs` 模块 | 低 | ~80 | M4 输出的 MergeSkeleton |
| M6 | `sync-validator.mjs` 模块 | 低 | ~120 | M4、M5 输出 |
| M7 | sync.md Prompt 瘦身 | 中 | ~4,700 bytes 最终产出 | M1-M6 完成后 |
| M8 | `--dry-run` + `--json` 输出格式 | 低 | 含在 M1 中 | M1 |

**合计估算**：~970 行 MJS 代码 + 1 份瘦身 Prompt

### 6.2 可选项（P2，默认不实现）

| # | 工作项 | 复杂度 | 理由 |
|---|--------|--------|------|
| O1 | `sync-changelog.mjs` 独立变更历史模块 | 低 | 技术调研提议但 spec.md 未列为 FR；变更历史可在 merge-strategy 中内联处理 |
| O2 | spec.md 的 YAML Front Matter 解析 | 低 | 当前 spec.md 格式不统一，宽松 parser 已覆盖；精确 frontmatter 解析属于 YAGNI |
| O3 | 脚本后验证（Agent 调用脚本二次验证） | 低 | spec.md FR-006 仅要求脚本内置验证；二次调用属于优化 |
| O4 | 并发处理多产品 | 低 | 当前产品数 <5，无性能瓶颈；并发引入不必要复杂度 |

### 6.3 风险缓解追踪

| 风险 | 缓解措施 | 验证方式 |
|------|---------|---------|
| R1 Markdown 结构多样性 | 宽松 section parser + raw text 降级 | 用 3-5 个真实 spec.md 测试解析成功率 |
| R2 确定性/语义边界模糊 | 初始版本保守划界，模糊操作留给 Agent | 对照分离决策矩阵逐项 review |
| R3 降级兼容性 | Prompt 保留 ~500 bytes 降级路径 | 模拟脚本不存在场景，验证 Agent 降级行为 |
| R4 接口契约漂移 | schemaVersion 字段 + major 版本不一致触发降级 | 修改 schemaVersion 后验证 Agent 反应 |
| R5 骨架与语义融合脱节 | 骨架采用 product-spec-template.md 相同的 14 章结构 | 比对骨架输出与模板结构一致性 |

---

## 7. 脚本与现有 Helper 的复用关系

### 7.1 直接复用（import）

| 现有模块 | 复用方式 | 用途 |
|---------|---------|------|
| `simple-yaml.mjs` | `parseYamlDocument()`, `stringifyYaml()` | product-mapping.yaml 的解析和序列化 |
| `product-artifact-paths.mjs` | `getProductsRoot()`, `getProductRoot()` | specs/products/ 路径计算 |
| `script-report-io.mjs` | `writeYamlArtifact()` | product-mapping.yaml 写回 |
| `script-cli-args.mjs` | 参考 `parseCommonProjectArgs()` 模式 | CLI 参数解析（需扩展 `--dry-run`） |

### 7.2 参考但不复用（模式借鉴）

| 现有模块 | 借鉴点 |
|---------|--------|
| `generate-product-entity-catalog.mjs` | 入口脚本骨架、`parseProductMapping()` 函数结构、`import.meta.url` 守卫 |
| `product-governance-helpers.mjs` | `parseProductMapping()` 的容错模式、`slugToTitle()` 工具函数、`isObject()` 判断 |

### 7.3 注意事项

- `generate-product-entity-catalog.mjs` 中的 `parseProductMapping()` 与本 Feature 的 `sync-product-mapping.mjs` 中的同名函数有重叠。**不做提前抽象**——两个函数的解析需求不同（catalog 版本解析 entry 级别的 `id/type/summary`，sync 版本需解析 spec 编号列表 + 产品描述），YAGNI 原则下各自实现，后续若确实趋同再提取公共函数。

---

## 8. SKILL.md 变更影响

### 8.1 当前 SKILL.md 中需要关注的部分

SKILL.md 中的聚合流程 Step [2/4] 当前通过 Task tool 委派 sync 子代理，传入完整 spec 内容。091 实施后：

1. **SKILL.md 不需要修改**：聚合编排层不变，仍通过 Task tool 委派 sync Agent
2. **sync.md（Agent Prompt）需要重写**：瘦身后的 Prompt 内部逻辑变更，但对 SKILL.md 而言仍是同一个 Agent
3. **可选优化**：SKILL.md 可在 Step [2/4] 之前增加一步预调用 `sync-merge-engine.mjs --dry-run --json`，将 JSON 结果注入 sync Agent 上下文。但这属于编排层优化，不在 091 范围内

### 8.2 实际变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `agents/sync.md` | 重写 | 瘦身至 <5,000 bytes |
| `scripts/sync-merge-engine.mjs` | 新增 | CLI 入口脚本 |
| `scripts/lib/sync-product-mapping.mjs` | 新增 | 产品映射模块 |
| `scripts/lib/sync-timeline-builder.mjs` | 新增 | 时间线构建模块 |
| `scripts/lib/sync-merge-strategy.mjs` | 新增 | 合并策略模块 |
| `scripts/lib/sync-conflict-resolver.mjs` | 新增 | 冲突解决模块 |
| `scripts/lib/sync-validator.mjs` | 新增 | 验证模块 |
| `skills/spec-driver-sync/SKILL.md` | 不变 | 编排层无需修改 |

---

## 9. 附录：接口契约文件索引

| 文件 | 内容 |
|------|------|
| `contracts/merge-engine-output.md` | 脚本 -> Agent 的 JSON 输出契约 |
| `contracts/agent-to-script-interface.md` | Agent -> 脚本的调用契约（CLI 参数 + 环境约定） |
| `data-model.md` | 7 个 Key Entity 的完整 JSDoc 类型定义 |
