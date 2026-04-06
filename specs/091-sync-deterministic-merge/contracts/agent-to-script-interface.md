---
contract: agent-to-script-interface
direction: agent → script
created: 2026-04-06
---

# Agent 到脚本调用契约

> 本契约定义 sync Agent 如何调用 `sync-merge-engine.mjs` 以及双方的交互协议。

---

## 1. 调用方式

### 1.1 基本调用

```bash
node "$PLUGIN_DIR/scripts/sync-merge-engine.mjs" --project-root "<absolutePath>"
```

### 1.2 Dry-run 预览

```bash
node "$PLUGIN_DIR/scripts/sync-merge-engine.mjs" --dry-run --project-root "<absolutePath>"
```

### 1.3 JSON 格式输出

```bash
node "$PLUGIN_DIR/scripts/sync-merge-engine.mjs" --json --project-root "<absolutePath>"
```

### 1.4 Dry-run + JSON（组合）

```bash
node "$PLUGIN_DIR/scripts/sync-merge-engine.mjs" --dry-run --json --project-root "<absolutePath>"
```

---

## 2. CLI 参数规范

| 参数 | 必须 | 类型 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--project-root <path>` | 否 | string | `process.cwd()` | 项目根目录的绝对路径 |
| `--dry-run` | 否 | boolean flag | `false` | 不修改任何文件 |
| `--json` | 否 | boolean flag | `false` | JSON 格式输出 |

**参数解析规则**：
- 参数顺序不敏感
- 未知参数静默忽略（不报错）
- `--project-root` 后必须跟一个路径值

---

## 3. 前置条件

Agent 调用脚本前必须确保：

| # | 条件 | 验证方式 | 不满足时 |
|---|------|---------|---------|
| P1 | 脚本文件存在 | `fs.existsSync("$PLUGIN_DIR/scripts/sync-merge-engine.mjs")` | 触发降级路径 |
| P2 | Node.js 可用 | 隐含条件（Claude Code 运行时保证） | 不适用 |
| P3 | project-root 路径有效 | 脚本内部验证 | 脚本返回 exit code 1 + INVALID_PROJECT_ROOT |
| P4 | specs/ 目录存在 | 脚本内部验证 | 脚本返回 exit code 1 + NO_SPECS_DIR |

---

## 4. 交互时序

```
Agent                              sync-merge-engine.mjs
  │                                         │
  │  [1] 检查脚本文件是否存在                  │
  │  ────────────────────────────────────►   │
  │                                         │
  │  [2] 调用脚本（Bash tool）                │
  │  node ... --project-root <path>          │
  │  ────────────────────────────────────►   │
  │                                         │
  │                        [3] 扫描 specs/    │
  │                        [4] 加载映射        │
  │                        [5] 修正 + 差集     │
  │                        [6] 逐产品合并      │
  │                        [7] 验证           │
  │                        [8] 写 mapping     │
  │                            (非 dry-run)   │
  │                                         │
  │  [9] stdout JSON（MergeEngineOutput）     │
  │  ◄────────────────────────────────────   │
  │                                         │
  │  [10] 解析 JSON                          │
  │  [11] 检查 schemaVersion 兼容性           │
  │  [12] 消费 unmappedSpecs → 内容分析推断    │
  │  [13] 基于 mergeSkeleton 执行语义融合      │
  │  [14] 生成 current-spec.md               │
  │                                         │
```

---

## 5. Agent 消费 JSON 的处理流程

### 5.1 schemaVersion 检查

```text
读取 output.schemaVersion
如果 major 版本 != 期望 major 版本:
  → 回退到降级路径
  → 在 trace 中记录: "schemaVersion 不兼容: 期望 1.x.x, 实际 {version}"
如果 minor 或 patch 不同:
  → 正常消费
  → 在 trace 中记录: "schemaVersion 差异: 期望 1.0.0, 实际 {version}"
```

### 5.2 unmappedSpecs 处理

```text
对 output.unmappedSpecs 中的每个 spec:
  1. 读取该 spec 的完整 spec.md 内容
  2. 通过内容分析推断产品归属（LLM 语义判断）
  3. 将归属决策记录到 product-mapping.yaml
  4. 将新归属的 spec 纳入对应产品的 current-spec.md 语义融合
```

### 5.3 mergeSkeleton 消费

```text
对 output.products 中的每个产品:
  1. 读取 mergeSkeleton.chapters（14 章骨架）
  2. 按 product-spec-template.md 的结构，用骨架数据填充
  3. 对每个章节执行语义融合:
     - 第 1 章: 综合所有 spec 描述，提炼产品定位
     - 第 3 章: 合并 userStories，推断用户画像
     - 第 5 章: 合并 functionalRequirements，去重和更新描述
     - 第 12 章: 基于 timeline 生成变更历史
     - 其他章节: 按信息推断规则表处理
  4. 标注 [推断] 或 [待补充]
  5. 写入 current-spec.md
```

### 5.4 warnings 处理

```text
将 output.warnings 合并到 Agent 的聚合报告中。
不阻断流程，仅作为诊断信息展示。
```

---

## 6. 降级触发条件

Agent 在以下任一条件满足时触发降级路径：

| # | 条件 | 检测时机 |
|---|------|---------|
| D1 | 脚本文件不存在 | 调用前检查 |
| D2 | 脚本执行返回 exit code != 0 | 调用后检查 |
| D3 | stdout 不是有效 JSON | 解析 JSON 时 |
| D4 | JSON 中缺少 schemaVersion 字段 | 解析 JSON 后 |
| D5 | schemaVersion major 版本不兼容 | 解析 JSON 后 |
| D6 | JSON 中存在 error 字段 | 解析 JSON 后 |

**降级行为**：

- 在 trace 中记录降级原因和脚本错误信息
- 回退到 091 之前的 LLM 全量合并模式
- 在输出摘要中标注 `[降级: 合并引擎不可用，使用 LLM 全量合并]`
- 降级原因信息格式: `[降级: {D 编号} {具体错误}]`

---

## 7. 并发约束

- sync 流程不支持并发调用（不允许多个 Agent 同时调用合并脚本操作同一 project-root）
- 脚本不做文件锁，依赖编排层保证单一执行
- 执行顺序: 脚本先写 mapping → Agent 读取 → Agent 后续操作

---

## 8. 环境约定

| 项 | 约定 |
|----|------|
| Node.js 版本 | >= 20.x（LTS） |
| 文件编码 | UTF-8 |
| 路径分隔符 | 脚本内部统一使用 POSIX（`/`） |
| 工作目录 | 不依赖 cwd，所有路径通过 `--project-root` 参数传入 |
| 超时 | 编排层设定，建议 30 秒（当前 spec 数量 ~90 个，预期 <1s） |
