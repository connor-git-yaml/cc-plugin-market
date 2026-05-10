# 问题修复报告

## 问题描述

`scripts/eval-task-runner.mjs` 第 469 行：`oracle.command.replace('<workspace>', wtDir)` 只替换第一个 `<workspace>` 占位符。当 `oracle.command` 包含多个 `<workspace>`（例如 `pytest <workspace>/test_a.py <workspace>/test_b.py`），后续占位符不会被替换，导致 shell 命令中保留字面字符串 `<workspace>`，bash 执行时会因找不到路径而失败。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 占位符替换不完整，bash 命令含未展开的 `<workspace>` | `String.prototype.replace` 仅替换第一个匹配 |
| Why 2 | 为什么使用 `replace` 而非 `replaceAll`？ | 初次编写时 oracle.command 约定只含单一占位符，未考虑多个路径场景 |
| Why 3 | 为什么多路径场景未被覆盖？ | unit-test oracle 的 command 格式在设计之初只用于单命令/单工作区路径 |
| Why 4 | 为什么随 Feature 158 加入多路径也没触发发现？ | 现有测试未覆盖 oracle.command 含多个 `<workspace>` 的情形 |
| Why 5 | 为何未被测试捕获？ | `runPrimaryOracle` 的单元测试不完整，缺少多占位符边界用例 |

**Root Cause**: `String.prototype.replace(string, replacement)` 设计上只替换首次匹配；在 `<workspace>` 出现多次的命令中留下未展开占位符。
**Root Cause Chain**: bash 命令路径错误 → 仅替换首个 `<workspace>` → 使用了 `.replace` 而非 `.replaceAll` → 初始设计假设单占位符 → 多路径场景无测试覆盖

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `scripts/eval-task-runner.mjs` | L469 | `oracle.command.replace('<workspace>', wtDir)` | 改为 `.replaceAll('<workspace>', wtDir)` |

### 类似模式（需评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| `scripts/eval-task-runner.mjs` | L182 | `.replace(/\.\w+$/, '')` | 安全——使用正则，不影响多占位符场景 |
| `scripts/eval-task-runner.mjs` | L184 | `.replace(/\.spec\.md$/, '')` | 安全——使用正则，不影响 workspace 替换 |

**全项目搜索结论**：`grep -rn ".replace('<workspace>'"` 仅 L469 一处，无其他同源实例。

### 同步更新清单

- 调用方: 无（`runPrimaryOracle` 是纯工具函数，调用方不需改）
- 测试: 需在现有测试或新增测试文件中补充多占位符边界用例
- 文档: 无需更新

## 修复策略

### 方案 A（推荐）：直接改 `.replaceAll`

```js
// 修复前
oracle.command.replace('<workspace>', wtDir)

// 修复后
oracle.command.replaceAll('<workspace>', wtDir)
```

`String.prototype.replaceAll` 自 Node.js 15 / ECMAScript 2021 标准化，项目已要求 Node 20+，无兼容性风险。

### 方案 B（备选）：正则全局替换

```js
oracle.command.replace(/<workspace>/g, wtDir)
```

功能等价，但可读性不如 `.replaceAll`，不推荐。

## Spec 影响

无需更新现有 spec 文件。

---

## MCP 集成证据

以下为 Phase 1 诊断阶段调用 `mcp__spectra__context` 工具的完整原始响应：

**调用参数**：`symbolId = 'src/knowledge-graph/unified-graph.ts'`

```json
{
  "definition": {
    "id": "/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/eloquent-allen-783dad/src/knowledge-graph/unified-graph.ts",
    "file": "/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/eloquent-allen-783dad/src/knowledge-graph/unified-graph.ts",
    "kind": "module",
    "label": "unified-graph.ts"
  },
  "callers": [],
  "callees": [],
  "imports": []
}
```

callees: []（已确认 mcp 调用成功，当前图谱仅含 depends-on 关系，calls 关系待 Feature 152 ts-callsites 上线后补全）
