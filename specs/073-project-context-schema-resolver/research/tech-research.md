# Tech Research

## Problem

当前 `.specify/project-context.yaml|md` 只是写在多个 Skill 文档里的软约定：

- 规则复制在 `feature/story/fix/resume/sync/doc/implement`
- `.yaml` / `.md` 并存时没有统一优先级
- 参考路径、在线调研策略和被排除字段没有共享 diagnostics

## Decision

采用一个最小共享机制：

1. `plugins/spec-driver/scripts/lib/simple-yaml.mjs`
2. `plugins/spec-driver/scripts/lib/project-profile-schema.mjs`
3. `plugins/spec-driver/scripts/lib/project-profile-resolver.mjs`
4. `plugins/spec-driver/scripts/resolve-project-context.mjs`

## Constraints

- 不引入新的 YAML 依赖，沿用仓库现有 lightweight parser 风格
- 不自动修改用户的 `.specify/project-context.*`
- Skill 只依赖 resolver 输出，不在 Skill 内重复定义字段解析规则
