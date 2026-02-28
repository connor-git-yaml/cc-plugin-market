# reverse-spec / spec-driver — Codex 适配约定

本文件定义在 Codex 中运行本仓库能力时的统一约束，目标是在不牺牲现有功能语义的前提下保持双端兼容（Claude Code + Codex）。

## 1. 入口映射

- `reverse-spec` 能力优先走 CLI：
  - 单模块: `reverse-spec generate <target> --deep`
  - 批量: `reverse-spec batch [--force]`
  - 漂移: `reverse-spec diff <spec-file> <source-target>`
- 技能安装：
  - Claude: `reverse-spec init [--global] --target claude`
  - Codex: `reverse-spec init [--global] --target codex`
  - 双端: `reverse-spec init [--global] --target both`
- Spec Driver Codex 包装技能使用独立入口安装：
  - 推荐: `npm run codex:spec-driver:install` / `npm run codex:spec-driver:install:global`
  - 底层脚本: `bash plugins/spec-driver/scripts/codex-skills.sh install [--global]`

## 2. Spec Driver 兼容执行

`plugins/spec-driver/skills/*/SKILL.md` 的主流程保持不变；当运行环境缺少 Claude 的 `Task tool` 时，执行以下回退：

1. 将每次 `Task(...)` 视为“内联子代理调用”
2. 读取对应 `plugins/spec-driver/agents/<phase>.md`
3. 按 SKILL 中定义的上下文注入块补齐输入
4. 在当前会话完成该阶段，并写入相同产物路径
5. 原定义的并行组若无法并行，回退串行并显式标注 `[回退:串行]`
6. 模型选择按 `--preset -> agents.{agent_id}.model(仅显式配置时生效) -> preset 默认`，并通过 `model_compat` 做运行时映射（Codex 下支持 `opus/sonnet` 自动映射）

## 3. 产物与门禁不变性

- 目录和文件命名规范必须保持原样（`specs/<feature>/...`）
- 质量门（如 `GATE_DESIGN`、`GATE_VERIFY`）语义不得弱化
- 任何写操作仅限流程定义允许的产物路径，不得越界修改

## 4. 优先级规则

1. 优先遵循 `plugins/spec-driver/skills/*/SKILL.md` 的阶段定义
2. 需要实现细节时读取对应 `agents/*.md` 和 `templates/*`
3. 平台差异仅体现在“调度方式”，不改变业务流程语义
