# 问题修复报告 — Fix 113

## 问题描述

M-100 milestone（spectra-cli v3.0.0）经两轮并行 review（Claude Code UX + Codex 对抗性审查）后，
确认了 12 个真实问题：7 个阻塞级 bug + 5 个体验问题。

---

## 5-Why 根因追溯

### 根因 A：路径常量漂移（Path Constant Drift）

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | hook 脚本读取 graph.json 失败 | GRAPH_FILE="_meta/graph.json" 不存在 |
| Why 2 | 实际文件在 specs/_meta/graph.json | hook-installer 未使用 resolveGraphJsonPath() |
| Why 3 | graph-query.ts 也有同样漏洞 | cohesion 读 _meta/graph-report.md，实际在 specs/_meta/GRAPH_REPORT.md |
| Why 4 | 路径 helper 存在但未被全部消费者引用 | 各模块独立硬编码而非引用 graph-paths.ts |
| Why 5 | 未被现有测试覆盖 | 跨模块路径约定无集成测试 |

**Root Cause A**: `resolveGraphJsonPath()` helper 存在但未被 hook-installer 和 graph-query 使用，路径常量漂移。
**Root Cause Chain**: 路径写错 → 文件读取失败 → hook/query 功能静默降级

### 根因 B：metadata.degree 从未写入

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | hook 脚本 God Nodes 列表永远为空 | filter(n.metadata.degree != null) 始终返回 false |
| Why 2 | graph.json 节点的 metadata 不含 degree | graph-builder 只写 description/technology/tags |
| Why 3 | degree 数据存在于 CommunityResult | findGodNodes 计算了 degree 但只在内存中使用 |
| Why 4 | graph-builder 写节点时 degree 尚不可用 | 节点在社区检测前写入，未做二次更新 |
| Why 5 | hook 脚本 phase 和 build phase 分离 | 构建者假设消费者会重新计算 degree，消费者假设已写入 |

**Root Cause B**: graph-builder 写节点 metadata 时不含 degree，需在社区检测后补写到 GraphJSON。

### 根因 C：Feature 107 提取器与图谱 ID 体系脱节

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | AsyncAPI depicts/publishes 边悬空 | source: "service:${file}" 无对应节点 |
| Why 2 | image depicts 边悬空 | target: "component:${vision_text}" 无对应节点 |
| Why 3 | 提取器创建边时未先确保节点存在 | openapi-extractor 和 image-extractor 孤立设计 |
| Why 4 | Feature 107 作为扩展点添加，未做集成验证 | 提取结果的 graph-builder 集成缺乏端到端测试 |
| Why 5 | 悬空边被 graph-builder 静默过滤 | L307 droppped edges 无任何 warn 日志 |

**Root Cause C**: 提取器生成边时引用了不存在的节点 ID，Feature 107 集成点缺乏约束。

### 根因 D：Obsidian wikilink 生成与实际文件不匹配

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | community 页面中 wikilink 大量失效 | 点击 [[module-X]] 无法跳转到任何文件 |
| Why 2 | buildCommunityPage 为所有节点生成 wikilink | 但仅 index.md / communities / god-nodes 有文件 |
| Why 3 | Obsidian 导出未设计"节点页面" | Feature 103 只实现三类页面 |
| Why 4 | FR-002 要求双向链接但未限定链接目标 | 规范未明确节点链接只应指向有页面的节点 |
| Why 5 | 无 Obsidian 实际测试验证链接有效性 | 测试只验证内容生成，未验证链接可达性 |

**Root Cause D**: community 页面为无对应文件的节点生成 wikilink，应限制为仅引用 god-node 页面或纯文本。

