# 数据模型：Harden — SpecStore Abstraction

**Feature Branch**: `128-harden-spec-store`
**日期**: 2026-04-19

---

## 1. SpecStore 实体

### 职责

封装"本次生成 + 历史存储 + orphan 识别 + 身份过滤"的统一查询入口。所有消费方（README 生成、graph 构建、coverage 审计、index 生成、cross-reference 构建）必须通过 SpecStore 获取 spec 集合，不得自行合并。

### 构造参数

```typescript
interface SpecStoreOptions {
  /** 本次 batch 生成的 spec 列表（来自 collectedModuleSpecs） */
  currentSpecs: ModuleSpec[];
  /** 磁盘已有的 spec 摘要列表（来自 scanStoredModuleSpecs） */
  storedSpecs: StoredModuleSpecSummary[];
  /** 项目根目录绝对路径（用于 orphan 判断） */
  projectRoot: string;
  /** 路径规范化工具函数 */
  toProjectPath: (absPath: string) => string;
}
```

### 方法签名（4 种查询视图）

```typescript
class SpecStore {
  constructor(options: SpecStoreOptions);

  /**
   * 视图 1：所有已知 spec（canonical 身份）
   * = 本次生成 + 历史存储，去重，排除 orphan，排除 derived/bundle_copy
   * 对应原 mergeIndexSpecs() 的语义，加身份过滤
   */
  allKnownSpecs(options?: { includeOrphans?: boolean }): IndexableModuleSpec[];

  /**
   * 视图 2：本次 batch 生成的 spec
   * = collectedModuleSpecs（不含历史缓存）
   */
  currentRunSpecs(): ModuleSpec[];

  /**
   * 视图 3：磁盘已有的 spec（不含本次生成）
   * = storedSpecs 中不在本次生成的部分
   * 可按身份过滤
   */
  storedOnlySpecs(options?: { sourceKind?: SpecSourceKind }): StoredModuleSpecSummary[];

  /**
   * 视图 4：orphan spec（源文件已不存在的磁盘 spec）
   */
  orphanSpecs(): StoredModuleSpecSummary[];

  /**
   * 辅助方法：将 SpecStore 内容转为 DocGraph 构建所需的两个参数
   * 用于替换 buildDocGraph 调用点
   */
  asDocGraphInput(): { moduleSpecs: ModuleSpec[]; existingSpecs: ExistingSpecDocument[] };

  /**
   * 辅助方法：spec 总数（用于 README footer 和 coverage auditor）
   */
  totalKnownCount(): number;
}
```

### 状态

```typescript
interface SpecStoreState {
  /** 合并后的去重 spec 映射（outputPath → spec） */
  readonly mergedMap: Map<string, IndexableModuleSpec>;
  /** orphan spec 集合（sourceTarget 路径不存在于磁盘的 storedSpec） */
  readonly orphans: Set<string>; // key: outputPath
  /** 构造时间戳 */
  readonly createdAt: string;
}
```

---

## 2. SpecIdentity 实体

### 职责

每个 spec 产物携带的身份标签和派生关系，用于区分 canonical（权威）、derived（衍生）、bundle_copy（bundle 复制品）。

### 字段定义

```typescript
/** spec 身份类型 */
type SpecSourceKind = 'canonical' | 'derived' | 'bundle_copy';

/** 新增到 SpecFrontmatterSchema 的字段 */
interface SpecIdentityFields {
  /**
   * spec 身份
   * - canonical：权威原始 spec（默认，历史遗留 spec 缺失此字段时视为 canonical）
   * - derived：从 canonical 派生但内容不同（如翻译版、摘要版）
   * - bundle_copy：bundle 打包产生的原始内容副本
   */
  sourceKind?: SpecSourceKind;

  /**
   * 派生来源路径（相对于 projectRoot 的 spec outputPath）
   * - canonical：null 或 undefined
   * - derived/bundle_copy：指向源 canonical spec 的 outputPath
   */
  derivedFrom?: string | null;
}
```

### 向后兼容规则

| 历史 spec 字段缺失情况 | SpecStore 行为 |
|---|---|
| `sourceKind` 缺失 | 视为 `canonical` |
| `derivedFrom` 缺失 | 视为 `null`（无派生来源） |
| 两字段均存在 | 按字段值处理 |

### 在 bundle 复制时设置

```typescript
// docs-bundle-orchestrator 在复制 spec 文件时，frontmatter 中写入：
sourceKind: 'bundle_copy'
derivedFrom: 'specs/modules/xxx.spec.md'  // 相对于 projectRoot
```

---

## 3. OrphanSpec 识别规则

