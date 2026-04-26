---
required: false
mode: fix
points_count: 2
tools: ["openrouter-perplexity/web_search"]
queries:
  - "Anthropic Claude Sonnet 4.6 latest model id API release date 2026"
  - "Anthropic Claude Opus 4.7 1M context window beta header model id"
findings:
  - "Sonnet 4.6 model id: claude-sonnet-4-6（2026-02-17 发布，1M context GA 2026-03）"
  - "Opus 4.7 model id: claude-opus-4-7（2026-04-16 发布，1M context 默认可用，无需专用 beta header）"
  - "Opus 4.7 max output 128k；300k 需 beta header output-300k-2026-03-24（本次不涉及）"
  - "Sonnet 4.6 定价 $3/$15 per MTok；Opus 4.7 定价 $5/$25 per MTok（参考用，本次不修改 cost-summary 价格表）"
impacts_on_fix:
  - "P0-3 实施时 DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-6'（不带日期后缀，符合 Anthropic 新规范）"
  - "P0-3 实施时 LOGICAL_CLAUDE_MODEL_MAP.opus = 'claude-opus-4-7'"
  - "P0-3 实施时 PRESET_MODEL_MAP.balanced = 'sonnet'（修复用户决策）"
  - "1M context 不需要 beta header — 可省略 llm-client.ts 的 beta header 注入逻辑（启动 prompt 的猜测被否决）"
  - "DEFAULT_CODEX_ALIASES 表中已有 'claude-opus-4-6' 入口（L44），需更新或保留作为历史兼容"
skip_reason: ""
---

# 在线调研报告 — Anthropic 最新 Model ID 确认

## 调研目标

P0-3 修复需要把：
- `DEFAULT_CLAUDE_MODEL` 升级到最新 Sonnet 版本
- `LOGICAL_CLAUDE_MODEL_MAP.opus` 升级到最新 Opus 1M context 版本

启动 prompt 推测的逻辑名是 "Sonnet 4.6" 和 "Opus 4.7"，但具体 model id 字符串和是否需要 1M context 的 beta header 都不明，需要从 Anthropic 官方文档确认。

## 调研点 1：Sonnet 4.6

**查询**: `Anthropic Claude Sonnet 4.6 latest model id API release date 2026`

**关键发现**:
- API Model ID: **`claude-sonnet-4-6`**（不带日期后缀，符合 Anthropic 4.x 系列新命名规范）
- 发布日期: 2026-02-17
- 1M token context window（beta at launch, GA by 2026-03）
- 定价: $3 / MTok input, $15 / MTok output
- 来源: anthropic.com/news/claude-sonnet-4-6, anthropic.com/claude/sonnet

## 调研点 2：Opus 4.7 1M

**查询**: `Anthropic Claude Opus 4.7 1M context window beta header model id`

**关键发现**:
- API Model ID: **`claude-opus-4-7`**
- 发布日期: 2026-04-16（10 天前）
- Context window: 1M tokens（默认可用，**无需专用 beta header**）
- Max output: 128k tokens（300k 需 beta header `output-300k-2026-03-24`，本次 fix 不涉及）
- 定价: $5 / MTok input, $25 / MTok output
- 来源: anthropic.com/news/claude-opus-4-7, platform.claude.com/docs/en/about-claude/models/

## 对 P0-3 实施的影响

### 修改对照表

| 文件位置 | 旧值 | 新值 |
|----------|------|------|
| `src/core/model-selection.ts:6` `DEFAULT_CLAUDE_MODEL` | `'claude-sonnet-4-5-20250929'` | `'claude-sonnet-4-6'` |
| `src/core/model-selection.ts:10` `LOGICAL_CLAUDE_MODEL_MAP.opus` | `'claude-opus-4-1-20250805'` | `'claude-opus-4-7'` |
| `src/core/model-selection.ts:22` `PRESET_MODEL_MAP.balanced` | `'opus'` | `'sonnet'` |
| `src/core/model-selection.ts:44` `DEFAULT_CODEX_ALIASES['claude-opus-4-6']` | 已存在条目 | 改为 `'claude-opus-4-7'`（保持当前最新映射） |

### llm-client.ts 简化

启动 prompt 推测"1M context 可能需要单独 beta header"——本次调研**否决了这个推测**：Opus 4.7 默认即可使用 1M context，无需额外 beta header。

→ 实施时 **不需要** 在 `llm-client.ts` 增加按 model id 动态注入 beta header 的逻辑，简化了 P0-3 的实施面。

### 超时策略影响（getTimeoutForModel）

`src/core/llm-client.ts:133-141` 的 `getTimeoutForModel()` 用 `lowerModel.includes('opus' / 'sonnet' / 'haiku')` 判断模型族——新 model id `claude-opus-4-7` / `claude-sonnet-4-6` 仍包含 `opus` / `sonnet` 子串，**超时策略无需调整**。

### Codex 别名映射

`DEFAULT_CODEX_ALIASES` 第 44 行有 `'claude-opus-4-6': DEFAULT_CODEX_MODEL` 条目。建议改为 `'claude-opus-4-7'` 以匹配新版本，保持 Codex 运行时映射的一致性。

## CHANGELOG 文案建议

```markdown
### Breaking changes

- 默认 Claude 模型升级：
  - `DEFAULT_CLAUDE_MODEL`: `claude-sonnet-4-5-20250929` → `claude-sonnet-4-6`
  - 逻辑名 `opus`: `claude-opus-4-1-20250805` → `claude-opus-4-7`（自带 1M context）
  - `balanced` preset 现映射到 `sonnet`（不再是 `opus`），与 `cost-efficient` 等价；`quality-first` 仍指 `opus`
- 影响：未显式指定 model 的项目，下次运行会切换到新模型。建议显式 pin model 以避免漂移
```
