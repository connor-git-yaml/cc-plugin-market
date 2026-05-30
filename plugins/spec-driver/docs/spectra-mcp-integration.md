# Spectra MCP 集成指引

本文档说明如何将 **Spectra** 和 **Spec Driver** 两个 Claude Code plugin 协同部署，让 spec-driver 的 sub-agent 能够调用 spectra 的 MCP 工具（`impact` / `context` / `detect_changes`）。

---

## 一、为什么需要协同部署

Spec Driver 的核心 sub-agent（`plan` / `implement` / `verify` / `spec-review` / `quality-review`）在工作时需要感知代码库的符号依赖关系。这些能力由 Spectra 的 MCP 工具提供：

| Spectra MCP 工具 | 用途 |
|-----------------|------|
| `mcp__plugin_spectra_spectra__context` | 获取指定符号的 360° 上下文（定义 + 调用方 + 被调用方 + 相关 spec） |
| `mcp__plugin_spectra_spectra__impact` | blast radius 分析 — 反向 BFS 找受影响的所有符号 |
| `mcp__plugin_spectra_spectra__detect_changes` | git diff → changedSymbols → impact 链 |

---

## 二、为什么 namespace 是 `mcp__plugin_spectra_spectra__*`

Claude Code plugin 系统会根据以下规则自动生成 MCP 工具的命名空间：

```
mcp__plugin_{plugin-name}_{mcp-server-name}__{tool-name}
```

对于 spectra plugin：
- **plugin-name**: `spectra`（`plugin.json` 中的 `name` 字段）
- **mcp-server-name**: `spectra`（`.mcp.json` 中的 server key）
- **tool-name**: `context` / `impact` / `detect_changes`

因此完整 namespace 为 `mcp__plugin_spectra_spectra__context` 等。

> **长期 follow-up**: Anthropic 正在讨论 plugin `namespaceStrategy` RFC，未来可能允许插件声明简洁 namespace（如 `mcp__spectra__*`）。RFC 落地后可将 sub-agent frontmatter 改回简洁版本。

---

## 三、2 步开箱即用部署

### Step 1: 安装两个 plugin

```bash
claude plugin install spectra
claude plugin install spec-driver
```

或从本仓库本地安装：

```bash
claude plugin install ./plugins/spectra
claude plugin install ./plugins/spec-driver
```

### Step 2: 验证安装

在 Claude Code 中运行：

```
/spec-driver:spec-driver-feature 描述一个简单需求
```

如果 `plan` sub-agent 能够在分析时调用 `mcp__plugin_spectra_spectra__context`，则集成成功。

无需任何额外配置——sub-agent 的 frontmatter 已预置正确 plugin namespace。

---

## 四、故障排查

### 问题 1: `plugin:spectra:spectra:failed` 或 MCP server 启动失败

**可能原因**：
- spectra-cli 版本过旧（< 4.2.0），缺少 Feature 155 agent-context tools
- volta / node 版本不兼容

**排查步骤**：

```bash
# 检查当前安装版本
spectra --version

# 应为 4.2.0+，否则更新
npm install -g spectra-cli@latest

# 验证 agent-context-tools 已包含
ls $(npm root -g)/spectra-cli/dist/mcp/agent-context-tools.js
```

### 问题 2: sub-agent 提示"工具 mcp__plugin_spectra_spectra__context 不可用"

**可能原因**：
1. spectra plugin 未安装 → 执行 Step 1 安装
2. spectra MCP server 启动失败 → 查看 `claude plugin status spectra`
3. 当前项目没有 spectra graph 缓存 → 先运行 `spectra run .` 生成 graph

**快速验证**：

```bash
# 确认 spectra plugin 正常
claude plugin status spectra

# 手动生成 graph（首次使用需要）
spectra run .
```

### 问题 3: fork 了 spectra plugin，namespace 不一致

如果你 fork 了 spectra plugin 并改名（如 `my-spectra-fork`），sub-agent 需要使用不同的 namespace。

详见 [customization.md](./customization.md)。

---

## 五、验证矩阵

