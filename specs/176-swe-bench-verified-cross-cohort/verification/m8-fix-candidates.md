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

## 待 host 跑后补充
<!-- TODO host: cohort 3 真实 17 工具调用中遇到的连接/字段/准确性问题，逐条记录 + 去向 -->
