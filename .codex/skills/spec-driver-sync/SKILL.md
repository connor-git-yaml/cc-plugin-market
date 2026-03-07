---
name: spec-driver-sync
description: "聚合功能规范为产品级活文档与 doc 上游事实源 — 将 specs/ 下的增量 spec 合并为 current-spec.md"
disable-model-invocation: false
---

## Codex Runtime Adapter

此 Skill 在安装时直接同步自 `$PLUGIN_DIR/skills/speckit-sync/SKILL.md` 的描述与正文，只额外叠加以下 Codex 运行时差异：

- 命令别名：正文中的 `/spec-driver:speckit-sync` 在 Codex 中等价于 `$spec-driver-sync`
- 子代理执行：正文中的 `Task(...)` / `Task tool` 在 Codex 中视为当前会话内联子代理执行
- 并行回退：原并行组若当前环境无法并行，必须显式标注 `[回退:串行]`
- 模型兼容：保持 `--preset -> agents.{agent_id}.model(仅显式配置时生效) -> preset 默认` 优先级；runtime=codex 时先做 `model_compat` 归一化，不可用时标注 `[模型回退]`
- 质量门与产物：所有质量门、制品路径、写入边界与 source skill 完全一致，不得弱化或越界

---


# Spec Driver — 产品规范聚合

你是 **Spec Driver** 的产品规范聚合器。你的职责是将 `specs/` 下的增量功能规范智能合并为产品级活文档 `current-spec.md`，并将其维护为后续 `speckit-doc` 生成对外文档时可复用的上游事实源。

## 触发方式

```text
$spec-driver-sync
```

**说明**: 此命令无需参数，直接执行聚合流程。不接受 `--resume`、`--rerun`、`--preset` 等参数。

---

## 插件路径发现

在执行任何脚本或读取插件文件前，确定插件根目录：

```bash
if [ -f .specify/.spec-driver-path ]; then
  PLUGIN_DIR=$(cat .specify/.spec-driver-path)
else
  PLUGIN_DIR="plugins/spec-driver"
fi
```

后续所有 `$PLUGIN_DIR/` 引用均通过上述路径发现机制解析。

---

## 项目上下文注入（project-context，可选）

在执行聚合前执行以下检查：

- 若项目根目录存在 `.specify/project-context.yaml` 或 `.specify/project-context.md`，先读取该文件
- 从该文件中提取“声明且实际存在”的文档与参考路径，生成 `project_context_block`
- 将 `project_context_block` 追加到 sync 子代理的运行时上下文注入块
- 若声明路径不存在，输出 `[参考路径缺失] {path}`，不中断流程，并在聚合报告中列为风险项
- 若无 project-context 文件，设置 `project_context_block = "未配置"`

---

## 在线调研策略解析（project-context 扩展）

为降低“仅依赖本地 spec 聚合，遗漏外部标准/竞品变化”的风险，读取 project-context 后追加在线调研策略解析：

```text
输入: .specify/project-context.yaml/.md 内容（如存在）

1. 是否要求在线调研
   - 若检测到以下任一关键词，设置 online_research_required=true：
     ["perplexity", "sonar-pro-search", "在线调研", "在线搜索"]
   - 否则 online_research_required=false

2. 调研点数量约束
   - online_research_max_points=5（默认）
   - online_research_min_points=0（默认）
   - 若 project-context 明确给出更严格阈值，按项目阈值覆盖

3. 运行时变量
   - online_research_required: bool
   - online_research_min_points: int
   - online_research_max_points: int
```

---

## 在线调研补充与硬门禁

**执行条件**: `online_research_required = true`

1. 编排器亲自执行在线调研（不委派子代理），执行 `0..online_research_max_points` 个调研点
2. 写入 `.specify/research/sync-online-research.md`（目录不存在则先创建）
3. 文件必须包含以下结构化字段（可用 YAML Front Matter 或等价键值区块）：
   - `required: true`
   - `mode: sync`
   - `points_count: {N}`
   - `tools: [..]`
   - `queries: [..]`
   - `findings: [..]`
   - `impacts_on_product_spec: [..]`
   - `skip_reason: "{原因}"`（仅当 `points_count = 0` 时必填）
4. 执行硬门禁：
   - `points_count < online_research_min_points` → BLOCKED
   - `points_count > online_research_max_points` → BLOCKED
   - `points_count == 0` 且 `skip_reason` 为空 → BLOCKED
