---
feature: 091-sync-deterministic-merge
title: 数据模型定义
created: 2026-04-06
status: Draft
---

# Feature 091: 数据模型定义

> 本文档定义 sync-merge-engine 的 7 个 Key Entity 和辅助类型。
> 实际实现使用 JSDoc 注释的纯 JavaScript（.mjs），此处以 TypeScript 风格表述便于阅读。

---

## 1. 基础类型

### 1.1 SpecType — Spec 类型枚举

```typescript
/**
 * spec 的变更类型，决定合并策略中的处理方式。
 * 分类规则基于 spec 目录名和标题关键词。
 */
type SpecType = 'INITIAL' | 'FEATURE' | 'FIX' | 'REFACTOR' | 'ENHANCEMENT';
```

**分类规则**：

| 类型 | 触发条件 | 合并行为 |
|------|---------|---------|
| `INITIAL` | 产品中编号最小的 spec | 作为 merged_spec 的基础 |
| `FEATURE` | 目录名或标题含 feature 关键词，或无其他匹配 | 追加新的 User Stories 和 FR |
| `FIX` | 目录名含 `fix` | 不新增功能，更新对应 FR 描述 |
| `REFACTOR` | 目录名含 `refactor` 或 `rename` 或 `split` | 可能替换整段功能描述 |
| `ENHANCEMENT` | 目录名含 `enhance` 或 `batch` 或 `improve` | 更新已有功能描述（增强而非替换） |

### 1.2 SpecEntry — Spec 扫描条目

```typescript
/**
 * 扫描 specs/ 目录后提取的单个 spec 元数据。
 * 由 sync-merge-engine.mjs 入口脚本的扫描阶段生成。
 */
interface SpecEntry {
  /** spec 编号，如 "001", "091" */
  id: string;

  /** 目录短名，如 "001-reverse-spec-v2", "091-sync-deterministic-merge" */
  dirName: string;

  /** spec.md 的第一个 H1 标题文本，解析失败时为 null */
  title: string | null;

  /** spec.md 概述段的前 200 字符，用于产品归属推断 */
  summary: string | null;

  /** spec.md 的 YAML Front Matter 状态字段（如 "Draft", "Implemented"），解析失败时为 null */
  status: string | null;

  /** spec.md 的完整文件路径（绝对路径） */
  filePath: string;

  /** spec.md 的 YAML Front Matter created 字段，解析失败时为 null */
  createdDate: string | null;
}
```

---

## 2. 核心实体

### 2.1 ProductMapping — 产品映射

```typescript
/**
 * product-mapping.yaml 的结构化表示。
 * 描述产品与 spec 的归属关系。
 *
 * 对应文件: specs/products/product-mapping.yaml
 * 管理模块: sync-product-mapping.mjs
 */
interface ProductMapping {
  /** 产品映射集合，key 为产品 ID（如 "spec-driver", "reverse-spec"） */
  products: Record<string, ProductDefinition>;
}

interface ProductDefinition {
  /** 产品描述文本 */
  description: string;

  /** 归属该产品的 spec 编号列表（字符串，如 ["001", "013", "091"]） */
  specs: string[];
}
```

**产品名修正规则**：

```typescript
/**
 * 已知的产品名自动修正规则。
 * key 为旧名，value 为新名。
 */
const NAME_CORRECTION_RULES: Record<string, string> = {
  'spec-driverdriver': 'spec-driver',
  'spec-driver-driver-pro': 'spec-driver',
};
```

### 2.2 Timeline — 时间线

```typescript
/**
 * 单个产品的 spec 时间线。
 * 按编号排序，每个条目带有类型标记。
 *
 * 管理模块: sync-timeline-builder.mjs
 */
interface Timeline {
  /** 产品 ID */
  productId: string;

  /** 按编号升序排列的时间线条目 */
  entries: TimelineEntry[];

  /** 按类型统计的数量 */
  stats: Record<SpecType, number>;
}

interface TimelineEntry {
  /** spec 编号 */
  specId: string;

  /** spec 目录名 */
  dirName: string;

  /** 自动分类的 spec 类型 */
  type: SpecType;

  /** spec 标题 */
  title: string | null;

  /** spec 摘要 */
  summary: string | null;
}
```

### 2.3 MergeSkeleton — 合并骨架

