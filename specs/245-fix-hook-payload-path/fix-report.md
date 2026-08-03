# 问题修复报告

## 问题描述

`plugins/spec-driver/hooks/pre-tool-use-guard.sh` 的用途是「活跃 spec-driver 工作流中阻止对 `src/` 的直接编辑」，但它从**顶层** `.file_path` 取值，而 Claude Code / Codex 的 PreToolUse payload 把 `file_path` 嵌套在 `tool_input` 之下 → 顶层取值恒为空 → 第 19 行 `[ -z "$FILE_PATH" ] && exit 0` 恒放行。门禁自 F084 引入以来从未真正生效。同目录 `post-tool-use-format.sh` 存在同一取值缺陷（prettier 格式化同样从未生效）。零测试覆盖是长期未被发现的根因（F240 调研期间实测发现，明确排除在 F240 范围外，独立成本 fix）。

**本 worktree 复现实测（2026-08-03，修复前基线）**：

| 场景 | payload | 实际结果 | 判定 |
|------|---------|---------|------|
| A | 嵌套（真实形状）`tool_input.file_path=src/core/foo.ts` | exit 0 放行 | ❌ 缺陷确证 |
| B | 扁平（对照）顶层 `file_path=src/core/foo.ts` | exit 2 阻断 | 后半段逻辑可达 |
| C | post-format 同 payload 顶层取值 | 空输出 | ❌ 同病确证 |

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 恒放行为何发生？ | `FILE_PATH` 恒为空，命中 L19 `[ -z ] && exit 0` 提前放行 |
| Why 2 | 为何恒为空？ | jq 读**顶层** `.file_path`（L13），而真实 PreToolUse payload 把 `file_path` 嵌套在 `tool_input` 对象下，顶层不存在该键 |
| Why 3 | 为何写成顶层取值？ | F084（harness-native-integration）实现 hook 时按"扁平 payload"假设编写，未对照 Claude Code hooks 官方 payload schema（`tool_input` 包裹），也未用真实 harness payload 实测过一次 |
| Why 4 | 错误假设为何长期存活？ | 该 hook 零测试覆盖（全仓 grep 无任何测试引用）；且 PreToolUse exit 0 时 stdout/stderr 不回注模型、不展示用户（F208 harness-verification 已证实的观察盲区），恒放行在使用侧完全无信号 |
| Why 5 | 测试/监控盲区为何存在？ | `test:plugins` 合同只覆盖 `scripts/*.mjs` 判定器与工具链，`hooks/*.sh` 不在测试面内；门禁类 hook 的"生效性"没有对应质量门——F208 只为 Stop hook 建了判定器+测试，PreToolUse/PostToolUse 两个 hook 被遗漏 |

**Root Cause**: hook 按扁平 payload 假设从顶层取 `file_path`，与真实 harness 的 `tool_input` 嵌套形状不符，且 hooks 目录零测试 + exit 0 无信号使恒放行无从暴露。
**Root Cause Chain**: 恒放行 → FILE_PATH 恒空 → 顶层取值 vs `tool_input` 嵌套错位 → 实现时未对照真实 payload schema → 零测试 + exit 0 观察盲区 → hooks 不在测试合同、门禁生效性无质量门。
`[ROOT CAUSE REACHED at Why 5]`

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| plugins/spec-driver/hooks/pre-tool-use-guard.sh | L13 | jq 顶层 `.file_path` 取值 | 改为 `.tool_input.file_path // .file_path`（优先嵌套，保留扁平兼容） |
| plugins/spec-driver/hooks/pre-tool-use-guard.sh | L15 | grep 降级分支抓 payload 内**任意位置**首个 `"file_path"` | 加 tool_name 门槛（非 Edit/Write 类直接放行），防从 Bash `tool_input.command` 命令字符串误抓（Codex 桥接场景 tool_name=Bash 时命令串可含 `"file_path"` 文本） |
| plugins/spec-driver/hooks/post-tool-use-format.sh | L12/L14 | 同一顶层取值 + 同一 grep 全文误抓 | 同步修复两分支 |

### 类似模式（需评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| plugins/spec-driver/hooks/stop-fix-compliance-check.sh | 全文 | payload 整体转发 Node CLI 结构化解析 | [安全] 无顶层取值缺陷 |
| plugins/spec-driver/hooks/stop-task-check.sh | 全文 | 不解析 payload | [安全] |

### ⚠️ 修复取值后将被"激活"的三个隐性缺陷（沉默门禁突然生效的影响面，必须同批处置）

