# Migration Guide: 项目级 orchestration overrides

> spec-driver 现在支持**项目级流程定制**。本指南帮你判断"何时该用"以及"怎么用"。

**适用版本**: spec-driver Feature 133 之后（commit `e6b7c7a` 起）
**风险等级**: 低（向后兼容 — 不写 overrides 文件，行为和之前完全一致）

---

## 1. 这是什么？

spec-driver 之前采用 plugin 内置的 `orchestration.yaml` 作为唯一编排配置，所有项目共享同一套 phase 序列 / gate 行为 / 并发策略。

**Feature 133 引入分层编排**：

```
plugin base orchestration.yaml         （内置默认，不动）
        │
        │ + 合并
        ▼
.specify/orchestration-overrides.yaml  （你的项目级覆盖）
        │
        │ = effective config
        ▼
   spec-driver 编排器实际执行
```

类比：ESLint `extends` / Docker Compose `override.yml` / tsconfig `extends`。**你只覆盖需要不一样的字段，其他全部继承 base**。

---

## 2. 你需要这个吗？决策表

| 你的场景 | 是否需要 overrides |
|---------|-------------------|
| 单人 / 小团队，spec-driver 默认就好 | ❌ 不需要，跳过本指南 |
| 高风险项目（金融 / 医疗 / 合规），所有 gate 必须强制人工审 | ✅ 需要（覆盖 gate.default_behavior）|
| 低风险项目（文档仓库 / 内部工具），希望跳过繁琐 verify | ✅ 需要（覆盖 gate.default_behavior）|
| CI 环境资源紧张，需要降低 parallel concurrency | ✅ 需要（覆盖 parallel_scheduling）|
| 想给 fix 模式裁剪 phase 序列（例如跳过 research）| ✅ 需要（覆盖 modes.fix）|
| 团队对某些 mode 的 phase 顺序有特殊偏好 | ✅ 需要（覆盖 modes.\<mode\>）|

如果上表没有打勾的场景，你不需要这个，**spec-driver 默认行为就 OK**。

---

## 3. 边界 — 别用错配置文件

spec-driver 有**两个**项目级配置文件，职责严格分离：

| 文件 | 管什么 | 例子 |
|------|--------|------|
| `.specify/orchestration-overrides.yaml` | **流程结构**：phase 序列 / gate 行为 / 并发 | "fix 模式跳过 research phase"、"GATE_VERIFY 强制人工审" |
| `spec-driver.config.yaml` | **行为偏好**：每个 agent 用什么 model / preset / resume 策略 | "specify agent 用 sonnet"、"verify agent 用 opus"、"启用在线调研" |

**判断规则**：
- 改"编排引擎如何执行 phases/gates" → `orchestration-overrides.yaml`
- 改"agent 决策偏好（非结构）" → `spec-driver.config.yaml`

写错文件不会立刻报错，但会导致期望的行为不生效（你以为改了但没生效）。**写之前对照本表**。

---

## 4. 三个最常见场景的 minimal 例子

### 场景 A：高风险项目 — 强制所有 gate 人工审

`.specify/orchestration-overrides.yaml`：

```yaml
version: "1.0"

gates:
  GATE_DESIGN:
    default_behavior: always   # 默认 auto，强制改 always（每次都触发）
    severity: critical
  GATE_VERIFY:
    default_behavior: always
    severity: critical
  GATE_IMPLEMENT_MID:
    default_behavior: always
    severity: critical
```

效果：每次 design / mid-impl / verify 走完都暂停，等人工 approve 才继续。

> **枚举值参考**（来自 `plugins/spec-driver/contracts/orchestration-schema.mjs`）：
> - `default_behavior` 必须是 `always` / `auto` / `on_failure` / `skip` 之一
> - `severity` 必须是 `critical` / `non_critical` / `warning` / `info` 之一
> - 写错枚举值（如 `pause` / `error`）会触发 `orchestration-overrides.schema-fallback` warning 且 overrides 静默退化为 base，必须按 schema 严格匹配。

### 场景 B：低风险项目 — 自动跳过 verify gate

`.specify/orchestration-overrides.yaml`：

```yaml
version: "1.0"

gates:
  GATE_VERIFY:
    default_behavior: auto    # 默认 always，改 auto，verify 通过自动 ship
```

效果：verify phase 跑完后，如果工具链零失败，自动进入 commit / push 阶段，不暂停。

### 场景 C：CI 资源紧张 — 把并发降到 1

`.specify/orchestration-overrides.yaml`：

```yaml
version: "1.0"

parallel_scheduling:
  max_concurrent_tasks: 1     # 默认 3，CI 改 1
```

效果：原本并行的 spec-review + quality-review + verify 会串行跑。CI 内存 / API rate limit 受限时适用。

---

## 5. 验证：怎么知道我的 overrides 生效了？

### 5.1 查看合并后的 effective config

