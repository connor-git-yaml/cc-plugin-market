---
name: spec-driver-doc
description: |
  Codex native wrapper for Spec Driver mode.
  Use this skill when user wants to run this Spec Driver mode in Codex and keep the same artifacts/gates as the original plugin workflow.
---

## User Input

```text
$ARGUMENTS
```

## Trigger Examples

- $spec-driver-doc

## Input Rule

该模式无参数，按 speckit-doc 流程交互生成开源文档套件。

## Source of Truth

流程定义必须以 `/Users/connorlu/Desktop/.workspace2.nosync/reverse-spec/plugins/spec-driver/skills/speckit-doc/SKILL.md` 为准。

## Codex Execution Rules

1. 按 source skill 的阶段顺序执行，不改变门禁与产物路径。
2. 将 source skill 中每次 `Task(...)` 调用改为“当前会话内联子代理执行”：
   - 读取对应 `$PLUGIN_DIR/agents/*.md` prompt
   - 追加 source skill 定义的运行时上下文注入块
   - 在当前会话完成该阶段并写入相同文件
3. 原并行组若受环境限制无法并行，必须回退串行并显式标注 `[回退:串行]`。
4. 硬门禁（如 `GATE_DESIGN`）不可弱化或跳过。
5. 所有写入路径必须与 source skill 约定一致，不得越界写入。
6. 读取 `spec-driver.config.yaml` 的模型配置时，先执行运行时兼容归一化：
   - 优先级保持 `--preset -> agents.{agent_id}.model(仅显式配置时生效) -> preset 默认`
   - 当 runtime=codex（或自动识别为 Codex）时，默认将 `opus/sonnet/haiku` 映射为 `gpt-5.3-codex`，并通过 `codex_thinking.level_map` 选择思考等级
   - 若映射后模型不可用，回退到 `model_compat.defaults.codex` 并标注 `[模型回退]`
7. 若项目根目录存在 `.specify/project-context.yaml` 或 `.specify/project-context.md`：
   - 在进入阶段执行前先读取该文件，并将“项目参考路径注入块”追加到运行时上下文
   - 注入块应包含 project-context 中声明且实际存在的文档/参考路径（不要求固定目录或文件名）
   - 若存在无效路径，标注 `[参考路径缺失]`，流程继续但需在阶段总结与最终报告中列为风险项
8. 若 project-context 命中在线调研关键词（`perplexity`/`sonar-pro-search`/`在线调研`/`在线搜索`），必须执行在线调研硬门禁：
   - 生成并校验 `.specify/research/doc-online-research.md`
   - 校验 `points_count` 在 `[online_research_min_points, online_research_max_points]` 范围内
   - 当 `points_count=0` 时必须填写 `skip_reason`
   - 校验失败时必须阻断在 Step 3 前，不得进入文档交互与生成
