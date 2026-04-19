# 快速上手指南：Feature 128 新增能力

**Feature Branch**: `128-harden-spec-store`
**适用版本**: 实现完成后（Step H 完成）

---

## 1. Dev 模式热重载

### 适用场景

你是 Spectra 开发者，正在修改 `src/` 下的源代码，希望每次保存后下一次 MCP 调用立即使用新代码。

### 启用方式

**方式 A：命令行参数**（推荐）

```bash
spectra mcp-server --dev
```

**方式 B：环境变量**

```bash
SPECTRA_DEV=1 spectra mcp-server
```

两种方式效果相同。

### 工作机制

启用 dev 模式后，`mcp-server` 命令内部通过 `child_process.spawn('tsx', ['--watch', 'src/mcp/index.ts'])` 运行实际服务，tsx 会监听 `src/` 目录变化并在文件修改后自动重启子进程。

从"保存文件"到"下次 MCP 调用使用新代码"的时间通常 **< 2 秒**（满足 SC-004 要求的 ≤ 5 秒）。

### 语法错误处理

若修改的文件有语法错误，tsx 会在重启时打印错误信息到 stderr：

```
[dev-reload] 重载失败：SyntaxError: Unexpected token at src/batch/batch-orchestrator.ts:42
[dev-reload] 继续使用上一个稳定版本，直到错误修复
```

MCP 服务不会崩溃，会继续用上一个成功构建的版本响应请求。

### 在 Claude Code 中配置

将以下内容加入你的 MCP 配置（`.claude/settings.json` 或 Claude Code 配置）：

```json
{
  "mcpServers": {
    "spectra-dev": {
      "command": "spectra",
      "args": ["mcp-server", "--dev"]
    }
  }
}
```

### CI 禁用

在 CI 环境中 dev 模式自动禁用：当 `process.env.CI === 'true'` 时，即使传了 `--dev` 标志，watcher 也不会启动，进程直接运行生产模式。

你也可以显式禁用：

```bash
SPECTRA_DEV=0 spectra mcp-server
```

---

## 2. 依赖方向自查工具

### 适用场景

你想检查 Spectra 生成的 `graph.json` 中是否存在依赖方向倒置的边（即图中 A→B 但代码里实际是 B→A）。

### 前提条件

先确保已生成 `graph.json`：

```bash
# 方式 1：跑完整 batch（自动生成 graph.json）
spectra batch --force

# 方式 2：仅生成 graph（基于已有 spec 文件）
spectra graph
```

默认输出到 `specs/_meta/graph.json`。

### 运行自查

```bash
# 对当前项目的 graph.json 做方向审计
spectra direction-audit

# 指定 graph.json 路径
spectra direction-audit --graph specs/_meta/graph.json

# 输出 JSON 报告
spectra direction-audit --output specs/_meta/direction-audit-report.json
```

### 解读报告

报告将每条跨模块边分为 3 档：

| 分类 | 含义 | 建议行动 |
|---|---|---|
| `correct` | 方向与 AST import 一致 | 无需处理 |
| `suspicious` | 无直接 import 证据（由 LLM 语义推断产生） | 人工确认 |
| `incorrect` | 方向与 AST import **相反** | 查看 `suspectedStage` 定位根因，提 Fix |

示例控制台输出：

```
Direction Audit Report
======================
Total edges audited: 47
  ✓ correct:     42 (89.4%)
  ? suspicious:   3 (6.4%)
  ✗ incorrect:    2 (4.3%)
  - skipped:      0

INCORRECT edges:
  batch-orchestrator → doc-graph-builder [imports]
    Rationale: AST import 方向为 doc-graph-builder → batch-orchestrator（反向）
    Suspected stage: cross-reference-inference
```

### CI 回归守卫

若发现并修复了方向倒置 bug，可在 CI 中加入快照守卫：

```bash
# 生成当前报告快照
spectra direction-audit --snapshot specs/_meta/direction-audit-snapshot.json

# 之后的 CI 中：比较当前报告与快照，若 incorrect 数增加则失败
spectra direction-audit --compare-snapshot specs/_meta/direction-audit-snapshot.json
```

---

## 3. SpecStore 查询接口（给 Spectra 开发者）

### 适用场景

你正在开发新的消费方（如 F3 Debt Intelligence），需要查询"当前项目所有已知 spec"。

### 注意

SpecStore 是 **内部 API**，仅在 `batch-orchestrator.ts` 的 batch 流程中使用，不对外暴露 MCP 工具接口。

### 使用方式

```typescript
import { SpecStore } from '../spec-store/index.js';

// 在 batch-orchestrator 的步骤 5 初始化（已有 collectedModuleSpecs 和 existingStoredSpecs）
const specStore = new SpecStore({
  currentSpecs: collectedModuleSpecs,
  storedSpecs: existingStoredSpecs,
  projectRoot: resolvedRoot,
  toProjectPath,
});

// 获取所有已知 canonical spec（README 计数、index 生成用这个）
const allSpecs = specStore.allKnownSpecs();

// 获取 graph 构建所需输入
const { moduleSpecs, existingSpecs } = specStore.asDocGraphInput();
const docGraph = buildDocGraph({ projectRoot: resolvedRoot, dependencyGraph: mergedGraph, moduleSpecs, existingSpecs });

// 检查 orphan
const orphans = specStore.orphanSpecs();
if (orphans.length > 0) {
  console.warn(`发现 ${orphans.length} 个 orphan spec（源文件已删除）`);
}
```

### sourceKind 字段说明

bundle 生成工具会在复制 spec 时自动写入 `sourceKind: bundle_copy`，开发者通常不需要手动设置。

若你开发新的衍生产物（如翻译版 spec），在写入时设置：

```yaml
# frontmatter 中
sourceKind: derived
derivedFrom: specs/modules/batch-orchestrator.spec.md
```

设置后，该 spec 会被所有分析器自动忽略（不会混入 canonical spec 的统计），无需修改任何分析器代码（满足 SC-003）。
