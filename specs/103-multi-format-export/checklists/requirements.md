# Feature 103 multi-format-export — 需求规范质量检查清单

**检查日期**: 2026-04-12
**检查对象**: `specs/103-multi-format-export/spec.md`
**检查人**: 质量检查表子代理

---

## Content Quality（内容质量）

| # | 检查项 | 状态 | Notes |
|---|--------|------|-------|
| CQ-1 | 无实现细节（未提及具体语言、框架、API 实现方式） | `[ ]` | spec.md 在 Key Entities 和复杂度评估中直接出现了 `obsidian-exporter.ts`、`html-exporter.ts`、`html-template.ts`、`export-types.ts`、`src/cli/commands/export.ts` 等具体文件名；FR-016 提到"调用 `detectCommunities()`"、FR-018 提到"在 `html-template.ts` 顶部注释中记录内联 d3 的版本号"——均属于实现层细节，不应出现在需求规范中 |
| CQ-2 | 聚焦用户价值和业务需求 | `[x]` | 三个 User Story 均以用户目标为核心叙述，功能需求条目描述"系统应做什么"而非"如何做" |
| CQ-3 | 面向非技术利益相关者编写 | `[ ]` | 复杂度评估章节（GATE_DESIGN 审查部分）、FR-016 中的 `nodeCommunityMap`、FR-018 中的 `html-template.ts` 等，包含大量只有开发者才能理解的技术术语和文件路径，不适合非技术利益相关者阅读 |
| CQ-4 | 所有必填章节已完成 | `[x]` | User Scenarios、Requirements、Success Criteria、Edge Cases 均已完整填写，无空白章节 |

**内容质量小计**: 2/4 通过

---

## Requirement Completeness（需求完整性）

| # | 检查项 | 状态 | Notes |
|---|--------|------|-------|
| RC-1 | 无 `[NEEDS CLARIFICATION]` 标记残留 | `[x]` | 全文检索无 `[NEEDS CLARIFICATION]` 残留，自动解决的歧义已用 `[AUTO-RESOLVED]` 说明 |
| RC-2 | 需求可测试且无歧义 | `[x]` | 每条 FR 均有明确的 Given/When/Then 验收场景对应；"模糊搜索"、"高亮"等概念在场景中有具体行为描述 |
| RC-3 | 成功标准可测量 | `[x]` | SC-001 至 SC-006 均含有可量化指标（秒数、MB、fps、退出码）；SC-007 以测试覆盖路径为可验证标准 |
| RC-4 | 成功标准是技术无关的 | `[ ]` | SC-007 描述"单元测试覆盖 obsidian-exporter 和 html-exporter 核心函数"，直接指明了实现文件名，属于技术层面约束；应表述为"核心导出功能有自动化测试覆盖，端到端路径可回归验证" |
| RC-5 | 所有验收场景已定义 | `[x]` | User Story 1 有 5 个、User Story 2 有 6 个、User Story 3 有 4 个验收场景，覆盖主流程和错误路径 |
| RC-6 | 边界条件已识别 | `[x]` | Edge Cases 章节覆盖 7 个边界情况：文件缺失、特殊字符文件名、大图降级、无社区归属节点、悬空边、spec 节点无可选字段、文件名超长 |
| RC-7 | 范围边界清晰 | `[x]` | 明确声明 d3 不作为 npm 运行时依赖；FR-017、FR-018、FR-019 区分了 MUST/SHOULD/MAY 优先级；与 Feature 101/102 的数据边界在 Key Entities 中明确 |
| RC-8 | 依赖和假设已识别 | `[x]` | Frontmatter 明确列出 Feature 101 和 Feature 102 为前置依赖；FR-016 说明 `nodeCommunityMap` 不持久化需重建这一假设；Edge Cases 中覆盖上游数据缺失时的行为 |

**需求完整性小计**: 6/8 通过

---

## Feature Readiness（特性就绪度）

| # | 检查项 | 状态 | Notes |
|---|--------|------|-------|
| FR-A | 所有功能需求有明确的验收标准 | `[x]` | FR-001~FR-015 均可在 User Story 验收场景中找到对应的 Given/When/Then 测试路径；FR-016~FR-019 辅助需求在 Edge Cases 中有行为说明 |
| FR-B | 用户场景覆盖主要流程 | `[x]` | Obsidian 导出（P1）、HTML 交互导出（P1）、CLI 命令集成（P2）三个核心流程均有独立 User Story 覆盖，且每个 Story 说明了独立测试路径 |
| FR-C | 功能满足 Success Criteria 中定义的可测量成果 | `[x]` | SC-001~SC-006 分别与 FR-001~FR-015 有明确映射标注（如 `[FR-001~FR-005]`）；性能目标（5秒/3秒/60fps/2MB）在 FR 和 SC 中均有体现 |
| FR-D | 规范中无实现细节泄漏 | `[ ]` | 与 CQ-1 问题一致：Key Entities 章节列出了具体 TypeScript 文件名（`obsidian-exporter.ts` 等）；复杂度评估章节出现了接口函数名（`generateObsidianVault()`、`generateHtml()`、`sanitizeFilename()`）；这些内容应在 plan.md 中描述，不应出现在需求规范中 |