```typescript
/**
 * 合并骨架，包含按 14 章结构组织的合并结果。
 * 这是脚本输出的核心数据结构，供 Agent 语义融合时作为骨架使用。
 *
 * 管理模块: sync-merge-strategy.mjs
 *
 * 设计决策: 骨架采用与 product-spec-template.md 相同的 14 章结构，
 * 确保 Agent 基于骨架填充内容而非重建结构。
 */
interface MergeSkeleton {
  /** 产品 ID */
  productId: string;

  /** 合并后的章节骨架（key 为章节编号 "1"-"14"） */
  chapters: Record<string, ChapterSkeleton>;

  /** 合并统计 */
  mergeStats: MergeStats;
}

interface ChapterSkeleton {
  /** 章节标题（如 "产品概述", "当前功能全集"） */
  title: string;

  /** 章节编号（1-14） */
  number: number;

  /**
   * 该章节涉及的 FR 条目。
   * 仅对 "当前功能全集"（第 5 章）有实质内容，
   * 其他章节此字段为空数组。
   */
  functionalRequirements: FREntry[];

  /**
   * 该章节涉及的 User Story 条目。
   * 仅对 "用户画像与场景"（第 3 章）和 "当前功能全集"（第 5 章）有实质内容。
   */
  userStories: UserStoryEntry[];

  /** 该章节涉及的来源 spec 编号列表 */
  sourceSpecs: string[];

  /**
   * 变更摘要：描述本次合并对该章节的影响。
   * 格式如 "+3 FR (来自 091, 092)", "~1 FR 更新 (来自 090-fix)"
   */
  changeSummary: string;
}

interface FREntry {
  /** FR 标识符，如 "FR-001" */
  id: string;

  /** FR 描述文本（从 spec.md 提取的原始文本） */
  description: string;

  /** 来源 spec 编号 */
  sourceSpec: string;

  /** FR 状态: active（活跃）、superseded（被取代）、deprecated（被废弃） */
  status: 'active' | 'superseded' | 'deprecated';

  /** 若被取代，记录取代者的 spec 编号 */
  supersededBy: string | null;
}

interface UserStoryEntry {
  /** User Story 标题或首行 */
  title: string;

  /** User Story 完整描述 */
  description: string;

  /** 来源 spec 编号 */
  sourceSpec: string;

  /** 优先级（如 "P1", "P2"），解析失败时为 null */
  priority: string | null;
}

interface MergeStats {
  /** 活跃 FR 数量 */
  activeFRCount: number;

  /** 被取代的 FR 数量 */
  supersededFRCount: number;

  /** 被废弃的 FR 数量 */
  deprecatedFRCount: number;

  /** User Story 数量 */
  userStoryCount: number;

  /** 参与合并的 spec 总数 */
  totalSpecCount: number;
}
```

### 2.4 ConflictRecord — 冲突记录

```typescript
/**
 * 冲突记录，描述哪个 spec 的内容被更新的 spec 取代。
 *
 * 管理模块: sync-conflict-resolver.mjs
 *
 * 冲突规则: 当两个 spec 描述同一功能（FR ID 相同或描述高度重叠）
 * 但内容不同时，以编号更大者（更新的 spec）优先。
 */
interface ConflictRecord {
  /** 冲突涉及的功能标识（FR ID 或功能描述关键词） */
  subject: string;

  /** 胜出的 spec 编号（编号更大者） */
  winner: string;

  /** 被取代的 spec 编号 */
  loser: string;

  /** 冲突原因描述 */
  reason: string;
}
```

### 2.5 ValidationReport — 验证报告

```typescript
/**
 * 合并结果的验证报告，包含三项验证检查。
 *
 * 管理模块: sync-validator.mjs
 */
interface ValidationReport {
  /** 产品 ID */
  productId: string;

  /** 整体验证结果 */
  passed: boolean;

  /** 三项验证检查 */
  checks: ValidationCheck[];
}

interface ValidationCheck {
  /** 检查名称 */
  name: 'fr-count' | 'no-contradiction' | 'changelog-coverage';

  /** 检查是否通过 */
  passed: boolean;

  /** 检查详情 */
  detail: string;

  /** 具体数值（如 FR 数量对比） */
  data: Record<string, number | string>;
}
```

**三项验证检查定义**：

| 检查名称 | 规则 | 通过条件 |
|---------|------|---------|
| `fr-count` | 合并后活跃 FR 数量 >= INITIAL spec 的 FR 数量 | `activeFRCount >= initialFRCount` |
| `no-contradiction` | 无矛盾的 FR 描述（同一 FR ID 不存在两个 active 版本） | 无重复 active FR ID |
| `changelog-coverage` | 变更历史覆盖所有归属 spec | 变更历史中的 spec 编号集合 = 产品归属的 spec 编号集合 |

### 2.6 DryRunPreview — Dry-run 预览

```typescript
/**
 * --dry-run 模式的输出结构。
 * 默认输出人类可读的混合格式，--json 时输出此结构的 JSON。
 *
 * 生成位置: sync-merge-engine.mjs 的输出组装阶段
 */
interface DryRunPreview {
  /** 固定为 true */
  dryRun: true;

  /** 产品映射变更预览 */
  mappingChanges: {
    /** 各产品的 spec 增减 */
    byProduct: Record<string, {
      added: string[];
      removed: string[];
    }>;
  };

  /** 各产品的合并预览 */
  products: Record<string, ProductPreview>;

  /** 摘要统计 */
  summary: {
    totalProducts: number;
    totalSpecs: number;
    totalConflicts: number;
    totalWarnings: number;
  };
}

interface ProductPreview {
  /** 时间线统计 */
  timeline: {
    total: number;
    byType: Record<SpecType, number>;
  };

  /** 各章节的变更预览 */
  mergePreview: Record<string, {
    addedFR: number;
    updatedFR: number;
    supersededFR: number;
    sources: string[];
  }>;

  /** 冲突列表 */
  conflicts: ConflictRecord[];

  /** 验证结果 */
  validationResults: ValidationCheck[];
}
```

