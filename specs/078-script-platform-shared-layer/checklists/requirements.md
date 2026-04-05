# Requirements Checklist: Script Platform 共享层收敛

**Purpose**: 检查 078 规格是否完整覆盖蓝图 076 对共享层收敛的范围、边界和验证要求  
**Created**: 2026-04-05  
**Feature**: [spec.md](../spec.md)

## Blueprint Alignment

- [x] CHK001 已明确 078 只覆盖 Script Platform 共享层收敛，不扩展到 079/080/081
- [x] CHK002 已明确优先覆盖 `entity / workflow / quality / scorecard / adoption / suggestions` 六条主链
- [x] CHK003 已明确收敛范围至少包含 YAML、report IO、patch、Markdown helpers、diagnostics/warnings

## User Story Coverage

- [x] CHK004 至少 1 个 P1 用户故事覆盖 YAML parse / stringify 单一来源
- [x] CHK005 至少 1 个 P1 用户故事覆盖基础 IO、patch 与 diagnostics 合同
- [x] CHK006 至少 1 个用户故事覆盖外部合同不回归与共享层单测

## Requirement Quality

- [x] CHK007 Functional Requirements 使用可验证的 MUST 语句
- [x] CHK008 Requirements 明确指出 078 只抽共享基础能力，不统一所有业务报告模板
- [x] CHK009 Requirements 明确指出保持现有脚本入口、输出路径与返回 payload 兼容
- [x] CHK010 Requirements 明确指出不引入新运行时依赖、只兼容单一端的流程或整批 `.mjs -> .ts` 迁移

## Testability

- [x] CHK011 Success Criteria 明确要求共享层专门单测
- [x] CHK012 Success Criteria 明确要求相关集成测试回归
- [x] CHK013 规格中已把“代码检索确认不再保留多份等价 parse/stringify”纳入验收

## Notes

- 当前规格已经把 078 定位为内部维护性特性，而不是新增对外产品能力。
- 进入 implementation 前，需要在 plan/tasks 中把六条主链的迁移顺序和最小共享抽象进一步细化。