```bash
node plugins/spec-driver/scripts/orchestrator-cli.mjs effective-orchestration <mode> --annotate
```

`<mode>` 是 `feature | story | implement | fix | resume | sync | doc | refactor` 之一。

`--annotate` 会在每个字段后标注**来源**（`base` / `project-override`），让你一眼看出"哪些是默认 / 哪些被你改了"。

例如：

```yaml
gates:
  GATE_VERIFY:
    default_behavior: auto      # source: project-override
    severity: critical          # source: base
    hard_gate_modes: [feature]  # source: base
```

### 5.2 排查"看起来没生效"的情况

如果 effective config 里没看到你的覆盖，用 JSON 模式看 diagnostics：

```bash
node plugins/spec-driver/scripts/orchestrator-cli.mjs effective-orchestration <mode> --format json
```

返回的 `diagnostics` 数组里，`level: warning | error` 的条目说明**降级原因**：

| diagnostic code | 含义 | 处理方式 |
|----------------|------|---------|
| `orchestration-overrides.file-not-found` | `.specify/orchestration-overrides.yaml` 不存在 | 创建文件 |
| `orchestration-overrides.parse-error` | YAML 语法错误 | 修语法（缺冒号 / 缩进错）|
| `orchestration-overrides.schema-fallback` | Zod 校验失败（如 mode 名拼错）| 看错误细节，修字段 |
| `orchestration-overrides.version-mismatch` | `version` 字段和 base 不一致 | 改 `version: "1.0"` 对齐 base |

### 5.3 干跑一次完整流程不实施

如果想看"加了 overrides 后某个 mode 实际会怎么走"，但不想真启动流程：

```bash
node plugins/spec-driver/scripts/orchestrator-cli.mjs effective-orchestration fix --annotate
```

会打出完整的 phase 序列 + 每个 gate 的行为，让你 review 确认无误后再启动。

---

## 6. 当前 MVP 支持的覆盖路径

| 路径 | 行为 | 备注 |
|------|------|------|
| `modes.<mode>` | **整段替换** | mode key 必须是上面 8 个 reserved enum 之一 |
| `gates.<GATE_ID>` | **字段级合并** | 仅 `default_behavior` / `severity` / `hard_gate_modes` 可覆盖 |
| `parallel_scheduling.*` | **顶层标量后者覆盖** | 如 `max_concurrent_tasks: 1` |

### 不支持的（二期可能加）

- `parallel_groups` 覆盖（按组改并行策略）
- 按 phase id 局部 patch（不整段替换 mode）
- `modes.<m>.extends` 继承语义（多层级继承）

如果你的需求落在"不支持"清单里，**先写 issue / 反馈**，不要绕开 schema 强写（schema fallback 会拒绝）。

---

## 7. 完整 schema 在哪里

- **Schema 定义**: `plugins/spec-driver/contracts/orchestration-schema.mjs`
- **合同文档**: `plugins/spec-driver/contracts/orchestration-overrides-contract.yaml`
- **Base 配置**: `plugins/spec-driver/orchestration.yaml`（编排器内置默认）

---

## 8. 已知陷阱

### 陷阱 1：写错文件没报错

写错 `spec-driver.config.yaml` vs `orchestration-overrides.yaml` 没有强校验，行为不会立刻报错。**用 §5.1 的 `--annotate` 验证你期望的字段是否真在 effective config 里**。

### 陷阱 2：`modes.<mode>` 是整段替换不是合并

如果你想"在默认 fix 流程上加一个 phase"，**不能**只写 `modes.fix.phases.append: [my-extra-phase]`（不支持）。当前必须**整段重写 fix 模式的 phase 序列**。如果只改一两个 phase，建议先用 `effective-orchestration fix` 看完整序列再粘贴改。

### 陷阱 3：base orchestration 升级不通知

plugin base orchestration.yaml 升级时，你的项目级 overrides 不会自动 follow。如果 base 加了新 phase / 新 gate，你的整段替换型覆盖（`modes.<mode>`）会**保持旧序列**。建议每次 spec-driver plugin 升级后跑一次 `effective-orchestration --annotate` 复检。

---

## 9. 参考：本仓库 dogfood 是否用了 overrides？

本仓库（cc-plugin-market）目前**没有** `.specify/orchestration-overrides.yaml`。dogfood 走 plugin base 默认。如果你想看真实例子，搜索其他用了 spec-driver 的开源项目，或者按 §4 的三个场景模板自己写。

---

## 10. 反馈 / 问题

- spec 完整文档：[specs/133-orchestration-overrides/spec.md](../../specs/133-orchestration-overrides/spec.md)
- 验收测试：[specs/133-orchestration-overrides/verification/](../../specs/133-orchestration-overrides/verification/)
- agent rules（CLAUDE.md / AGENTS.md 自动同步）：[docs/shared/agent-orchestration-overrides.md](../shared/agent-orchestration-overrides.md)
