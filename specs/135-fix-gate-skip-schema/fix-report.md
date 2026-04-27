# 问题修复报告 — 135-fix-gate-skip-schema

## 问题描述
orchestration-overrides 的 gate `default_behavior: skip` 覆盖失败。
用户在 `.specify/orchestration-overrides.yaml` 写入 `GATE_VERIFY.default_behavior: skip`，
`orchestrationOverridesSchema`（步骤 7）通过校验，但步骤 9 防御性校验合并结果时触发
`orchestration.base-invalid` diagnostic，整个 overrides 静默降级到 base config。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 步骤 9 为何报 base-invalid？ | `orchestrationMergedSchema.safeParse(merged)` 失败：`skip` 不在合法枚举 |
| Why 2 | merged schema 为何拒绝 skip？ | `orchestrationMergedSchema = orchestrationBaseSchema`（schema.mjs:301），复用 base schema |
| Why 3 | base schema 为何不含 skip？ | `gateDefinitionSchema.default_behavior` 枚举只写了 `['always', 'auto', 'on_failure']`（L119），注释解释是"实际值"（base YAML 里没有 skip） |
| Why 4 | override schema 为何允许 skip？ | `gateOverrideSchema.default_behavior`（L152）写了 `['always', 'auto', 'skip', 'on_failure']`，考虑了用户定制场景 |
| Why 5 | 为何未被测试捕获？ | 现有测试覆盖了 override 的 schema-fallback 路径，但没有端到端测试验证"override 含 skip → 合并成功"这条路径 |

**Root Cause**: `gateDefinitionSchema`（用于 base 和 merged 校验）的枚举未包含 `skip`，而 `gateOverrideSchema` 已允许 `skip`，两层 schema 枚举不对称，导致 override → 合并 → 合并校验三步中第三步必然失败。

**Root Cause Chain**: `skip` 写入 override → `gateOverrideSchema` 通过 → 合并进 mergedGates → `orchestrationMergedSchema`（= `orchestrationBaseSchema`）校验 → `gateDefinitionSchema` 枚举拒绝 `skip` → `base-invalid` diagnostic → 降级

**[ROOT CAUSE REACHED at Why 3]**

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `contracts/orchestration-schema.mjs` | L119 | `gateDefinitionSchema.default_behavior` 枚举 | 加入 `'skip'` |
| `contracts/orchestration-schema.mjs` | L107 注释 | "实际值含 on_failure，非 spec 定义的 skip" | 更新为包含 skip 的准确描述 |
| `contracts/orchestration-schema.mjs` | L123 error message | 错误提示中的合法值列表 | 加入 skip |

### 类似模式（需评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| `lib/orchestrator.mjs:62` | L62 | 使用 `orchestrationBaseSchema.safeParse` 校验 preloaded config | 安全：preloaded config 来自 resolver 输出，届时 schema 已更新 |
| `tests/orchestrator.test.mjs:343` | L343 | 验证 `orchestrationBaseSchema.safeParse(orch.config)` | 安全：base YAML 不含 skip，现有测试不受影响 |

### 同步更新清单
- **测试**: `tests/orchestration-resolver.test.mjs` — 补端到端测试：override 含 `skip` → 合并成功、无 base-invalid、source 标注正确
- **合同文档**: `contracts/orchestration-overrides-contract.yaml` — gates 路径下加 `valid_values`
- **共享文档**: `docs/shared/agent-orchestration-overrides.md` — 加 gate default_behavior 合法值表

## 修复策略

### 方案 A（推荐）：在 gateDefinitionSchema 加入 skip

在 `orchestration-schema.mjs:119` 的枚举中加 `'skip'`：
```js
default_behavior: z.enum(['always', 'auto', 'on_failure', 'skip'], { ... })
```

**优点**：改动最小（1 行枚举 + 注释更新），语义正确（skip 是合法的 gate 运行时状态），不影响 base YAML 校验（现有 orchestration.yaml 不含 skip），`orchestrationMergedSchema` 自动受益（等号复用）。

### 方案 B（备选）：分离 orchestrationMergedSchema

创建独立的 `mergedGateSchema` 扩展 `gateDefinitionSchema`，在 `orchestrationMergedSchema` 中替换 gates 的 record schema。

**缺点**：代码量更大，需要维护两套 gate schema，且未来再加新值时还需要同步两处。

**选择方案 A**。

## Spec 影响
- 需要更新的文档合同：`contracts/orchestration-overrides-contract.yaml`（加 valid_values）
- 需要更新的共享文档：`docs/shared/agent-orchestration-overrides.md`（加合法值表）
- 无需更新 specs/ 下的功能 spec（Feature 133 的 spec 无 skip 相关 AC）
