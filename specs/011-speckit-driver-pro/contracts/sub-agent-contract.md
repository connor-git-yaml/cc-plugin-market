# Sub-Agent Contract: 子代理输入输出契约

**Branch**: `011-speckit-driver-pro` | **Date**: 2026-02-15

## 通用契约

所有子代理共享以下契约规范。

### 调用方式

主编排器通过 Claude Code Task tool 调用子代理：

```text
Task(
  description: "{阶段简述}",
  prompt: "{子代理 prompt 内容} + {上下文注入}",
  subagent_type: "general-purpose",
  model: "{根据 spec-driver.config.yaml 确定}"
)
```

### 通用输入格式

每个子代理的 prompt 末尾会追加上下文注入块：

```markdown
---
## 运行时上下文（由主编排器注入）

**特性目录**: {feature_dir 绝对路径}
**特性分支**: {branch_name}
**前序制品**: {已完成阶段的制品路径列表}
**配置**: {相关配置片段}
---
```

### 通用输出格式

每个子代理必须：
1. 将制品写入文件系统（指定路径）
2. 在返回消息中包含执行摘要

返回消息格式：

```text
## 执行摘要

**阶段**: {阶段名}
**状态**: 成功/失败
**产出制品**: {文件路径}
**关键发现**: {1-3 句话概述}
**后续建议**: {建议（可选）}
```

---

## 各子代理专属契约

### constitution（宪法检查）

| 维度 | 说明 |
| ---- | ---- |
| **输入** | constitution.md 路径、需求描述文本 |
| **职责** | 检查需求是否违反项目宪法原则 |
| **输出** | 检查结果（PASS/VIOLATION + 详情） |
| **特殊** | 不生成文件，结果在返回消息中 |

---

### product-research（产品调研）

| 维度 | 说明 |
| ---- | ---- |
| **输入** | 需求描述、constitution 约束 |
| **职责** | 市场需求验证、竞品分析、用户场景验证 |
| **工具权限** | WebSearch / Perplexity MCP（Web 搜索）、Read（本地文件） |
| **输出文件** | `{feature_dir}/research/product-research.md` |
| **输出结构** | 市场现状、竞品对比表（≥3 个）、用户场景验证、MVP 范围建议 |
| **降级** | Web 搜索不可用时，基于本地代码库和 LLM 知识库分析 |

---

### tech-research（技术调研）

| 维度 | 说明 |
| ---- | ---- |
| **输入** | 需求描述、product-research.md（产品调研结论）、constitution 约束 |
| **职责** | 架构方案选型、依赖库评估、设计模式调研 |
| **工具权限** | WebSearch / Perplexity MCP、Read、Bash（版本查询） |
| **输出文件** | `{feature_dir}/research/tech-research.md` |
| **输出结构** | 架构方案对比表（≥2 个）、依赖库评估、设计模式推荐、技术风险清单 |
| **约束** | 必须基于产品调研结论进行技术评估，不得偏离产品方向 |

---

### specify（需求规范）

| 维度 | 说明 |
| ---- | ---- |
| **输入** | 需求描述、research-synthesis.md |
| **职责** | 生成结构化需求规范（User Stories + FR + SC） |
| **输出文件** | `{feature_dir}/spec.md` |
| **模板** | 使用 .specify/templates/spec-template.md 或项目已有模板 |
| **约束** | 高信心歧义（≤2 处）自动选择推荐项并标注 [AUTO-RESOLVED] |

---

### clarify（需求澄清）

| 维度 | 说明 |
| ---- | ---- |
| **输入** | spec.md |
| **职责** | 检测歧义，提出澄清问题（≤5 个），编码答案回 spec |
| **输出文件** | `{feature_dir}/spec.md`（更新） |
| **特殊** | 需要与用户交互。在 Driver Pro 的"信任但验证"策略下，clarify 子代理自动选择推荐答案（除非问题涉及 CRITICAL 决策点） |

---

### checklist（质量检查表）

| 维度 | 说明 |
| ---- | ---- |
| **输入** | spec.md |
| **职责** | 生成需求质量检查表并验证 |
| **输出文件** | `{feature_dir}/checklists/requirements.md` |
| **约束** | 所有检查项必须通过才能继续 |

---

### plan（技术规划）

| 维度 | 说明 |
| ---- | ---- |
| **输入** | spec.md、constitution.md、research-synthesis.md |
| **职责** | 生成技术计划（架构、数据模型、API 契约） |
| **输出文件** | `{feature_dir}/plan.md`、`research.md`、`data-model.md`、`contracts/` |
| **约束** | 必须通过 Constitution Check 门控 |

---

### tasks（任务分解）

| 维度 | 说明 |
| ---- | ---- |
| **输入** | plan.md、spec.md、data-model.md |
| **职责** | 生成按依赖排序的任务清单 |
| **输出文件** | `{feature_dir}/tasks.md` |
| **格式** | `- [ ] TXXX [P?] [USN?] 描述 + 文件路径` |

---

### analyze（一致性分析）

| 维度 | 说明 |
| ---- | ---- |
| **输入** | spec.md、plan.md、tasks.md |
| **职责** | 跨制品一致性和质量分析 |
| **输出** | 分析报告（返回消息中） |
| **触发质量门** | GATE_ANALYSIS（CRITICAL → 暂停，WARNING → 继续） |

---

### implement（代码实现）

| 维度 | 说明 |
| ---- | ---- |
| **输入** | tasks.md、plan.md、data-model.md、contracts/ |
| **职责** | 按任务清单实现代码 |
| **工具权限** | Read、Write、Edit、Bash（构建/测试）、Glob、Grep |
| **输出** | 源代码变更 + tasks.md 进度更新 |
| **约束** | 逐阶段实现（Setup → Tests → Core → Integration → Polish） |

---

### verify（验证闭环）

| 维度 | 说明 |
| ---- | ---- |
| **输入** | spec.md、tasks.md、项目源代码 |
| **职责** | Layer 1 Spec-Code 对齐 + Layer 2 原生工具链验证 |
| **工具权限** | Read、Bash（构建/Lint/测试命令执行）、Glob |
| **输出文件** | `{feature_dir}/verification/verification-report.md` |
| **触发质量门** | GATE_VERIFY（构建/测试失败 → 暂停） |
| **降级** | 工具未安装时标记 "未安装"，不阻断 |

验证报告结构：

```markdown
# Verification Report

## Layer 1: Spec-Code Alignment
- FR-001: ✅ 已实现 | ❌ 未实现 | ⚠️ 部分实现
...

## Layer 2: Native Toolchain
### TypeScript (npm)
- Build: ✅ PASS
- Lint: ⚠️ 2 warnings
- Test: ✅ 18/18 passed

### Rust (Cargo)
- Build: ✅ PASS
- Lint (clippy): ✅ PASS
- Test: ✅ 42/42 passed

## Summary
- Spec Coverage: 95% (19/20 FR implemented)
- Build Status: PASS
- Test Status: PASS
- Overall: ✅ READY FOR REVIEW
```
