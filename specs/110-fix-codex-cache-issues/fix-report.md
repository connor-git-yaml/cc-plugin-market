# 问题修复报告

## 问题描述

Codex 对 Feature 100（content-hash-cache）实现进行对抗性审查后，发现 3 个 HIGH 级别问题，影响缓存系统正确性和可用性。需修复后方可合并到主线。

## 5-Why 根因追溯

### 问题一：CLI manifest 路径与 batch 管道不一致

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | `spectra cache stats` 报告空缓存，但 batch 刚跑完 | CLI 初始化 CacheManager 时传入了错误的 outputDir |
| Why 2 | CLI 为何用了错误路径？ | `runCacheCommand` 默认值为 `<cwd>/specs`，而 batch 写入 `<cwd>/specs/project` |
| Why 3 | 两处路径为何不一致？ | CLI 实现时未参照 `BATCH_OUTPUT_SUBDIRS.PROJECT` 常量，直接硬编码了 batch root |
| Why 4 | 为何未有共享路径解析器？ | Feature 100 spec 只定义了 `--output-dir` 接口，未规定与 batch 路径约定的一致性 |
| Why 5 | 为何未被测试捕获？ | CLI 集成测试缺失；批量路径层级（`specs/project/`）未在 CLI 文档中说明 |

**Root Cause**: CLI 的 `outputDir` 默认值为 batch 根目录（`specs`），而非 batch 实际写入项目文档的子目录（`specs/project`）。
**Root Cause Chain**: CLI 报告空缓存 → 路径默认 `specs` 而不是 `specs/project` → 未引用 `BATCH_OUTPUT_SUBDIRS.PROJECT` 常量 → spec 未定义路径对齐约束 → 无集成测试

---

### 问题二：缓存命中时丢弃 upstream generators 的结构化输出

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 命中缓存后，component-view、ADR 等后续文档质量下降 | `structuredOutputs.set(generator.id, undefined)` 清空了在内存中传递的结构化数据 |
| Why 2 | 为何要设置 undefined？ | 占位符设计意图是"标记已处理"，但错误地清空了下游依赖的 payload |
| Why 3 | 为何未在设计阶段发现？ | `structuredOutputs` 的双重职责（"已处理标记" + "跨 generator 数据通道"）未在 spec 中清晰说明 |
| Why 4 | 为何无防护？ | 下游消费者（`architectureIR`、`architectureOverview` 等）依赖 map 中有效数据，但无 fallback 路径 |
| Why 5 | 为何测试未捕获？ | 缓存集成测试未覆盖"命中 upstream generator 后下游是否正常"这一场景 |

**Root Cause**: 对 `structuredOutputs` 的使用混淆了"标记已处理"和"传递结构化数据"两个语义；缓存命中时应该不插入（或插入真实数据），而非插入 undefined。
**Root Cause Chain**: component-view/ADR 降级 → `structuredOutputs` 中 upstream 数据为 undefined → cache hit 路径错误清空 map → 设计未区分 leaf vs upstream generator → 无针对性场景测试

---

### 问题三：fallback cache key 扫描范围不当

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 稳定代码库中缓存命中率极低 | fallback 扫描时将 batch 生成物（每次运行后都变化的 .md/.json 文件）纳入 hash 计算 |
| Why 2 | 为何会扫到生成物？ | `scanSourceFiles` 从 projectRoot 出发，未排除 batch 输出目录（如 `specs/`）|
| Why 3 | 另一方向：真实输入未覆盖 | `Dockerfile*`、`.env*`、`.toml`、lockfiles 不在 `INCLUDED_EXTENSIONS` 中，config/runtime 变更被忽略 |
| Why 4 | 为何两个方向都出错？ | fallback 设计为"尽量广覆盖"，但既未知道 outputDir（无法排除），也未参考具体 generator 的真实依赖 |
| Why 5 | 为何未被发现？ | 缓存 key 稳定性测试未设置真实 batch 场景（输出目录与源码目录混在一起） |

**Root Cause**: `scanSourceFiles` 缺乏 outputDir 排除参数，且 `INCLUDED_EXTENSIONS` 对现有 generators 真实输入覆盖不完整，导致 key 双向不稳定（持续 churn + 漏掉真实变更）。
**Root Cause Chain**: cache churn 或 stale 命中 → 生成物纳入 hash / 真实输入未纳入 → scanSourceFiles 未收到 outputDir → fallback 设计过宽且不完整 → 无实际场景 key 稳定性测试