1. **活跃判定恒真 → 门禁从"恒放行"翻转成"恒阻断"**：L27-35 扫**全仓** `specs/*/tasks.md` 任一含 `- [ ]` 即判活跃。本仓实测 **65/215** 个历史 tasks.md 有残留未完成任务（任何用过 spec-driver 一段时间的项目都是常态）。只修取值 = src/** 的直接 Edit/Write 被永久 exit 2。
2. **阻断无差别命中 implement 子代理 → spec-driver 自我死锁**：PreToolUse hook 对子代理（Task sidechain）的 Edit/Write 同样触发，payload 无字段可区分主线程与 implement 子代理。门禁 stderr 让人"通过 spec-driver implement 阶段修改代码"，但 implement 子代理自己的 Edit 也会被同一门禁拦下 → 流程死锁。直接启用阻断不可接受。
3. **post-format 激活 = 意外格式化面**：修好取值后每次 Edit/Write JS/TS/JSON 都会 `npx prettier --write`。本仓库**无 prettier 配置也无 prettier 依赖**（实测 `.prettierrc*` 不存在、package.json 不含 `"prettier"` 键/依赖）——npx 会临时安装并按**默认规则**重排整个文件，产生大规模意外 diff + 网络开销。无 prettier 配置的用户项目同理。

### 同步更新清单

- 调用方: 无（hooks.json matcher `Edit|Write` 不变；hook 由 harness 直接调用）
- 测试: 新增 `plugins/spec-driver/tests/pre-tool-use-guard.test.mjs` 与 `plugins/spec-driver/tests/post-tool-use-format.test.mjs`（node:test，spawn bash 喂 stdin 断言退出码/stderr；覆盖嵌套/扁平/非 src/无 file_path/畸形 JSON/无 jq 降级/Bash 命令串误抓防御）
- 文档: 无独立 hook 行为文档（全仓 grep 仅 specs 历史制品与 hooks.json 引用）；行为矩阵记录在本 fix 制品内
- 版本: `contracts/release-contract.yaml` spec-driver 4.4.0 → 4.4.1（fix→patch）+ `npm run release:sync`

## 修复策略

### 方案 A（推荐）——三层修复：取值修复 + 判定收窄 + 安全默认

1. **取值修复（两脚本 × 两分支）**：jq 分支改 `.tool_input.file_path // .file_path // empty`（优先真实嵌套形状，保留扁平兼容以不回归对照场景 B 及自定义桥接）；grep 降级分支先用 grep 判 `tool_name` ∈ {Edit,Write,MultiEdit}（含子串匹配的 NotebookEdit 无 file_path 自然放行），非编辑类工具直接 exit 0，再抓 `file_path`——结构化 jq 分支天然不误抓 Bash `command` 字符串，grep 分支靠 tool_name 门槛达到同等防御。
2. **活跃判定收窄**：从"全仓任一 tasks.md 有未完成任务"改为"**当前 git 分支对应的 spec 目录**（`specs/$(git branch --show-current)/tasks.md`）存在且含 `- [ ]`"。分支↔目录 `NNN-short-name` 精确对应是 create-new-feature.sh 既有约定。master/worktree 临时分支/detached HEAD → 无对应目录 → 放行（fail-open）。语义变为"我正位于某 feature 分支且该 feature 有未完成任务 → src/ 改动应走 implement"，历史残留不再误伤。
3. **安全默认（灰度开关）**：pre-guard 默认 **warn-only**（stderr 提示 + exit 0，信号可观测但不阻断），仅当 `SPEC_DRIVER_SRC_GUARD=block` 时 exit 2 阻断——因缺陷 2（implement 子代理无差别命中）在 hook payload 现状下无解，默认阻断必然死锁；显式 opt-in 把选择权留给清楚该限制的用户。post-format 增加"项目存在 prettier 配置（`.prettierrc*`/`prettier.config.*`/package.json 含 `"prettier"` 键或依赖——宽信号，含 devDependencies 里的依赖声明）才执行"门槛——出现该信号即项目明确接受 prettier 约定，杜绝 npx 临时安装 + 默认规则重排的意外面。
4. **补测试**（见同步更新清单）：hooks 首次纳入 `test:plugins` 测试面，堵 Why 4/Why 5 的盲区。

### 方案 B（备选，已否决）——只修取值，保留原判定与直接阻断

改动最小（两行 jq 表达式），但立即触发被激活缺陷 1+2：本仓及所有存量用户项目瞬间进入"恒阻断"，且 spec-driver 自己的 implement 阶段死锁。**否决理由：修复的收益（门禁生效）小于其引入的回归（工作流全面中断）。**

## Spec 影响

- 需要更新的 spec: 无独立 hook spec 文件。F084 历史制品不回改（历史事实）。本 fix 的行为矩阵与灰度约定落在 `specs/245-fix-hook-payload-path/` 制品内。
- 行为矩阵（修复后 pre-guard）：

| 场景 | 默认（warn） | `SPEC_DRIVER_SRC_GUARD=block` |
|------|-------------|------------------------------|
| 嵌套 payload + src/ + 当前分支 spec 有未完成任务 | stderr 警示 + exit 0 | stderr + **exit 2** |
| 嵌套 payload + src/ + 无当前分支 spec 或任务已清 | exit 0 | exit 0 |
| 嵌套 payload + 非 src/ 路径 | exit 0 | exit 0 |
| 无 file_path（Bash/NotebookEdit 等） | exit 0 | exit 0 |
| 畸形 JSON / jq 与 grep 均取不到值 | exit 0（fail-open） | exit 0 |
| 无 jq（grep 降级）+ tool_name 非编辑类 | exit 0 | exit 0 |

- 行为矩阵（修复后 post-format）：项目有 prettier 配置 + JS/TS/JSON 文件 → `npx prettier --write`；无配置 → 静默放行；其余同前（fail-open，恒 exit 0）。
