# Feature 100: content-hash-cache

## Prompt

```
/spec-driver:spec-driver-feature 100-content-hash-cache

SHA256 内容哈希缓存 + manifest + generator 级增量 + cache CLI。目标是让二次 batch（少量文件变化）耗时降至首次的 20% 以内。

## 需求概述

在 spectra 的 batch / panoramic 管道中引入文件级内容哈希缓存，使 generator 能跳过输入未变化的文件，复用上次输出。

### 核心能力

1. **内容哈希引擎**
   - 缓存 key: `SHA256(content + resolvedPath)`
   - 对 .md 文件只哈希 frontmatter 之后的正文（frontmatter 中 mtime 等元字段变化不应触发重算）
   - 使用 Node.js 原生 `crypto.createHash('sha256')`，无额外依赖

2. **Manifest 管理**
   - `_meta/manifest.json`：记录每个源文件的 `{ hash, mtime, size, type }` + 每个 spec/generator 输出的依赖文件列表
   - 原子写入（先写 tmp 再 rename，复用 checkpoint.ts 的模式）
   - manifest 格式需向前兼容：缺少字段时 graceful degrade 为"全量重算"

3. **Generator 级增量**
   - panoramic generator 接入 manifest：比对输入文件 hash，未变 → 跳过当前 generator，复用上次输出
   - 接入点在 `GeneratorRegistry` 或 `batch-orchestrator` 层面统一拦截，各 generator 无需单独适配
   - 跳过时输出日志 `[cache-hit] {generatorId}: {N} files unchanged, reusing output`

4. **Cache CLI 命令**
   - `spectra cache clear` — 清除 `_meta/` 下全部缓存（manifest + hash 文件）
   - `spectra cache stats` — 输出缓存统计：总文件数、缓存命中率、总缓存大小、上次 batch 时间
   - 注册方式：在 `src/cli/index.ts` switch 分支 + HELP_TEXT 新增 `cache` 子命令

### 性能目标

| 场景 | 目标 |
|------|------|
| 首次 batch（100 文件） | < 5 分钟 |
| 二次 batch（2/100 文件变化） | < 30 秒（首次 20%） |
| 缓存命中率（稳定代码库） | > 90% |
| manifest 读写 | < 100ms（1000 条目） |

### 与现有系统的关系

- **DeltaRegenerator**（`src/batch/delta-regenerator.ts`）：现有 spec 级增量——对比骨架哈希决定是否重生成单个 spec。Feature 100 在更底层（文件级）提供缓存，两者互补：DeltaRegenerator 决定"哪些 spec 需要重生成"，content-hash-cache 决定"spec 重生成时哪些 generator 输入没变可以跳过"
- **BatchState / checkpoint.ts**：现有断点恢复机制。manifest.json 与 checkpoint 互补但独立——checkpoint 追踪"batch 进度"，manifest 追踪"文件内容状态"
- **GeneratorRegistry**（`src/panoramic/registry/generator-registry.ts`）：继承 `AbstractRegistry`，通过 `filterByContext()` 异步过滤 generator。缓存拦截可在 registry 的 `execute()` 或 orchestrator 的 generator 调用循环中统一注入
- **batch-orchestrator.ts L402-416**：现有 `shouldSkipModule` 逻辑，新缓存在此之后、generator 执行之前生效

### 目录结构建议

```
src/cache/
  content-hasher.ts     # SHA256 哈希计算（含 .md frontmatter 跳过逻辑）
  manifest.ts           # manifest.json 读写 + 原子更新
  cache-manager.ts      # 缓存拦截逻辑 + stats 计算
  index.ts              # 统一导出
src/cli/commands/
  cache.ts              # cache clear / cache stats 子命令
tests/unit/
  content-hasher.test.ts
  manifest.test.ts
  cache-manager.test.ts
tests/integration/
  batch-cache-incremental.test.ts  # 端到端：首次 + 二次 batch 性能对比
```

### 约束

- 纯 Node.js 标准库（crypto, fs, path），不引入新依赖
- manifest 数据结构必须支持后续 Feature 101（graph-persistence）扩展
- 缓存失效策略：manifest 中记录的文件如果在磁盘上已删除或 mtime 早于 manifest 记录 → 标记为 stale → 重算
- `.gitignore` 中 `_meta/` 已被忽略（用户不需要提交缓存文件）
- 所有新增代码遵循项目现有模式：TypeScript strict、Zod schema 验证、中文注释
```

## 上下文速查

### 关键文件路径

| 文件 | 作用 |
|------|------|
| `src/batch/batch-orchestrator.ts` | batch 主编排器，L286-318 增量决策，L402-416 跳过逻辑 |
| `src/batch/delta-regenerator.ts` | spec 级增量引擎，`plan()` → `DeltaReport` |
| `src/batch/checkpoint.ts` | 断点恢复，原子写入模式可复用 |
| `src/panoramic/registry/generator-registry.ts` | generator 注册表，`filterByContext()` 异步过滤 |
| `src/panoramic/registry/abstract-registry.ts` | 注册表基类，两阶段验证 |
| `src/panoramic/generators/` | 19 个 generator（architecture-ir, workspace-index 等） |
| `src/cli/index.ts` | CLI 入口，switch 分支注册子命令 |
| `src/cli/commands/*.ts` | 各子命令实现模块 |

### 现有数据结构

```typescript
// checkpoint.ts — 可复用原子写入模式
interface BatchState {
  batchId: string;
  projectRoot: string;
  startedAt: string;
  lastUpdatedAt: string;
  totalModules: number;
  processingOrder: string[];
  completedModules: { path: string; specPath: string; completedAt: string; tokenUsage: object }[];
  failedModules: { path: string; error: string; failedAt: string; retryCount: number }[];
  currentModule: string | null;
}

// delta-regenerator.ts — 现有增量接口
interface DeltaRegeneratorOptions {
  projectRoot: string;
  dependencyGraph: Map<string, string[]>;
  moduleGroups: ModuleGroup[];
  storedSpecs: Map<string, SpecSummary>;
}
interface DeltaReport {
  regenerateTargets: string[];
  directChanges: string[];
  propagatedChanges: string[];
}
```

### 里程碑上下文

- 属于 **M-100 Spectra Evolution** Phase 1
- 优先级 P1，目标版本 v3.1.0
- 前置依赖：Feature 099（spectra-rebrand）✅ 已完成
- 后续依赖：Feature 101（graph-persistence）和 Feature 102（spectra-config-migration）依赖本特性