**特性就绪度小计**: 3/4 通过

---

## 定制检查项（Feature 103 专项）

| # | 检查项 | 状态 | Notes |
|---|--------|------|-------|
| F103-1 | Obsidian 输出格式验证：双向链接格式 `[[filename]]`（不含路径前缀）已明确定义 | `[x]` | FR-004 和 SC-005 均明确要求 `[[filename]]` 格式；验收场景 1.2 验证链接格式 |
| F103-2 | Obsidian 文件名规范（无非法字符、长度 < 200）已在需求中定义 | `[x]` | FR-005 列出了完整的非法字符集合 `/ \ : * ? " < > |`；Edge Cases 说明了超长文件名截断策略 |
| F103-3 | HTML 交互功能（搜索、点击、缩放、社区过滤）均有验收场景 | `[x]` | User Story 2 场景 3-5 和 FR-008~FR-011 完整覆盖四项交互功能 |
| F103-4 | 性能目标（生成时间、渲染帧率、文件大小）均已量化 | `[x]` | SC-001（5秒）、SC-002（3秒、2MB）、SC-003（60fps）已完整定义 |
| F103-5 | CLI 参数（`--format`、`--output-dir`、默认值、错误处理）验收场景完整 | `[x]` | User Story 3 场景 1-4 覆盖了帮助显示、默认目录、无效格式、数据缺失四个路径 |
| F103-6 | 与上游 Feature 101/102 的数据接口边界已明确（输入数据类型） | `[x]` | Key Entities 中定义了 `GraphJSON`、`CommunityResult`、`GodNode[]` 作为输入类型，与 Feature 101/102 产出的数据格式对应 |
| F103-7 | 大图（> 5,000 节点）降级策略已定义且有可测量的成功标准 | `[x]` | FR-012 和 SC-003 均明确了 5,000 节点阈值和 60fps 交互目标 |
| F103-8 | graceful exit 行为（数据缺失时）已定义且有明确提示要求 | `[x]` | FR-015、SC-006 和 Edge Cases 均定义了 graceful exit 行为，包括退出码非零和用户友好提示 |

**Feature 103 专项小计**: 8/8 通过

---

## 汇总

| 维度 | 通过 | 总数 | 通过率 |
|------|------|------|--------|
| Content Quality | 2 | 4 | 50% |
| Requirement Completeness | 6 | 8 | 75% |
| Feature Readiness | 3 | 4 | 75% |
| Feature 103 专项 | 8 | 8 | 100% |
| **合计** | **19** | **24** | **79%** |

---

## 未通过项汇总与修复建议

### CQ-1 / FR-D：规范中包含实现细节（高优先级）

**问题**：spec.md 在以下位置出现了实现层细节，违反"需求规范不应包含实现细节"原则：
- Key Entities 章节列出了具体 TypeScript 文件名（`obsidian-exporter.ts`、`html-exporter.ts` 等）
- 复杂度评估章节出现了函数接口名（`generateObsidianVault()`、`sanitizeFilename()` 等）
- FR-016 提及调用 `detectCommunities()`
- FR-018 提及在 `html-template.ts` 顶部注释记录版本号

**修复建议**：
- 将复杂度评估章节移至 plan.md（属于技术设计范畴）
- Key Entities 仅保留业务实体描述（ExportOptions、ExportResult、ObsidianPage、HtmlBundle），移除文件路径映射
- FR-016 改写为："系统在导出时 MUST 确保社区归属数据已可用，若该数据为非持久化状态，需在导出前重新计算"
- FR-018 改写为："HTML 产物 SHOULD 包含可追溯的 d3 库版本信息，便于后续维护"

### CQ-3：部分内容不适合非技术利益相关者

**问题**：复杂度评估（GATE_DESIGN）章节全部采用技术语言，非技术读者无法理解其目的。

**修复建议**：将"复杂度评估（供 GATE_DESIGN 审查）"整节移至 plan.md，spec.md 应保持面向业务的表达。

### RC-4：SC-007 成功标准包含技术术语

**问题**：SC-007 直接引用实现文件名作为验证标准。

**修复建议**：改写为"核心导出功能（Obsidian Vault 生成、HTML 生成）有自动化单元测试覆盖，且存在从知识图谱数据到最终产物的端到端集成测试路径"。

---

**结论**：本规范有 5 项检查未通过（CQ-1 和 FR-D 为同一根本问题）。建议回到 specify 阶段，将实现细节（文件名、函数名、复杂度评估）迁移至 plan.md，并修正 SC-007 的表述，再重新执行质量检查。