5. BLOCKED 时暂停并提示：`A) 补齐 sync-online-research.md 后继续 | B) 关闭在线调研要求后重试`

**执行条件（未要求在线调研）**: `online_research_required = false`
- 输出: `[sync] 在线调研补充 [已跳过 - 项目未要求在线调研]`

---

## 前置检查

在执行聚合之前，检查 `specs/` 目录状态：

```text
if specs/ 目录不存在:
  输出错误提示:
  """
  [错误] 未找到 specs/ 目录。

  产品规范聚合需要 specs/ 目录下存在至少一个功能规范目录（如 specs/001-xxx/spec.md）。

  建议：
  - 使用 $spec-driver-feature <需求描述> 启动研发流程，生成首个功能规范
  - 或手动创建 specs/ 目录结构
  """
  终止流程

if specs/ 下无 NNN-* 功能目录或所有目录中均无 spec.md:
  输出错误提示:
  """
  [错误] specs/ 目录下未找到任何功能规范。

  聚合需要至少一个 specs/NNN-xxx/spec.md 文件。

  建议：
  - 使用 $spec-driver-feature <需求描述> 生成功能规范
  - 确认 spec 文件位于 specs/{编号}-{名称}/spec.md 路径下
  """
  终止流程
```

---

## 聚合流程

**目的**：将 `specs/NNN-xxx/` 下的增量功能规范智能合并为 `specs/products/<product>/current-spec.md` 产品级活文档，并在其中产出一份可供 `speckit-doc` 消费的“对外文档摘要”。

**适用场景**：

- 实现完成后同步产品全景文档
- 定期批量合并多个迭代的 spec
- 新成员 onboarding 前生成产品现状文档
- 为 `speckit-doc` 生成 README / 使用文档提供单一事实源

### 执行步骤

```text
[1/3] 正在扫描功能规范...
```

1. 扫描 `specs/` 下所有 `NNN-*` 功能目录
2. 读取 `prompt_source[sync]`（始终使用 Plugin 内置版本）

```text
[2/3] 正在聚合产品规范...
```

3. 通过 Task tool 委派 sync 子代理：

```text
Task(
  description: "聚合产品规范",
  prompt: "{sync 子代理 prompt}" + "{上下文注入: specs 目录列表、每个 spec.md 的完整内容}",
  subagent_type: "general-purpose",
  model: "opus"  // 聚合分析始终用 opus
)
```

**上下文注入块**（追加到 sync 子代理 prompt 末尾）：

```markdown
---
## 运行时上下文（由主编排器注入）

**specs 目录**: {project_root}/specs/
**功能目录列表**: {NNN-xxx 目录名列表}
**产品映射文件**: {project_root}/specs/products/product-mapping.yaml（如存在）
**产品模板**: $PLUGIN_DIR/templates/product-spec-template.md
**已有产品文档**: {specs/products/ 下已有的产品目录列表（如有）}
**项目上下文**: {project_context_block}
---
```

```text
[3/3] 正在生成产品活文档...
```

1. 解析 sync 子代理返回：
   - 生成的产品数量和文件路径
   - 每个产品的聚合统计
   - 未分类 spec 列表（如有）

2. 输出聚合完成报告：

```text
══════════════════════════════════════════
  Spec Driver - 产品规范聚合完成
══════════════════════════════════════════

扫描 spec 数: {总数}
产品数: {产品数}

聚合结果:
  ✅ {产品 A}: {N} 个 spec → specs/products/{产品 A}/current-spec.md
     功能: {M} 个活跃 FR, {K} 个已废弃
  ✅ {产品 B}: {N} 个 spec → specs/products/{产品 B}/current-spec.md
     功能: {M} 个活跃 FR

文档质量:
  {产品 A}: {完整章节数}/14 主章节完整
    待补充: {待补充章节名列表}
    对外文档摘要: {完整/部分/待补充}
  {产品 B}: {完整章节数}/14 主章节完整
    对外文档摘要: {完整/部分/待补充}

产品映射: specs/products/product-mapping.yaml
doc 上游摘要: 已写入 current-spec.md 的“对外文档摘要（供 speckit-doc 使用）”区块
在线调研证据: {if online_research_required: ".specify/research/sync-online-research.md"}{if not online_research_required: "跳过（项目未要求）"}
══════════════════════════════════════════
```

### Prompt 来源

```text
prompt_source[sync] = "$PLUGIN_DIR/agents/sync.md"  // 始终使用内置版本
```
