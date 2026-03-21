# Requirements Checklist: Provenance 与文档质量门

**Purpose**: 检查 059 需求规格是否覆盖蓝图要求、降级边界和可验证输出  
**Created**: 2026-03-21  
**Feature**: [spec.md](../spec.md)

## Blueprint Alignment

- [x] CHK001 已明确 059 只覆盖 provenance、conflict detector、quality report、required-doc rule set
- [x] CHK002 已明确 059 强依赖 055、056、057，且不提前实现 060 产品 / UX 接入
- [x] CHK003 已把 explanation / narrative / ADR 作为 provenance 重点对象，而不是新增事实抽取器

## User Story Coverage

- [x] CHK004 至少 1 个 P1 用户故事覆盖 explanation 文档 provenance
- [x] CHK005 至少 1 个 P1 用户故事覆盖 conflict detector
- [x] CHK006 至少 1 个 P1 用户故事覆盖 required-doc rule set
- [x] CHK007 至少 1 个用户故事覆盖 batch 主链路兼容与降级

## Requirement Quality

- [x] CHK008 Functional Requirements 为可测试的 MUST 语句，没有实现细节泄漏到用户价值描述
- [x] CHK009 Requirements 明确指出 059 必须复用现有结构化输出，不重新造事实抽取层
- [x] CHK010 Requirements 明确指出冲突出现时不能静默选择单一结论
- [x] CHK011 Requirements 明确指出 055 manifest 缺失时的降级行为
- [x] CHK012 Success Criteria 覆盖 quality report、conflict fixture、required-doc 差异化和主链路回归

## Testability

- [x] CHK013 每个 P1 用户故事都定义了独立可验证的测试方式
- [x] CHK014 规格要求包含至少 1 组 README vs current-spec 冲突测试
- [x] CHK015 规格要求包含 batch 集成验证，不只停留在单测层

## Notes

- 当前规格已覆盖 059 的蓝图目标和当前分支的依赖缺口。
- 实现阶段需要进一步把 conflict topic、severity 和 quality score 细化到数据模型与 contracts。
