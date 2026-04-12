# Feature 106: watch-incremental

## Prompt

```
/spec-driver:spec-driver-feature 106-watch-incremental

文件监听 + batch --update 增量模式。目标是让开发者在编码过程中自动保持文档与代码同步。

## 需求概述

### 核心能力

1. **Watch 文件监听 (`spectra watch`)**
   - 使用 chokidar 监听项目文件变化（需新增依赖）
   - 3 秒 debounce（可通过 `--debounce <seconds>` 配置）
   - 变化分类处理：
     - 代码变化（.ts/.js/.py/.go 等）→ 立即标记 manifest 为 stale + 更新 `_meta/needs_update`
     - 文档变化（.md）→ 标记 `_meta/needs_update`
     - 配置变化（.yaml/.json）→ 标记所有相关 generator 输出为 stale
   - 忽略规则：`.gitignore` + `node_modules/` + `dist/` + `specs/` + `_meta/`
   - 降级策略：chokidar 不可用 → 回退 `fs.watch` + 轮询（间隔 5 秒）
   - 输出实时日志：`[watch] {file} changed, marking stale`

2. **增量 Batch 模式 (`spectra batch --update`)**
   - 仅处理 manifest 中标记为 changed/stale 的文件
   - 与现有 `--incremental` 整合：
     - `--incremental`：spec 级增量（DeltaRegenerator 决策）
     - `--update`：文件级增量（基于 Feature 100 的 manifest hash 比对）
     - `--update --incremental`：先文件级过滤，再 spec 级过滤（最高效）
   - 新增 `_meta/needs_update` 标记文件：
     ```json
     { "staleFiles": ["src/cli/index.ts", "src/mcp/server.ts"], "markedAt": "..." }
     ```
   - `batch --update` 读取 needs_update → 仅对这些文件关联的 generator 执行 → 清除 needs_update

3. **CLI 命令**
   - `spectra watch [--debounce <seconds>]`：启动文件监听（前台进程，Ctrl+C 退出）
   - `spectra batch --update`：仅处理变化文件的增量 batch
   - 注册方式：
     - `src/cli/index.ts` switch 分支 + HELP_TEXT 新增 `watch` 子命令
     - `batch` 子命令新增 `--update` flag
   - 新建 `src/cli/commands/watch.ts`

4. **与 cache 系统集成**
   - watch 模式下实时更新 manifest（不等 batch 完成）
   - 利用 Feature 100 的 `ManifestManager` 接口：
     - `get(filePath)` 读取当前 hash
     - `set(filePath, entry)` 更新 hash
     - `flush()` 持久化到磁盘

### 性能目标

| 场景 | 目标 |
|------|------|
| 代码文件变化 → 标记 stale | < 3 秒（含 debounce） |
| `batch --update` 处理 2/100 文件变化 | < 20 秒 |
| watch 进程内存占用 | < 50 MB（1000 文件监听） |
| watch 启动时间 | < 2 秒 |

### 与现有系统的关系

- **Feature 100 cache 系统** (`src/panoramic/cache/`)
  - `ManifestManager`：`load/get/set/delete/flush/stats()` 方法
  - `ManifestEntry`：存储单条缓存条目（hash, mtime, size, type）
  - `CacheManager`：缓存拦截逻辑
  - `ContentHasher`：SHA256 哈希计算

- **batch-orchestrator.ts**
  - `BatchOptions` (L55)：已有 `incremental?: boolean`，需新增 `update?: boolean`
  - L288-314：DeltaRegenerator 差量分析（spec 级）
  - L402-416：shouldSkipModule 决策逻辑（需在此之前插入文件级过滤）

- **CLI 参数解析** (`src/cli/utils/parse-args.ts`)
  - 现有参数解析模式（用于新增 --update 和 --debounce）

- **chokidar 依赖**
  - `package.json` 当前无 chokidar，需 `npm install chokidar`
  - chokidar v4.x 为 ESM-first，确认兼容性

### 目录结构建议

```
src/watch/
  watcher.ts            # chokidar 封装 + 变化分类 + debounce
  stale-marker.ts       # _meta/needs_update 读写
  watcher-config.ts     # 监听配置（ignore patterns, debounce 时间）
  index.ts              # 统一导出
src/cli/commands/
  watch.ts              # spectra watch [--debounce <seconds>] 命令
tests/unit/
  watcher.test.ts       # chokidar mock + 变化分类测试
  stale-marker.test.ts  # needs_update 文件读写测试
tests/integration/
  watch-incremental.test.ts  # 端到端：文件变化 → watch 标记 → batch --update 增量处理
```

### 约束

- chokidar 是唯一新增运行时依赖，必须有 `fs.watch` 降级路径
- watch 进程必须 graceful shutdown（SIGINT/SIGTERM 时清理文件句柄）
- `_meta/needs_update` 使用 JSON 格式，原子写入
- `--update` 与 `--force` 互斥（force 意味着全量重生成，忽略 stale 标记）
- 所有新增代码遵循项目现有模式：TypeScript strict、Zod schema 验证、中文注释
- watch 模式下的 manifest 更新不应触发完整 batch，仅标记 stale
```

## 上下文速查

| 文件 | 作用 |
|------|------|
| `src/panoramic/cache/manifest-manager.ts` | Feature 100 manifest 管理器 |
| `src/panoramic/cache/content-hasher.ts` | Feature 100 内容哈希器 |
| `src/panoramic/cache/cache-manager.ts` | Feature 100 缓存拦截 |
| `src/batch/batch-orchestrator.ts` L55 | `BatchOptions` 定义 |
| `src/batch/batch-orchestrator.ts` L288-314 | DeltaRegenerator 增量逻辑 |
| `src/batch/batch-orchestrator.ts` L402-416 | shouldSkipModule 决策 |
| `src/cli/index.ts` | CLI 入口，子命令 switch 分支 |
| `src/cli/commands/cache.ts` | Feature 100 CLI 命令（参考模式） |
| `src/cli/utils/parse-args.ts` | 参数解析工具 |

### 里程碑上下文

- 属于 **M-100 Spectra Evolution** Phase 5
- 优先级 P5，目标版本 v3.5.0
- 前置依赖：Feature 100 (content-hash-cache) ✅ 已完成
- 后续无直接依赖（依赖链终端）
- 与 Feature 101 (graph-persistence) **互不依赖**，可并行开发
