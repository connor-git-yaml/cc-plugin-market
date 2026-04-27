# 修复任务 — 135-fix-gate-skip-schema

## Task 1 — schema 枚举修复
**文件**: `plugins/spec-driver/contracts/orchestration-schema.mjs`
- [ ] L107 注释：更新描述，加入 skip
- [ ] L119：枚举加 `'skip'`
- [ ] L123：error message 合法值列表加 skip

## Task 2 — orchestration-overrides-contract.yaml 文档
**文件**: `plugins/spec-driver/contracts/orchestration-overrides-contract.yaml`
- [ ] 在 gates 覆盖路径 notes 下加 valid_values 说明

## Task 3 — agent-orchestration-overrides.md 文档
**文件**: `docs/shared/agent-orchestration-overrides.md`
- [ ] 加 default_behavior 合法值对照表（含各值语义）

## Task 4 — 端到端测试
**文件**: `plugins/spec-driver/tests/orchestration-resolver.test.mjs`
- [ ] 新增测试用例：skip override 成功合并，无 base-invalid，source=overrides

## Task 5 — 验证
- [ ] `npx vitest run` 零失败
- [ ] 手动运行 `effective-orchestration --annotate` 确认 skip 生效
