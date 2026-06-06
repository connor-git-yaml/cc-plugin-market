# CLI flag 语义边界契约 — F175

**变更文件**: `src/cli/utils/parse-args.ts` — `batch` 子命令 flag 解析

---

## Flag 完整语义矩阵

| Flag | 维度 | 语义 | 与其他 flag 交互 |
|------|------|------|----------------|
| `--full` | regen 轴 | 全量重生成所有模块，绕过 DeltaRegenerator cache | `--full` 优先于 `--incremental`；与 `--mode` 正交 |
| `--force` | regen 轴 | `--full` 的向后兼容别名，行为完全等同 | 同上 |
| `--incremental` | regen 轴 | 显式声明增量（默认即如此，通常无需显式传） | 被 `--full`/`--force` 覆盖 |
| `--mode <value>` | 质量维度 | `full`（完整文档）/ `reading`（轻量）/ `code-only`（纯 AST）| 与 regen 轴参数正交，互不干扰 |

**注意**：`--full`（regen 轴，全量重生成）与 `--mode full`（质量维度，完整文档）**名字相近但含义完全不同**。两者可同时指定：`spectra batch --full --mode reading` 表示"全量重生成所有模块，但用 reading（轻量）质量档"。

---

## `--help` 文案（batch 子命令）

```
spectra batch [options] [target-dir]

选项（regen 轴）：
  --full            全量重生成所有模块（绕过增量 cache）。
                    注：与 --mode full（文档完整度维度）无关。
  --force           同 --full（向后兼容别名）
  --incremental     显式声明增量模式（默认行为，通常无需传）

选项（质量维度）：
  --mode <value>    文档质量维度（与 --full/--force 正交，可同时指定）：
                      full       完整文档（默认）
                      reading    轻量模式，跳过产品文档层
                      code-only  纯 AST 分析，不调用 LLM

其他选项：
  --output-dir <dir>  输出目录（默认 specs/）
  --concurrency <n>   并发处理数
  --languages <list>  仅处理指定语言（逗号分隔）
  --dry-run           估算 token 不实际生成
  --budget <n>        token 预算上限（千 token）
  --no-html           跳过 graph.html 生成
  --hyperedges        启用超边 LLM 提取（默认 off）
```

---

## CLICommand 类型扩展

```typescript
// src/cli/utils/parse-args.ts — CLICommand 接口新增字段
interface CLICommand {
  // ... 现有字段
  force: boolean;          // 已有（保持）
  incremental: boolean;    // 已有（保持，但默认值改为 true，由 resolveRegenPlan 处理）
  full?: boolean;          // 新增：--full flag
}
```

---

## 解析优先级

```
存在 --full 或 --force  →  full=true, incremental=false
存在 --incremental      →  incremental=true, full=false
两者都不存在            →  resolveRegenPlan 返回默认 incremental=true
```

同时传入 `--full --incremental` 时，`--full` 优先（regen 轴全量优先级更高）。
