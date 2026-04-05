# Requirements Checklist: 可读性与维护性热点重构

## Scope

- [x] CHK001 已明确 081 只覆盖四个蓝图点名热点，不扩展到 079/080 的分发或发布合同范围
- [x] CHK002 已明确 081 不是新增用户能力，而是热点结构重构
- [x] CHK003 已明确 081 依赖并复用 078 shared layer，而不是重做 YAML / IO / patch / diagnostics

## Compatibility

- [x] CHK004 已要求保持 CLI 入口、参数、输出路径和 JSON payload 关键字段不变
- [x] CHK005 已要求继续兼容 Codex / Claude 双端
- [x] CHK006 已要求不把整批 `.mjs` 整体迁移到 `src/**` TypeScript，也不把 Bash 全量改写成 Node

## Verification

- [x] CHK007 已要求新增 targeted unit tests，而不仅依赖现有 integration tests
- [x] CHK008 已要求保留现有 integration tests 作为对外合同回归底线
- [x] CHK009 已要求 `npm run lint`、`npm run build`、`npm test` 全部通过
- [x] CHK010 已要求在 verification report 记录热点复杂度重构前后对比
