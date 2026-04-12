# Feature 104 质量检查清单

feature_id: "104"
title: "PreToolUse Hook 注入 + Post-commit Hook"
checklist_generated: "2026-04-12"

---

## Content Quality（内容质量）

| # | 检查项 | 结果 | Notes |
|---|--------|------|-------|
| CQ-01 | 规范中无实现细节（未直接规定具体语言、框架、API 实现方式） | [ ] | FR-001 中提到"遵循现有三步走模式：CLICommand interface 扩展、parseArgs() 分支、src/cli/index.ts switch 分支"，属于实现细节泄漏；FR-005 直接规定 shell 脚本内容和具体变量名；数据模型章节包含完整 TypeScript interface 定义，属于实现层规范 |
| CQ-02 | 聚焦用户价值和业务需求 | [x] | User Stories 章节清晰描述用户场景和动机，Priority 说明充分 |
| CQ-03 | 面向非技术利益相关者编写 | [ ] | 规范大量包含技术术语（`mkdtempSync`、`writeAtomicJson`、`chmod +x`、`jq`、TypeScript interface）且无解释，非技术读者难以理解 |
| CQ-04 | 所有必填章节已完成 | [x] | 概述、User Stories、功能需求、非功能需求、数据模型、接口、约束风险、成功标准均已填写 |

---

## Requirement Completeness（需求完整性）

| # | 检查项 | 结果 | Notes |
|---|--------|------|-------|
| RC-01 | 无 [NEEDS CLARIFICATION] 标记残留 | [ ] | 存在两处未解决标记：(1) FR-010 末尾："post-commit hook 是否应后台运行 spectra graph 以保证 < 3 秒？或接受同步但有超时上限？"；(2) 数据模型 GodNodeSummary 段落："graph.json 中社区数据的具体字段路径尚未在调研中明确，需确认 Feature 102 的输出结构" |
| RC-02 | 需求可测试且无歧义 | [ ] | FR-010 中 < 3 秒的测量范围因 [NEEDS CLARIFICATION] 未定义而存在歧义（hook 逻辑本身 < 100ms vs 整体含 spectra graph < 3 秒，NFR-002 与 FR-010 表述不完全一致）；社区数字段路径未知导致 SC-002 不可测 |
| RC-03 | 成功标准可测量 | [ ] | SC-002 依赖 "社区数量 K"，而该字段路径在数据模型中标注为 [NEEDS CLARIFICATION]，测量方法无法确定 |
| RC-04 | 成功标准是技术无关的 | [ ] | SC-007 "npx vitest run 所有单元测试零失败，npm run build 类型检查零错误"属于技术实现层验证，不是技术无关的业务成功标准 |
| RC-05 | 所有验收场景已定义 | [x] | 三个 User Story 各自包含完整的 Acceptance Scenarios（Given/When/Then 格式），Edge Cases 章节覆盖异常路径 |
| RC-06 | 边界条件已识别 | [x] | Edge Cases 章节涵盖 settings.json 格式错误、路径不一致、目录不存在、非 git 仓库、并发写入、God Node 超长、目录自动创建等场景 |
| RC-07 | 范围边界清晰 | [x] | 明确区分 spectra init（skill 安装）与 spectra install（hook 安装），明确只操作项目级配置，依赖 Feature 101/102 |
| RC-08 | 依赖和假设已识别 | [ ] | depends_on 列出 Feature 101 和 102，但 Feature 102 的 God Node 数据字段结构未在调研中确认（GodNodeSummary 中的 [NEEDS CLARIFICATION]），该依赖假设未解决 |

---

## Feature Readiness（特性就绪度）

