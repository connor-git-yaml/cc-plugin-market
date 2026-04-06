---
contract: merge-engine-output
direction: script → agent
schemaVersion: "1.0.0"
created: 2026-04-06
---

# 合并引擎输出契约（脚本 -> Agent）

> 本契约定义 `sync-merge-engine.mjs` 通过 stdout 输出的 JSON 结构。
> Agent Prompt 中声明期望的 schemaVersion，脚本输出包含实际 schemaVersion。

---

## 1. 通信方式

- **传输**: stdout（JSON 字符串，单行或 pretty-print 均可）
- **编码**: UTF-8
- **触发**: Agent 调用 `node $PLUGIN_DIR/scripts/sync-merge-engine.mjs --project-root <path> [--dry-run] [--json]`
- **成功**: exit code 0，stdout 为有效 JSON
- **失败**: exit code 1，stdout 为错误 JSON（见第 5 节）

---

## 2. 正常模式输出（exit code 0）

```jsonc
{
  // [必须] 接口版本号，语义化版本
  "schemaVersion": "1.0.0",

  // [必须] 各产品的合并结果
  "products": {
    "<productId>": {
      "productId": "<string>",

      // 时间线
      "timeline": {
        "productId": "<string>",
        "entries": [
          {
            "specId": "<string>",       // 如 "091"
            "dirName": "<string>",      // 如 "091-sync-deterministic-merge"
            "type": "<SpecType>",       // INITIAL | FEATURE | FIX | REFACTOR | ENHANCEMENT
            "title": "<string|null>",
            "summary": "<string|null>"
          }
        ],
        "stats": {
          "INITIAL": 0,
          "FEATURE": 0,
          "FIX": 0,
          "REFACTOR": 0,
          "ENHANCEMENT": 0
        }
      },

      // 合并骨架
      "mergeSkeleton": {
        "productId": "<string>",
        "chapters": {
          "1": {
            "title": "产品概述",
            "number": 1,
            "functionalRequirements": [],
            "userStories": [],
            "sourceSpecs": ["<specId>", ...],
            "changeSummary": "<string>"
          },
          // ... 2-14 章结构相同
        },
        "mergeStats": {
          "activeFRCount": 0,
          "supersededFRCount": 0,
          "deprecatedFRCount": 0,
          "userStoryCount": 0,
          "totalSpecCount": 0
        }
      },

      // 冲突记录
      "conflicts": [
        {
          "subject": "<string>",   // 冲突涉及的功能标识
          "winner": "<specId>",    // 胜出方（编号更大）
          "loser": "<specId>",     // 被取代方
          "reason": "<string>"     // 冲突原因描述
        }
      ],

      // 验证报告
      "validation": {
        "productId": "<string>",
        "passed": true,
        "checks": [
          {
            "name": "fr-count",           // | no-contradiction | changelog-coverage
            "passed": true,
            "detail": "<string>",
            "data": { /* 键值对 */ }
          }
        ]
      }
    }
  },

  // [必须] 未映射 spec 列表（需 Agent 推断归属）
  "unmappedSpecs": [
    {
      "specId": "<string>",
      "dirName": "<string>",
      "title": "<string|null>",
      "summary": "<string|null>"
    }
  ],

  // [必须] 验证结果汇总
  "validation": {
    "allPassed": true,
    "reports": [ /* ValidationReport[] */ ]
  },

  // [必须] 警告列表
  "warnings": ["<string>", ...],

  // [必须] 统计摘要
  "stats": {
    "totalProducts": 0,
    "totalSpecs": 0,
    "totalActiveFR": 0,
    "totalConflicts": 0,
    "executionTimeMs": 0
  }
}
```

---

## 3. Dry-run 模式输出

当使用 `--dry-run` 参数时，输出结构在顶层增加 `"dryRun": true` 字段，其余结构与正常模式相同。**不修改任何文件**。

不带 `--json` 时，默认输出人类可读的混合格式（统计摘要 + 关键变更列表），格式参见 tech-research.md 第 4 节。

带 `--json` 时，输出与正常模式相同结构的 JSON，额外增加 `"dryRun": true`。

---

## 4. schemaVersion 兼容性规则

| 场景 | Agent 行为 |
|------|-----------|
| Agent 期望 `1.x.x`，脚本输出 `1.0.0` | 正常消费 |
| Agent 期望 `1.x.x`，脚本输出 `1.2.0` | 正常消费，trace 中记录 minor 版本差异警告 |
| Agent 期望 `1.x.x`，脚本输出 `2.0.0` | **回退到降级路径**（major 版本不兼容） |
| 脚本输出中缺少 `schemaVersion` 字段 | **回退到降级路径** |

**Agent Prompt 中的声明格式**：

```markdown
期望 schemaVersion: 1.x.x（兼容 minor/patch 升级）
```

---

## 5. 错误输出（exit code 1）

```jsonc
{
  "error": "<中文错误描述>",
  "code": "<ERROR_CODE>"
}
```

**已定义的错误码**：

| 错误码 | 含义 | Agent 行为 |
|--------|------|-----------|
| `INVALID_PROJECT_ROOT` | --project-root 指向不存在的路径 | 回退到降级路径 |
| `NO_SPECS_DIR` | specs/ 目录不存在 | 回退到降级路径 |
| `PARSE_ERROR` | YAML/Markdown 解析出现不可恢复错误 | 回退到降级路径 |

---

## 6. 14 章标题映射

脚本输出的 `chapters` key 与 product-spec-template.md 14 章的对应关系：

| key | 章节标题 | 主要内容类型 |
|-----|---------|-------------|
| `"1"` | 产品概述 | 综合描述 |
| `"2"` | 目标与成功指标 | KPI 提取 |
| `"3"` | 用户画像与场景 | User Stories 聚合 |
| `"4"` | 范围与边界 | Constraints 合并 |
| `"5"` | 当前功能全集 | FR 合并（核心章节） |
| `"6"` | 非功能需求 | NFR 聚合 |
| `"7"` | 当前技术架构 | 架构提取 |
| `"8"` | 设计原则与决策记录 | ADR 提取 |
| `"9"` | 已知限制与技术债 | 限制汇总 |
| `"10"` | 假设与风险 | 风险矩阵 |
| `"11"` | 被废弃的功能 | 废弃记录 |
| `"12"` | 变更历史 | Changelog |
| `"13"` | 术语表 | 术语收集 |
| `"14"` | 附录：增量 spec 索引 | 文件链接 |

---

## 7. 脚本写入范围

### 正常模式（非 dry-run）

| 写入目标 | 条件 | 内容 |
|---------|------|------|
| `specs/products/product-mapping.yaml` | 差集更新或产品名修正触发 | 更新后的完整 product-mapping.yaml |

**明确不写入**：
- `current-spec.md` — 由 Agent 根据脚本 JSON + 语义融合后写入
- `entity.yaml` / `catalog-index.yaml` — 由后置 helper 生成
- 任何 spec 源文件 — 只读

### Dry-run 模式

不写入任何文件。