### 根因 E：版本号硬编码 + watch.ts 遗漏传参

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | batch-summary 版本显示 2.9.0 | version: '2.9.0' 硬编码，有 TODO 注释 |
| Why 2 | TODO 一直未落地 | 从 package.json 读取需要处理 JSON parse |
| Why 3 | watch 不传 includeDocs/includeImages | executeBatchLoop 只透传 outputDir/languages |
| Why 4 | ProjectConfig 无这两个字段 | feature 107 添加这两个 flag 时只加了 CLI，未同步到 config schema |
| Why 5 | process.exit(1) vs process.exitCode 不一致 | 各模块独立添加退出逻辑，未参考统一标准 |

**Root Cause E**: 多个独立实现细节在集成后未做一致性审查。

---

## 影响范围扫描

### 阻塞级问题（7 个）

| 文件 | 位置 | 问题 | 修复动作 |
|------|------|------|----------|
| `src/hooks/hook-installer.ts` | L43-44, L74 | GRAPH_FILE/REPORT_FILE 缺 specs/ 前缀；degree filter 无效 | 修正路径常量；degree 在 graph-builder 写入后自动有效 |
| `src/panoramic/graph/graph-builder.ts` | L150-161 | 节点 metadata 未写 degree | 社区检测后补写 degree 到每个节点 |
| `src/extraction/openapi-extractor.ts` | L334-354 | AsyncAPI 生成 service:* 边无对应节点 | 同步创建 service:* 节点 |
| `src/extraction/image-extractor.ts` | L258-267 | depicts 边 target 为 Vision 自由文本 | 改为 diagram:${nodeId} 自引用，或去掉 depicts 边 |
| `src/panoramic/exporters/obsidian-exporter.ts` | L173-187 | community 页面为无页面节点生成 wikilink | 改为纯文本节点列表 |
| `src/batch/batch-orchestrator.ts` | L738 | 版本硬编码 2.9.0 | 从 package.json 读取 |
| `src/panoramic/graph/graph-query.ts` | L573 | 路径缺 specs/ 前缀且文件名大小写错误 | 使用正确路径 |

### 体验问题（5 个）

| 文件 | 位置 | 问题 | 修复动作 |
|------|------|------|----------|
| `src/cli/commands/watch.ts` | L124-127 | 外部 batch 检测直接 return，事件永久丢失 | return 前加入 pendingNextRound |
| `src/cli/commands/watch.ts` | L186 | runBatch 未透传 includeDocs/includeImages | 扩展 ProjectConfig 并透传 |
| `src/cli/commands/export.ts` | L65,80,90,98,125 | process.exit(1) | 改为 process.exitCode + return |
| `src/cli/commands/community.ts` | L54,65,71,102 | process.exit(1) | 改为 process.exitCode + return |
| `src/cli/commands/graph.ts` | L184 | process.exit(1) | 改为 process.exitCode + return |
| `src/cli/commands/export.ts` | L73 | 默认输出目录 _meta/export/ 缺 specs/ 前缀 | 改为 specs/_meta/export/ |
| `src/config/project-config.ts` | 缺失 | 无 includeDocs/includeImages 字段 | 添加字段并在 validateConfig 解析 |

### 同步更新清单
- 测试：`tests/unit/obsidian-exporter.test.ts`（验证 community 页无悬空 wikilink）
- 测试：`tests/unit/openapi-extractor.test.ts`（验证 AsyncAPI service 节点创建）
- 测试：`tests/unit/graph-builder.test.ts`（验证 degree 写入 metadata）

---

## 修复策略

### 方案 A（推荐）— 最小化正确修复
所有 12 个问题均有明确的单点修复，无需架构变更，按文件逐一修复。
对于 image-extractor depicts 边：改为 `diagram:${nodeId}` 自引用（diagram 节点本身有 ID），保留语义。

### 方案 B（备选）— 去掉 image depicts 边
直接删除 image-extractor 中的 depicts 边生成逻辑，Vision API 只生成 diagram 节点不建立关系。
更简单但丢失了图像到组件的关联语义。

**选择方案 A**，但 depicts 边目标用 diagram 节点自身 ID，而非 Vision 自由文本 component 名。

## Spec 影响
- 无需更新 spec 文件（修复的是实现 bug，不改变对外行为契约）