| # | 检查项 | 结果 | Notes |
|---|--------|------|-------|
| FR-01 | 所有功能需求有明确的验收标准 | [ ] | FR-010（post-commit 执行时间约束）缺乏明确可验证标准，因异步/同步模式未定；FR-008（God Node 截断）标注为 SHOULD 而非 MUST，验收标准宽松但 [AUTO-RESOLVED] 标记说明已决策，勉强可接受 |
| FR-02 | 用户场景覆盖主要流程 | [x] | 安装（US1、US2）、幂等（US1/US2 场景 2、5）、静默降级（US1 场景 4）、卸载（US3）均有覆盖 |
| FR-03 | 功能满足 Success Criteria 中定义的可测量成果 | [ ] | SC-002 中 K（社区数）的数值来源字段未在规范中确认（依赖 Feature 102 结构），可测量性存疑；SC-005 描述"spectra graph 被自动触发，graph.json 的修改时间更新"，但 post-commit 异步/同步模式未定导致 mtime 验证可靠性不确定 |
| FR-04 | 规范中无实现细节泄漏 | [ ] | 同 CQ-01：数据模型章节包含完整 TypeScript interface，FR-001 指定具体源代码路径和函数名，FR-005 规定 shell 脚本具体命令（set -euo pipefail），FR-014 指定具体测试文件路径和框架（mkdtempSync、vitest）。这些属于 plan/tasks 层内容，不应出现在 spec 层 |

---

## 检查汇总

| 类别 | 总项数 | 通过 | 未通过 |
|------|--------|------|--------|
| Content Quality | 4 | 2 | 2 |
| Requirement Completeness | 8 | 3 | 5 |
| Feature Readiness | 4 | 1 | 4 |
| **合计** | **16** | **6** | **10** |

---

## 未通过项汇总与修复建议

### 高优先级（阻塞进入 plan 阶段）

1. **[NEEDS CLARIFICATION] 残留（RC-01）**
   - FR-010：post-commit hook 执行模式（异步后台 vs 同步超时）必须在规范中明确决策
   - 数据模型 GodNodeSummary：社区数据字段路径（`graph.json` 中社区字段名）必须与 Feature 102 确认后填写
   - 修复方式：回到 clarify 阶段，查阅 Feature 102 的输出结构，明确 post-commit 执行模式

2. **不可测量的成功标准（RC-03、RC-02）**
   - SC-002 依赖未定义的字段路径，无法编写可执行测试
   - FR-010 性能约束的测量范围定义冲突（FR-010 正文 vs NFR-002 的表述不一致）
   - 修复方式：待 [NEEDS CLARIFICATION] 解决后同步修正

3. **依赖假设未解决（RC-08）**
   - Feature 102 的 God Node 数据结构是本 Feature hook 脚本正确运行的前提，当前为未知状态
   - 修复方式：查阅 Feature 102 spec，确认字段路径后在 spec.md 中记录

### 中优先级（建议修复以提升规范质量）

4. **实现细节泄漏（CQ-01、FR-04）**
   - 数据模型章节（TypeScript interface）、FR-001（具体函数名和文件路径）、FR-005（shell 脚本命令行）、FR-014（具体测试框架和文件路径）属于 plan/tasks 层内容
   - 修复方式：将 TypeScript interface 移至 plan.md 数据契约章节；FR 层只保留"系统必须支持 X 功能"的行为描述

5. **成功标准含技术实现指标（RC-04）**
   - SC-007 引用 npx vitest 和 npm run build，属于测试框架层，不是业务成功标准
   - 修复方式：改为"所有安装、卸载、降级场景的行为符合规范要求"等业务层表述

6. **面向非技术读者友好度不足（CQ-03）**
   - 当前规范混合业务需求和技术实现，非技术利益相关者难以评审
   - 修复方式：在技术术语首次出现时添加简短说明，或将纯技术规范内容移至 plan.md

---

## 结论

**本规范未通过质量检查，不满足进入 plan 阶段的条件。**

核心阻塞原因：存在 2 处 `[NEEDS CLARIFICATION]` 未解决，导致 FR-010 性能约束、SC-002 可测量性、GodNodeSummary 字段路径均处于不确定状态，无法支撑后续的技术规划和测试设计。

建议先回到 **clarify 阶段**，解决上述两处澄清项后重新运行 quality checklist 验证。