### 定义

**orphan spec**：磁盘上存在 `.spec.md` 文件，但其 `sourceTarget`（frontmatter 中记录的源路径）在当前项目中已不存在。

### 识别算法

```
对每个 storedSpec:
  1. 读取 storedSpec.sourceTarget（相对路径）
  2. 构造绝对路径：path.join(projectRoot, storedSpec.sourceTarget)
  3. 判断：
     - 若 sourceTarget 是目录路径 → fs.existsSync(absolutePath) && fs.statSync(absolutePath).isDirectory()
     - 若 sourceTarget 是文件路径 → fs.existsSync(absolutePath)
  4. 不存在 → 标记为 orphan
```

### 注意事项

- `collectedModuleSpecs`（本次生成）**不做** orphan 判断（刚生成的 spec 源文件必然存在）
- 仅 `sourceKind === 'canonical'`（或缺失）的 spec 做 orphan 判断；`bundle_copy` 的派生 spec 不做判断（其源是 spec 文件而非代码文件）
- `allKnownSpecs()` 默认 **排除** orphan；通过 `{ includeOrphans: true }` 可包含

---

## 4. DevReloadContext 状态迁移

### 职责

dev 模式下 MCP CLI 入口的运行时上下文，跟踪子进程状态和源代码版本。

### 状态机

```
STOPPED
   ↓ start()
STARTING
   ↓ 子进程就绪（stdio ready）
RUNNING
   ↓ 文件变化检测到（tsx --watch 内部重启子进程）
RELOADING
   ↓ 子进程重启完成
RUNNING
   ↓ 源代码语法错误
ERROR
   ↓ 文件变化修复
RUNNING
   ↓ stop()
STOPPED
```

### 状态字段

```typescript
interface DevReloadContext {
  state: 'stopped' | 'starting' | 'running' | 'reloading' | 'error';
  /** 子进程 PID，仅 running/reloading/error 状态下有值 */
  pid?: number;
  /** 最后一次重载的时间戳 */
  lastReloadAt?: string;
  /** 最后一次错误信息，仅 error 状态下有值 */
  lastError?: string;
  /** 源代码变化计数（自上次重启起） */
  reloadCount: number;
}
```

### 边界条件

- **正在执行的 MCP 调用**：tsx --watch 在子进程重启前等待当前连接断开；新连接才用新代码
- **CI 禁用**：`process.env.CI === 'true'` 时强制 `state === 'stopped'`，不启动 dev 模式
- **循环依赖**：tsx 本身会在循环依赖时打印 warning，不会 partial-load

---

## 5. DirectionAuditReport 结构

### 职责

依赖方向自查工具的输出。对每条跨模块边做方向正确性分类。

### 字段定义

```typescript
interface DirectionAuditReport {
  /** 被审计的 graph.json 路径 */
  graphPath: string;
  /** 生成时间 */
  generatedAt: string;
  /** 审计的边总数 */
  totalEdges: number;
  /** 摘要统计 */
  summary: {
    correct: number;
    suspicious: number;
    incorrect: number;
    skipped: number; // 无 import 数据，无法判断
  };
  /** 各边的分类结果 */
  edges: DirectionAuditEdge[];
  /** 根因定位（按生成环节聚合） */
  rootCauseBreakdown: {
    /** AST 提取阶段引入的错误数 */
    astExtraction: number;
    /** panoramic builder 阶段引入的错误数 */
    panoramicBuilder: number;
    /** cross-reference 推断阶段引入的错误数 */
    crossReferenceInference: number;
    /** 无法定位 */
    unknown: number;
  };
}

type DirectionAuditResult = 'correct' | 'suspicious' | 'incorrect' | 'skipped';

interface DirectionAuditEdge {
  /** 来源节点 ID（graph.json 中的 source） */
  sourceId: string;
  /** 目标节点 ID（graph.json 中的 target） */
  targetId: string;
  /** 关系类型 */
  relation: string;
  /** 审计结论 */
  result: DirectionAuditResult;
  /** 置信度分数，0.0-1.0 */
  confidence: number;
  /** 判断依据 */
  rationale: string;
  /** 推测的错误来源（仅 incorrect/suspicious 时有值） */
  suspectedStage?: 'ast-extraction' | 'panoramic-builder' | 'cross-reference-inference';
}
```

### 报告输出格式

1. **控制台**：按 result 分组的 Markdown 表格，incorrect 项用红色高亮
2. **文件**：`specs/_meta/direction-audit-report.json`（JSON 格式）
3. **CI guard**：比较当前 report 中 `incorrect` 数与上次快照，若增加则 CI 失败
