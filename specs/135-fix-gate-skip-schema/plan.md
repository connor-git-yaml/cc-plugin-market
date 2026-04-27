# 修复规划 — 135-fix-gate-skip-schema

## 变更清单（最小化）

### 1. schema 枚举修复（核心，1 处）
**文件**: `plugins/spec-driver/contracts/orchestration-schema.mjs`

- L107 注释：更新为 `"always" | "auto" | "on_failure" | "skip"`，移除"非 spec 定义的 skip"误导性说明
- L119 枚举：`z.enum(['always', 'auto', 'on_failure'])` → `z.enum(['always', 'auto', 'on_failure', 'skip'])`
- L123 error message：合法值列表中加 `skip`

### 2. 合同文档（说明性，2 处）
**文件**: `plugins/spec-driver/contracts/orchestration-overrides-contract.yaml`
- 在 `gates.<GATE_ID>` 路径下加 `valid_values: [always, auto, on_failure, skip]` 及各值语义说明

**文件**: `docs/shared/agent-orchestration-overrides.md`
- 在 gate override 说明下加 `default_behavior` 合法值对照表

### 3. 测试补充（验证覆盖，1 个测试用例）
**文件**: `plugins/spec-driver/tests/orchestration-resolver.test.mjs`
- 新增测试：`GATE_VERIFY.default_behavior: skip` → 合并后 `mergedConfig.gates.GATE_VERIFY.default_behavior === 'skip'`，且 `diagnostics` 中无 `orchestration.base-invalid`，`fieldSources['gates.GATE_VERIFY.default_behavior'] === 'overrides'`

## 回归风险评估
- **低风险**：`orchestration.yaml` base 文件不含 `skip`，加入枚举后现有 base 校验路径不受影响
- **零风险**：`orchestrationMergedSchema = orchestrationBaseSchema`（等号复用），schema 修复后 merged 校验自动受益，无需额外改动

## 修复验证方案
1. `npx vitest run` 全量通过
2. 手动验证：在测试项目写 `GATE_VERIFY.default_behavior: skip` override，运行 `effective-orchestration fix --annotate`，确认 `source: overrides` 出现且无 `base-invalid` diagnostic
