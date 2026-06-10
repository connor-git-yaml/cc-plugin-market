---
feature: 176
artifact: m8-fix-candidates
purpose: FR-D-001/002/003 — F176 dogfooding 工具使用反馈（四维度）+ 转 M8/Fix 候选
status: 待 host 跑 cohort 3 后填实测发现；本文件为模板 + 已知项
---

# F176 Dogfooding 工具使用反馈 + M8/Fix 候选

> 约定（FR-D-003）：F176 内**不改** Spectra / Spec Driver 工具源码；真实问题只记录在此，转 M8 或后续 Fix。
> 四维度逐项写，未遇到写"无"。

## A. Spec Driver（跑"评测执行+报告"类需求的编排体验）

| 维度 | 观察 | 去向 |
|------|------|------|
| 可用性 | <!-- 5 阶段编排/gate/产物是否顺手 --> | |
| 信息完整性 | <!-- gate 提示/trace 是否够判断 --> | |
| 流程顺畅度 | <!-- 有无卡点/冗余；spike-first 这类硬 gate 是否自然 --> | |
| 结果准确性 | <!-- 产物是否对 --> | |

### 设计阶段已观察（本会话实录，非 host 跑）
- orchestrator-cli.mjs 在 plugin cache 缺 zod 依赖 → `get-phases` 等命令 ERR_MODULE_NOT_FOUND，编排器 CLI 不可用（已用内置 fallback phase 序列绕过）。**去向：M8/Fix —— plugin cache 应自带 zod 或 CLI 优雅降级**。

## B. Spectra MCP（cohort 3 真实调用 17 工具）

| 维度 | 观察 | 去向 |
|------|------|------|
| 可用性 | <!-- 连接/工具缺失/调用报错/namespace（mcp__plugin_spectra_spectra__*）--> | |
| 信息完整性 | <!-- 返回字段缺失/上下文不全/缺 next-step hint --> | |
| 流程顺畅度 | <!-- 多工具链路是否顺；impact→context→detect 串联 --> | |
| 结果准确性 | <!-- impact/graph/fuzzy 结果是否准 --> | |

### 已观察（本会话）
- `spectra --version` 对本地含 F177-F181 的 build 与 npm 旧版**都报 v4.2.0** → 无法靠版本号区分 MCP 层是否含最新改动（本 Feature 用 commit 盖章 + dist sha256 门禁绕过）。**去向：M8/Fix —— build 应嵌入可区分的 build 元数据（commit/feature flag）到 --version**。
- spectra CLI 走 volta 时 MCP server 易 status:failed（memory 既有记录）；本 Feature cohort 3 用本地 build dist + node 绝对路径绕过。**去向：M8 —— MCP server 启动鲁棒性**。

### spike 阶段实测新增（2026-06-09/10 host 4 轮）
- **✅ 正向信号（产品验证）**：plugin-namespace MCP（`mcp__plugin_spectra_spectra__*`）在 `claude --print` 非交互下**真实传播到 Task 子代理**（parent_tool_use_id 实证）——F170a 产品化路径成立。`context` 返回含 `definition/callers/topRelevantCallers/nextStepHint`，子代理能按 nextStepHint 链式思考（"修改 add 前可调 impact"）——**F170c 设计在真实子代理场景生效**。
- 全局已装 spectra plugin 与 `--plugin-dir` 注入的同名本地 plugin 并存时，**claude CLI 无第一方机制声明加载优先级**，实际加载哪个 build 不可证 → 评测须人工禁用全局 plugin（runbook 步骤 3）。**去向：M8 —— 产品文档写明 plugin 同名冲突行为；或 spectra plugin 支持版本化命名**。
- claude CLI sharp edge（非 spectra 问题，记录供后续 eval 设施参考）：`--allowedTools` 是 variadic，会把末尾位置参数 prompt 吞掉（exit 1 "Input must be provided..."）→ prompt 必须走 stdin。**legacy mcp-pull cohort（F158）在 claude 2.1.158 上大概率同样踩此坑**（其 args 同形态）。**去向：Fix 候选 —— 若复跑 Lite eval 先验证 mcp-pull 在新 CLI 下可用**。
- spectra `batch --mode code-only` 在 8-node 微型 repo 上 <30s 出 graph.json，输入门槛低（spike 输入准备零障碍）——正向。
- claude CLI plugin 开关实测（2026-06-10，供评测/CI 设施参考）：`claude plugin disable <name> --scope user` 落盘 `~/.claude/settings.json` 的 `enabledPlugins[<name>]: false`；**`--scope project` 的 enable/disable 直接写入库的 `.claude/settings.json`**（会污染 git 工作区，差点被误 commit）；未列于 enabledPlugins 但 installed 的 plugin 默认启用。**去向：记录为评测设施注意事项（F176 检测已按此实现）**。

### smoke 首轮实测新增（2026-06-10 host，5 真实 opus run）
- **🔴 已发布 spec-driver 4.1.0 不含 F170a**（黄金发现）：marketplace 安装版的 agents frontmatter 仍是旧 namespace（`mcp__spectra__context/impact`），typed 子代理 tools 白名单里**没有** `mcp__plugin_spectra_spectra__*` → **真实开箱用户的 spec-driver 子代理物理上调不到 spectra MCP**。仓内源已修（F170a），但没发版。**去向：M8 最高优先 —— 发 spec-driver 4.1.1/4.2.0（含 F170a agents），否则 F170a 产品化白做**。
- **`--print` 下 prompt 提及 workflow ≠ 真实 workflow**：cohort2/3 旧 prompt（"请使用 spec-driver-fix workflow…"）实测 Task spawn=0、全程 inline、plugin MCP 17 工具可见但 0 调用（plugin server connected ✓）。改为真实 slash 调用 `/spec-driver:spec-driver-fix` 才走 skill 编排。**去向：评测设施已改；产品侧记录"非交互模式 workflow 触达"为 M8 命题**。
- **✅ 正向**：plugin:spectra:spectra MCP server 在 5/5 run 中均 status:connected（F170a 连接层稳定）；cohort3 stream-json 771KB 完整可解析。

### smoke 第二轮 + 单 run 取证（2026-06-10，skill 展开成功后）
- **stdin prompt 不触发 slash/skill 展开，位置参数（`--` 分隔）才触发**（probe 实证：skill `model: sonnet` frontmatter 覆盖生效 + 首轮 36k 注入）。claude CLI 行为差异，记录供 eval/CI 设施参考。
- **🔴 编排器 inline 化（产品 prompt 缺陷，F170a-d 链路唯一断点）**：spec-driver-fix skill 真实展开后，4/4 阶段全跑、gate/进度纪律都在，但模型自判"影响范围小（1 文件）"后**全阶段 inline 执行，0 次 Task 派发**——而 SKILL.md 明文 plan/implement/verify 须 `Task(...)` 委派。spectra 的整条产品集成链（F170a 子代理 frontmatter 工具 + F170d 工具优先规则 + F170c next-step hint）都挂在子代理上，不派发 = 全链路不触达（编排器自己可见 17 工具但无使用动机）。SWE-Bench Verified 类 1 文件修复任务 100% 触发此 collapse。**去向：Fix 候选（高优先）—— SKILL.md 派发语义从描述强化为 MUST（禁止 inline 替代委派），这是 prompt 强度 bug，不是架构问题**。

## 待 host 跑后补充
<!-- TODO host: cohort 3 真实 17 工具调用中遇到的连接/字段/准确性问题，逐条记录 + 去向 -->
