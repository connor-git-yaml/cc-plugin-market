## 项目级 orchestration 覆盖约定

- `.specify/orchestration-overrides.yaml` 是项目级流程结构覆盖文件；流程结构覆盖（mode phase 序列、gate behavior、parallel_scheduling 等）必须放此文件，禁止写入 `.specify/project-context.yaml` 的 `forbidden_changes` / `verification_policy` 等字段
- schema 定义在 `plugins/spec-driver/contracts/orchestration-schema.mjs`；合同说明在 `plugins/spec-driver/contracts/orchestration-overrides-contract.yaml`
- 通过 `node plugins/spec-driver/scripts/orchestrator-cli.mjs effective-orchestration <mode> --annotate` 查看合并后的 effective config 与字段来源

### 何时使用 orchestration-overrides.yaml vs spec-driver.config.yaml

| 场景 | 使用哪个文件 |
|------|-------------|
| 修改 mode 的 phase 序列（整段替换） | `orchestration-overrides.yaml` |
| 调整 gate 行为（default_behavior / severity） | `orchestration-overrides.yaml` |
| 修改 parallel_scheduling.max_concurrent_tasks | `orchestration-overrides.yaml` |
| 设置 gate_policy / resume_strategy | `spec-driver.config.yaml` |
| 开关 research.enabled 等行为偏好 | `spec-driver.config.yaml` |

**判断规则**：流程结构覆盖（编排引擎如何执行 phases/gates）→ `orchestration-overrides.yaml`；行为偏好（agent 决策偏好，非结构）→ `spec-driver.config.yaml`。

支持的覆盖路径（MVP）：
- `modes.<mode>`：整段替换，mode key 必须是 `feature|story|implement|fix|resume|sync|doc|refactor` 之一
- `gates.<GATE_ID>`：字段级合并，仅 `default_behavior / severity / hard_gate_modes` 可覆盖
- `parallel_scheduling.*`：顶层标量后者覆盖，如 `max_concurrent_tasks: 1`（CI 资源受限时适用）

MVP 不支持（二期）：`parallel_groups` 覆盖、按 phase id 局部 patch、`modes.<m>.extends` 继承语义。

### 降级信号排查方式

当 overrides 文件未生效时，使用 `--format json` 查看 diagnostics：

```bash
node plugins/spec-driver/scripts/orchestrator-cli.mjs effective-orchestration <mode> --format json
```

返回的 `diagnostics` 数组中，`level` 为 `warning` 或 `error` 的条目说明降级原因：

| diagnostic code | 含义 | 处理方式 |
|----------------|------|---------|
| `orchestration-overrides.parse-error` | YAML 语法错误 | 检查 overrides 文件语法 |
| `orchestration-overrides.schema-fallback` | Zod 校验失败（如非法 mode 名） | 检查 mode 名是否为 reserved enum |
| `orchestration-overrides.version-mismatch` | version 字段与 base 不一致 | 见下方处理步骤 |
| `orchestration-overrides.unsupported-field` | 使用了 MVP 不支持的字段（如 parallel_groups） | 移除该字段或等待二期 |
| `orchestration.base-invalid` | base orchestration.yaml 损坏 | 联系 plugin 维护者 |

### version 不一致时的处理步骤

当 `diagnostics` 含 `orchestration-overrides.version-mismatch` 时：

1. 查看 base version：`node plugins/spec-driver/scripts/orchestrator-cli.mjs validate-config --format json` 中的 `version` 字段
2. 将 `.specify/orchestration-overrides.yaml` 顶部的 `version` 更新为与 base 一致的值
3. 重新验证：`node plugins/spec-driver/scripts/orchestrator-cli.mjs effective-orchestration <mode> --format json`，确认 `diagnostics` 为空
4. 如果 base version 已升级，需重新审查 overrides 中的 phase 定义是否与新 base 兼容