---

## 3. 顶层输出结构

### 3.1 MergeEngineOutput — 脚本完整输出

```typescript
/**
 * sync-merge-engine.mjs 的完整 stdout JSON 输出。
 * 这是脚本与 Agent 之间的唯一通信接口。
 *
 * schemaVersion 用于防止接口漂移:
 * - major 版本不一致 → Agent 回退到降级路径
 * - minor/patch 不一致 → Agent 正常消费，trace 中记录警告
 */
interface MergeEngineOutput {
  /** 接口版本号，语义化版本，如 "1.0.0" */
  schemaVersion: string;

  /** 各产品的合并结果 */
  products: Record<string, ProductMergeResult>;

  /** 未映射的 spec 列表（需 Agent 通过内容分析推断归属） */
  unmappedSpecs: UnmappedSpec[];

  /** 验证结果汇总 */
  validation: {
    /** 所有产品是否全部通过验证 */
    allPassed: boolean;
    /** 各产品的验证报告 */
    reports: ValidationReport[];
  };

  /** 警告列表 */
  warnings: string[];

  /** 统计摘要 */
  stats: {
    totalProducts: number;
    totalSpecs: number;
    totalActiveFR: number;
    totalConflicts: number;
    executionTimeMs: number;
  };
}

interface ProductMergeResult {
  /** 产品 ID */
  productId: string;

  /** 时间线 */
  timeline: Timeline;

  /** 合并骨架 */
  mergeSkeleton: MergeSkeleton;

  /** 冲突记录 */
  conflicts: ConflictRecord[];

  /** 验证报告 */
  validation: ValidationReport;
}

interface UnmappedSpec {
  /** spec 编号 */
  specId: string;

  /** spec 目录名 */
  dirName: string;

  /** spec 标题（辅助 Agent 推断） */
  title: string | null;

  /** spec 摘要（辅助 Agent 推断） */
  summary: string | null;
}
```

---

## 4. Spec 解析辅助类型

```typescript
/**
 * 从 spec.md 中提取的结构化字段。
 * 由入口脚本的扫描阶段生成，供各 lib 模块消费。
 *
 * 解析策略: 宽松 section parser，以 H2（##）为主要分割点。
 * 解析失败的字段返回 null 而非抛异常。
 */
interface ParsedSpecContent {
  /** H1 标题 */
  title: string | null;

  /** 概述段（第一个 H2 前的正文） */
  overview: string | null;

  /** YAML Front Matter（如有） */
  frontMatter: Record<string, string> | null;

  /** User Stories 列表（从 "User Scenarios" 章节提取） */
  userStories: UserStoryRaw[];

  /** Functional Requirements 列表（从 "Requirements" 章节提取） */
  requirements: FRRaw[];

  /** Success Criteria 列表 */
  successCriteria: string[];

  /** Constraints 文本 */
  constraints: string | null;

  /** Dependencies 文本 */
  dependencies: string | null;
}

interface UserStoryRaw {
  /** User Story 标题 */
  title: string;

  /** 优先级标注（如 "P1"），解析失败时为 null */
  priority: string | null;

  /** 完整文本 */
  rawText: string;
}

interface FRRaw {
  /** FR 标识符，如 "FR-001" */
  id: string;

  /** FR 描述 */
  description: string;

  /** 包含 MUST/SHOULD/MAY 等关键词 */
  level: 'MUST' | 'SHOULD' | 'MAY' | null;
}
```

---

## 5. 实体关系图

```
SpecEntry (扫描)
    │
    ▼
ProductMapping (归属)
    │
    ├──► Timeline (排序 + 类型标记)
    │       │
    │       ▼
    │   MergeSkeleton (合并骨架)
    │       │
    │       ├──► ConflictRecord[] (冲突记录)
    │       │
    │       ▼
    │   ValidationReport (验证报告)
    │
    ▼
MergeEngineOutput (顶层输出)
    │
    ├──► products: { ProductMergeResult[] }
    ├──► unmappedSpecs: UnmappedSpec[]
    ├──► validation: { reports[] }
    ├──► warnings: string[]
    └──► stats: { ... }
```

**数据流向**：
1. 入口脚本扫描 specs/ → `SpecEntry[]`
2. 加载 product-mapping.yaml → `ProductMapping`
3. 逐产品: `SpecEntry[]` → `Timeline` → `MergeSkeleton` → `ConflictRecord[]` → `ValidationReport`
4. 组装: 所有产品结果 + unmappedSpecs + warnings → `MergeEngineOutput`
5. stdout JSON → Agent 消费
