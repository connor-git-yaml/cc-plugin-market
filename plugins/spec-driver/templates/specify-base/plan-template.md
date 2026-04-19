# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]
**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the plan phase of the spec-driver orchestrator (e.g. `/spec-driver:spec-driver-feature`). See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

[Extract from feature spec: primary requirement + technical approach from research]

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: [e.g., Python 3.11, Swift 5.9, Rust 1.75 or NEEDS CLARIFICATION]  
**Primary Dependencies**: [e.g., FastAPI, UIKit, LLVM or NEEDS CLARIFICATION]  
**Storage**: [if applicable, e.g., PostgreSQL, CoreData, files or N/A]  
**Testing**: [e.g., pytest, XCTest, cargo test or NEEDS CLARIFICATION]  
**Target Platform**: [e.g., Linux server, iOS 15+, WASM or NEEDS CLARIFICATION]
**Project Type**: [single/web/mobile - determines source structure]  
**Performance Goals**: [domain-specific, e.g., 1000 req/s, 10k lines/sec, 60 fps or NEEDS CLARIFICATION]  
**Constraints**: [domain-specific, e.g., <200ms p95, <100MB memory, offline-capable or NEEDS CLARIFICATION]  
**Scale/Scope**: [domain-specific, e.g., 10k users, 1M LOC, 50 screens or NEEDS CLARIFICATION]

## Codebase Reality Check

> **必选区块**：plan 子代理必须对每个将被修改的目标文件执行 Reality Check。

| 文件路径 | LOC | 方法/函数数 | TODO/FIXME | 超长函数(>200L) | 需前置清理 |
|----------|-----|------------|------------|-----------------|-----------|
| [path]   | [N] | [N]        | [N]        | [Y/N]           | [Y/N]     |

**前置清理 Task**（仅在需要时填写）：
- [ ] `[CLEANUP]` {清理任务描述} — 原因: {触发规则}

## Impact Assessment

> **必选区块**：评估变更的影响半径和风险等级。

| 维度 | 评估 |
|------|------|
| **直接修改文件数** | [N] |
| **间接受影响文件数** | [N]（调用方/依赖方） |
| **跨包影响** | [无 / 涉及 {包列表}] |
| **数据迁移** | [无 / {迁移描述}] |
| **API/契约变更** | [无 / {变更描述}] |
| **风险等级** | [LOW / MEDIUM / HIGH] |

**风险等级判定理由**: [简述判定依据]

**分阶段计划**（仅 HIGH 风险时必填）：
- Phase A: {范围} — 验证点: {验证方法}
- Phase B: {范围} — 验证点: {验证方法}

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

[Gates determined based on constitution file]

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (plan phase output)
├── research.md          # Phase 0 output (plan phase)
├── data-model.md        # Phase 1 output (plan phase)
├── quickstart.md        # Phase 1 output (plan phase)
├── contracts/           # Phase 1 output (plan phase)
└── tasks.md             # Phase 2 output (tasks phase — NOT created by plan phase)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
# [REMOVE IF UNUSED] Option 1: Single project (DEFAULT)
src/
├── models/
├── services/
├── cli/
└── lib/

tests/
├── contract/
├── integration/
└── unit/

# [REMOVE IF UNUSED] Option 2: Web application (when "frontend" + "backend" detected)
backend/
├── src/
│   ├── models/
│   ├── services/
│   └── api/
└── tests/

frontend/
├── src/
│   ├── components/
│   ├── pages/
│   └── services/
└── tests/

# [REMOVE IF UNUSED] Option 3: Mobile + API (when "iOS/Android" detected)
api/
└── [same as backend above]

ios/ or android/
└── [platform-specific structure: feature modules, UI flows, platform tests]
```

**Structure Decision**: [Document the selected structure and reference the real
directories captured above]

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