| 验证项 | 命令 | 预期结果 |
|--------|------|----------|
| spectra 版本 | `spectra --version` | `4.2.0` |
| agent-context-tools 存在 | `ls $(npm root -g)/spectra-cli/dist/mcp/` | 含 `agent-context-tools.js` |
| spectra plugin 状态 | `claude plugin status spectra` | `active` |
| spec-driver sub-agent namespace | grep frontmatter | 含 `mcp__plugin_spectra_spectra__` |

---

## 七、Driver 偏好引导设计（F170d）

### 为什么需要这层引导

F170c 实测（host shell N=10×4 轮）发现：driver（Claude Sonnet 4.6）在「评估 symbol 改动影响」类任务上 **0/10 主动调用** spectra `impact`，而是默认 1 Read + 6 Grep。即使把 tool description 升级到 100-500 字 + 4 要素 + 显式 chained usage，主动调用率仍是 **0%**。

**业务洞察**：tool description 只提供「理论可用性」（这个工具能做什么），不能改变 driver 的工具选择**偏好**。Grep 是 Anthropic 训练数据中 caller-analysis 的默认工具，cognitive overhead 更低。要改变偏好，必须在 **prompt level** 提供「任务匹配性」引导——明确告诉 driver「什么任务该用什么工具」。

F170d 因此在两处注入引导：
1. **5 个 sub-agent**（plan / implement / verify / spec-review / quality-review）的 prompt body 内嵌「工具优先使用规则」表（按各 agent frontmatter `tools` 过滤）。agent body 即 Claude Code 子代理的 system prompt，故引导随子代理上下文抵达 driver。
2. **5 个主编排器 SKILL.md** 的「子代理调度时的工具优先级提示」块，要求编排器 dispatch 时在 `Task()` prompt 中显式带上工具优先级提示。

### 单一事实源与一致性守护

引导文案的 canonical source 是 [`templates/preference-rules.md`](../templates/preference-rules.md)（R1-R4 规则 + 关键原则，anchor 标记）。三处消费方（agent 文件 / SKILL 提示 / F170d harness 注入）都从它派生：

- **生成**：`node plugins/spec-driver/scripts/sync-preference-rules.mjs --write` 按各 agent `tools` 过滤渲染并写入 `<!-- BEGIN/END preference-rules -->` 之间。
- **守护**：`npm run repo:check` 的 `preference-rules:agent-block-sync` 检测漂移（同 `--check`），保证 5 个 agent 块永不与单一源脱节。

### 度量诚实声明（guided vs spontaneous）

F170d 的 SC-002 度量命名为 **guided active-call rate**：它测的是「引导送达 driver 后，driver 是否遵循引导改用 MCP」，**不等于** F170c 测的「spontaneous preference（内在偏好）」。0%（无引导）→ ≥50%（有引导）的对比意义是 **「prompt 层引导能驱动 driver 改用 MCP」**，不宣称「模型内在偏好被改变」。

### fork 用户自定义（override 机制）

fork 用户想调整引导文案（增删规则行、改语气 SHOULD↔MUST、换工具优先级）：

1. 编辑 `plugins/spec-driver/templates/preference-rules.md` 的 `block-start`/`block-end` 之间内容（保持 anchor 契约 `<!-- preference-rules:R# tool=xxx -->`）。
2. 跑 `node plugins/spec-driver/scripts/sync-preference-rules.mjs --write` 重新生成 5 个 agent 块（按各自 tools 自动过滤）。
3. 跑 `npm run repo:check` 确认 `preference-rules:agent-block-sync` 通过。

无需改任何脚本逻辑——template 是唯一需要编辑的文件。

---

## 八、相关资源

- [Spectra MCP Server 源码](../../src/mcp/server.ts)
- [fork 用户定制指引](./customization.md)
- [Milestone M7 设计文档](../../docs/design/milestone-M7-spectra-mcp-productization.md)
- [F170d spec](../../specs/170d-driver-preference-shaping/spec.md) · [preference-rules 单一源](../templates/preference-rules.md)