---

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `src/cli/commands/cache.ts` | L38 | 默认 outputDir 为 `specs`（batch root） | 改为 `path.join(process.cwd(), 'specs', 'project')` 或引用 `BATCH_OUTPUT_SUBDIRS.PROJECT` |
| `src/panoramic/batch-project-docs.ts` | L111 | `structuredOutputs.set(generator.id, undefined)` on cache hit | 对 upstream generators 跳过缓存，或仅对 leaf generators 使用缓存 |
| `src/panoramic/cache/cache-key-builder.ts` | L25-37 | `EXCLUDED_DIRS` 无 outputDir；`INCLUDED_EXTENSIONS` 缺真实输入 | 添加 outputDir 参数、添加 `.toml`/`.lock` 扩展名和 `Dockerfile*`/`.env*` 文件名匹配 |

### 类似模式（需评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| `src/panoramic/cache/cache-manager.ts` | L37,L60,L122 | `initialize(outputDir)` 存了路径但未传给 key-builder | 安全（manifest path 用途正确），但需新增字段供 key-builder 用 |
| `src/cli/utils/parse-args.ts` | cacheOperation 处理 | 未影响路径逻辑 | 安全 |

### 同步更新清单
- 调用方: `CacheManager.check()` → `resolveInputFiles()` → `scanSourceFiles()` 接口需要带 outputDir 参数
- 类型: `cache-key-builder.ts` 函数签名更新
- 文档: CLI HELP 文本中 `--output-dir` 说明需要更新

---

## 修复策略

### 方案 A（推荐）

**Problem 1 — CLI 路径对齐**
在 `src/cli/commands/cache.ts` 中，引用 `BATCH_OUTPUT_SUBDIRS.PROJECT`，将默认 outputDir 从 `specs` 改为 `specs/project`：
```ts
import { BATCH_OUTPUT_SUBDIRS } from '../../panoramic/output-filenames.js';
const outputDir = command.outputDir ?? path.join(process.cwd(), 'specs', BATCH_OUTPUT_SUBDIRS.PROJECT);
```

**Problem 2 — Upstream generators 保护**
在 `batch-project-docs.ts` 中定义 `CACHE_SKIP_GENERATOR_IDS`（upstream generators 白名单），在 cache check 之前短路，确保这些 generators 始终全量运行并产出真实 structuredData：
```ts
const CACHE_SKIP_GENERATOR_IDS = new Set([
  'architecture-overview', 'pattern-hints', 'architecture-ir',
  'event-surface', 'runtime-topology',
]);
```

**Problem 3 — Fallback key 扫描修正**
- `scanSourceFiles(root, excludePaths?: string[])` 添加 `excludePaths` 参数，跳过路径前缀匹配的目录
- 添加 `.toml`、`.lock` 扩展名
- 添加 `INCLUDED_FILENAME_PREFIXES`（`Dockerfile`, `.env`）匹配无扩展名文件
- `resolveInputFiles(generator, context, outputDir?)` 接受可选 outputDir 并传入 scanSourceFiles
- `buildGeneratorCacheKey(generator, context, hasher, outputDir?)` 同步透传
- `CacheManager` 在 `initialize(outputDir)` 时存储，在 `check()` / `record()` 中透传

### 方案 B（备选）

对 Problem 2，改为在 cache hit 时从已写入的 JSON 文件中加载 structuredData 恢复数据。优点：upstream generator 也可享受缓存。缺点：需要知道 JSON 文件路径和类型，实现复杂，反序列化有运行时风险。

推荐方案 A，理由：最小改动、不引入运行时风险、上游 generators 本身数量少（5个），跳过缓存对整体性能影响可接受。

---

## Spec 影响

- `specs/100-content-hash-cache/spec.md` 需要更新：
  - CLI `--output-dir` 默认值说明（修正为 `<cwd>/specs/project`）
  - 新增 "upstream generator 缓存豁免" 约束
  - 新增 fallback key 扫描排除规则（outputDir、filename patterns）
