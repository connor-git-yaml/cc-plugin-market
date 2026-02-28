---
name: spec-driver-fix
description: |
  Codex native wrapper for Spec Driver mode.
  Use this skill when user wants to run this Spec Driver mode in Codex and keep the same artifacts/gates as the original plugin workflow.
---

## User Input

```text
$ARGUMENTS
```

## Trigger Examples

- $spec-driver-fix "登录在邮箱包含 + 时失败"
- $spec-driver-fix --preset balanced "批量任务在高并发下偶发死锁"

## Input Rule

参数解析与 speckit-fix 保持一致（支持问题描述和 --preset）。

## Source of Truth

流程定义必须以 `/Users/connorlu/Desktop/.workspace2.nosync/reverse-spec/plugins/spec-driver/skills/speckit-fix/SKILL.md` 为准。

## Codex Execution Rules

1. 按 source skill 的阶段顺序执行，不改变门禁与产物路径。
2. 将 source skill 中每次 `Task(...)` 调用改为“当前会话内联子代理执行”：
   - 读取对应 `plugins/spec-driver/agents/*.md` prompt
   - 追加 source skill 定义的运行时上下文注入块
   - 在当前会话完成该阶段并写入相同文件
3. 原并行组若受环境限制无法并行，必须回退串行并显式标注 `[回退:串行]`。
4. 硬门禁（如 `GATE_DESIGN`）不可弱化或跳过。
5. 所有写入路径必须与 source skill 约定一致，不得越界写入。
6. 读取 `spec-driver.config.yaml` 的模型配置时，先执行运行时兼容归一化：
   - 优先级保持 `--preset -> agents.{agent_id}.model(仅显式配置时生效) -> preset 默认`
   - 当 runtime=codex（或自动识别为 Codex）时，默认将 `opus/sonnet` 映射为 `gpt-5/gpt-5-mini`
   - 若映射后模型不可用，回退到 `model_compat.defaults.codex` 并标注 `[模型回退]`
