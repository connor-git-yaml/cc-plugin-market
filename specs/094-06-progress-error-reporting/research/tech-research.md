# F-094-06 代码库扫描调研报告

## 调研模式
codebase-scan（跳过产品/技术调研，直接扫描代码库）

## 1. 进度报告机制现状

### 1.1 核心文件

| 文件 | 行数 | 职责 |
|------|------|------|
| `src/batch/progress-reporter.ts` | ~150 | ProgressReporter 接口 + createReporter 工厂 |
| `src/cli/commands/batch.ts` | ~70 | batch 子命令入口，含手写进度条 |
| `src/batch/batch-orchestrator.ts` | ~700 | 批量编排引擎，调用 reporter + onProgress |

### 1.2 当前实现方式

**progress-reporter.ts**:
- `start()`: `console.log([N/Total] 正在处理 modulePath...)`
- `stage()`: `console.log(→ message)` / `console.log(✓ stage完成)`
- `complete()`: `console.log(emoji modulePath — status)`
- `finish()`: `console.log(--- 批处理完成 ---)`

**batch.ts:41-46 (进度条)**:
```typescript
onProgress: (completed, total) => {
  const bar = '='.repeat(Math.floor((completed / total) * 20)).padEnd(20, ' ');
  process.stdout.write(`\r[${bar}] ${completed}/${total}`);
},
```

### 1.3 问题定位

| 问题 | 位置 | 影响 |
|------|------|------|
| 混用 stdout.write 和 console.log | batch.ts:44 + reporter 多处 | 进度条被日志打断 |
| 缺少 isTTY 检测 | 整个 batch 模块 | 管道/CI 环境中输出 `\r` 控制码 |
| 无 ANSI 序列 | 仅用 `\r` | 无法光标上移/清行 |
| 阶段进度无聚合 | reporter.stage() 每次输出一行 | 噪音过大 |

### 1.4 进度回调链路

```
batch.ts → BatchOptions.onProgress(completed, total) 
         → process.stdout.write(\r[===] N/M)

batch-orchestrator.ts → reporter.start(module) → console.log(...)
                      → reporter.stage(module, progress) → console.log(...)
                      → reporter.complete(module, status) → console.log(...)
                      → options.onProgress?.(completed, total) → 回到 batch.ts
```

## 2. Empty Catch 块现状

### 2.1 统计

- 总 catch 块数：73
- Empty catch 块数：**26**（35.6%）
- 分布在 14 个文件中

### 2.2 分类

**应当静默降级（21 个）** — 合理，仅需添加 debug 日志：
- `project-context.ts` (3): JSON 解析失败、scanFiles 异常
- `config-reference-generator.ts` (4): 目录不可读
- `api-surface/` 多个文件 (9): 文件读取/解析失败
- 其他 generators (5): 文件扫描异常

**应当上报警告（5 个）** — 需增加 warnings.add()：
1. `data-model-generator.ts` (L578, L599): Python/TS 文件解析失败未记录
2. `event-surface-generator.ts` (L145): 无法解析的 TS/JS 文件
3. `interface-surface-generator.ts` (L198): 无法解析的文件
4. `troubleshooting-generator.ts` (L100): 无法解析的文件
5. `framework-introspection.ts` (L119), `api-surface/index.ts` (L117): 无法解析的文件

**不应吞掉（0 个）** — 无此类问题

### 2.3 现有日志机制

- **无统一 Logger**：不使用 winston/pino
- **warnings 模式**：使用 `warnings: Set<string>` 收集警告，嵌入生成结果
- **无日志级别**：无 debug/info/warn/error 分层
- **无环境变量控制**：无 `REVERSE_SPEC_LOG_LEVEL` 支持

## 3. 项目架构现状

### 3.1 F-094 已完成变更

| Feature | 状态 | 关键变更 |
|---------|------|---------|
| F-094-01 | ✅ | `api-surface-generator.ts` → `src/panoramic/api-surface/` (9 files) |
| F-094-02 | ✅ | 目录重组：models/builders/generators/pipelines/exporters 分层 |
| F-094-03 | ✅ | GeneratorRegistry + ParserRegistry 标准化 |
| F-094-05 | ✅ | `src/config/project-config.ts` + MCP/CLI 参数对称 |

### 3.2 相关目录结构

```
src/panoramic/utils/      — 4 files (llm-enricher, mermaid-helpers, multi-format-writer, template-loader)
                          — logger.ts 不存在，需新建
src/batch/                — 6 files (progress-reporter, batch-orchestrator, checkpoint, ...)
src/cli/commands/         — batch.ts, panoramic.ts, ...
```

### 3.3 测试结构

- `tests/unit/batch-orchestrator.test.ts` — batch 单元测试
- `tests/integration/batch-*.test.ts` — 10+ batch 集成测试
- `tests/panoramic/` — 40+ panoramic 测试文件

## 4. 调研结论

### 与 blueprint 预估的偏差

| 维度 | Blueprint 预估 | 实际情况 |
|------|---------------|---------|
| Empty catch 数量 | 50+ | 26（减少 48%） |
| 需要改动的 catch | 50+ | 26（5 个增加警告，21 个添加 debug 日志） |
| Logger 复杂度 | 分级日志工具 | 可简化，配合现有 warnings 模式 |

### 实现策略建议

1. **Part A 核心改动**：重构 `progress-reporter.ts`，引入 `ProgressMode` (tty/pipe)，统一输出通道
2. **Part B 核心改动**：新建 `src/panoramic/utils/logger.ts`，治理 26 个 empty catch
3. **测试重点**：tty/pipe 模式切换、ANSI 控制码过滤、logger 分级输出
