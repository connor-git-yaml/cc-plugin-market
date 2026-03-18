# Quality Checklist: 030-java-language-adapter

**Feature**: Java LanguageAdapter 实现
**Spec Version**: Draft (2026-03-17)
**Checked By**: Quality Checklist Sub-Agent
**Date**: 2026-03-17

---

## Content Quality (内容质量)

- [ ] **CQ-01: 无实现细节** -- 未提及具体语言、框架、API 实现方式
  - **Status**: FAIL
  - **Notes**: 规范中大量引用了实现层面的具体细节：
    1. 具体源文件名：`tree-sitter-fallback.ts`、`file-scanner.ts`、`single-spec-orchestrator.ts`、`batch-orchestrator.ts`、`query-mappers/java-mapper.ts`（含行数 "482 行完整实现"）
    2. 具体类/函数名作为实现指令：`TreeSitterAnalyzer.analyze(filePath, 'java')`（FR-005）、`regexFallback()` 函数（FR-018）、`bootstrapAdapters()` 函数（FR-023）、`extractVisibility()`、`_extractClassLike()`（Edge Cases）
    3. 具体技术返回值：`parserUsed` 为 `'tree-sitter'`（FR-006）、`CodeSkeleton` 数据结构（FR-005/FR-006/FR-017）
    4. 具体实现架构描述："委托模式"、"JavaLanguageAdapter 主要是一个'胶水层'"
    5. SC-005 直接指定了文件修改范围（"仅需一个新源文件 + 修改 `bootstrapAdapters()` 注册代码 + `tree-sitter-fallback.ts` 新增 Java 正则降级"）

- [x] **CQ-02: 聚焦用户价值和业务需求** -- 规范围绕用户需求展开
  - **Status**: PASS
  - **Notes**: 概述与动机部分清晰阐述了用户价值（企业级 Java 项目支持、多语言路线延续）。8 个 User Story 均以用户视角编写（"作为一个 reverse-spec 用户..."）。

- [ ] **CQ-03: 面向非技术利益相关者编写** -- 非技术人员可理解
  - **Status**: FAIL
  - **Notes**: 大量引用了内部代码结构（TreeSitterAnalyzer、CodeSkeleton、JavaMapper、bootstrapAdapters 等），非技术利益相关者无法理解这些引用。Edge Cases 部分深入到 AST 节点层面（"rootNode 的直接子节点"、"extractVisibility() 返回 undefined"），完全是开发者视角。

- [x] **CQ-04: 所有必填章节已完成** -- 包含概述、User Scenarios、Requirements、Success Criteria
  - **Status**: PASS
  - **Notes**: 规范包含所有必填章节：概述与动机、User Scenarios & Testing（含 8 个 User Story + Edge Cases）、Requirements（28 个 FR）、Key Entities、Success Criteria（7 个 SC）。

---

## Requirement Completeness (需求完整性)

- [x] **RC-01: 无 [NEEDS CLARIFICATION] 标记残留**
  - **Status**: PASS
  - **Notes**: 全文搜索未发现任何 `[NEEDS CLARIFICATION]` 标记。存在 `[AUTO-RESOLVED]` 标记（Edge Cases 中两处），表明已自行解决的澄清项。

- [x] **RC-02: 需求可测试且无歧义** -- 每个需求都有明确的可验证条件
  - **Status**: PASS
  - **Notes**: 28 个 Functional Requirements 均使用 MUST/SHOULD/MAY 层级标注，每个 MUST 需求都有具体的可验证条件（如 FR-002: id 为 'java'；FR-020: filePattern 匹配四种命名约定）。User Story 的 Acceptance Scenarios 使用 Given-When-Then 格式，条件明确。

- [ ] **RC-03: 成功标准可测量** -- Success Criteria 包含可量化的指标
  - **Status**: FAIL
  - **Notes**: SC-005 不是可测量的成功标准，而是实现约束（"仅需一个新源文件 + 修改 bootstrapAdapters() 注册代码 + tree-sitter-fallback.ts 新增 Java 正则降级"）。成功标准应衡量功能是否达成目标，而非规定实现方式。其余 SC（SC-001 至 SC-004、SC-006、SC-007）可测量。

- [ ] **RC-04: 成功标准是技术无关的** -- 不涉及具体技术实现
  - **Status**: FAIL
  - **Notes**:
    1. SC-005 完全是技术实现约束，指定了具体文件名和修改范围
    2. SC-006 指定了"单元测试覆盖"和"测试数量不少于 15 个"，这是技术实现层面的度量标准，不属于需求层面的成功标准

- [x] **RC-05: 所有验收场景已定义** -- 每个 User Story 包含完整的验收场景
  - **Status**: PASS
  - **Notes**: 8 个 User Story 均包含 Acceptance Scenarios（共 18 个场景），覆盖正常流程和关键变体。Edge Cases 部分补充了 10 个边界场景（空文件、语法错误、package-private、内部类、多类文件、module-info.java、超大文件、annotation、static import、多声明符）。

- [x] **RC-06: 边界条件已识别** -- Edge Cases 已定义
  - **Status**: PASS
  - **Notes**: Edge Cases 章节列出了 10 个边界场景，覆盖了空文件、仅注释文件、语法错误、package-private 可见性、内部类、多类文件、module-info.java、超大文件、annotation 提取范围、static import 语义等。每个边界场景都关联了相关的 FR。

- [x] **RC-07: 范围边界清晰** -- 明确定义了 Feature 的范围内外
  - **Status**: PASS
  - **Notes**: 规范通过以下方式界定范围：
    1. FR-026 明确标注 `buildDependencyGraph()` 为可选（MAY），初始版本可不实现
    2. FR-027/FR-028 定义了零回归和零新依赖约束
    3. Edge Cases 中 `[AUTO-RESOLVED]` 标记明确了已知限制（内部类仅间接呈现）
    4. 与 PythonLanguageAdapter（028）和 GoLanguageAdapter（029）的"完全同构"关系明确了实现范式

- [x] **RC-08: 依赖和假设已识别** -- 前置依赖和假设已列出
  - **Status**: PASS
  - **Notes**: 规范明确列出了依赖：Feature 025（LanguageAdapter 接口，已完成）和 Feature 027（tree-sitter 多语言后端 + JavaMapper，已完成）。Blueprint 024 的上下文关系也已说明。FR-028 明确假设无新增运行时依赖。

---

## Feature Readiness (特性就绪度)

- [x] **FE-01: 所有功能需求有明确的验收标准** -- FR 与验收场景有关联
  - **Status**: PASS
  - **Notes**: 28 个 FR 中每个都标注了关联的 User Story（如 `*关联: US-1*`、`*关联: US-4 Scenario 2, US-8*`），可追溯到具体的验收场景。

- [x] **FE-02: 用户场景覆盖主要流程** -- 核心用户流程已覆盖
  - **Status**: PASS
  - **Notes**: 8 个 User Story 覆盖了 Java 适配器的全部主要流程：spec 生成（US-1）、类成员提取（US-2）、import 依赖（US-3）、自动路由（US-4）、降级容错（US-5）、术语参数化（US-6）、测试文件识别（US-7）、忽略目录（US-8）。优先级分配合理（P1/P2/P3）。

- [x] **FE-03: 功能满足 Success Criteria 中定义的可测量成果**
  - **Status**: PASS
  - **Notes**: SC-001（端到端 spec 生成）对应 US-1/FR-005 至 FR-016；SC-002（访问修饰符）对应 US-2/FR-011；SC-003（泛型信息）对应 US-1/US-2/FR-007/FR-012；SC-004（零回归）对应 FR-027；SC-007（测试文件识别）对应 US-7/FR-020。功能需求与成功标准之间有清晰的映射关系。

- [ ] **FE-04: 规范中无实现细节泄漏** -- 不包含技术实现方案
  - **Status**: FAIL
  - **Notes**: 与 CQ-01 相同。规范中存在大量实现细节泄漏，包括：
    1. FR-005 指定了委托方式（"`TreeSitterAnalyzer.analyze(filePath, 'java')`"）
    2. FR-006 指定了返回值字段（`parserUsed` 为 `'tree-sitter'`）
    3. FR-018 指定了具体的修改位置（"`tree-sitter-fallback.ts` 的 `regexFallback()` 函数"）
    4. FR-023 指定了注册位置（"`bootstrapAdapters()` 函数"）
    5. 现状描述中包含具体文件路径和行数（"query-mappers/java-mapper.ts，482 行完整实现"）
    6. Key Entities 章节描述了内部组件的实现关系

---

## Summary

| Dimension | Total | Passed | Failed |
|-----------|-------|--------|--------|
| Content Quality | 4 | 2 | 2 |
| Requirement Completeness | 8 | 6 | 2 |
| Feature Readiness | 4 | 3 | 1 |
| **Total** | **16** | **11** | **5** |

## Failed Items Detail

| ID | Item | Issue |
|----|------|-------|
| CQ-01 | 无实现细节 | 规范引用了 24 处内部代码结构（类名、函数名、文件名、行数），违反需求规范不应包含实现细节的原则 |
| CQ-03 | 面向非技术利益相关者编写 | Edge Cases 和 FR 中大量使用开发者视角描述（AST 节点、函数签名、返回值字段），非技术人员无法理解 |
| RC-03 | 成功标准可测量 | SC-005 是实现约束而非可测量的成功标准 |
| RC-04 | 成功标准是技术无关的 | SC-005 指定了具体文件修改范围，SC-006 指定了单元测试数量 |
| FE-04 | 规范中无实现细节泄漏 | FR-005/FR-006/FR-018/FR-023/SC-005 等多处包含具体技术实现方案 |

## Remediation Suggestions

1. **移除实现层面的引用**: 将 FR-005 中的 "委托 `TreeSitterAnalyzer.analyze(filePath, 'java')`" 改为 "通过系统的 AST 解析能力完成 Java 文件分析"；FR-018 中的 "tree-sitter-fallback.ts 的 regexFallback() 函数" 改为 "系统的正则降级模块"；FR-023 中的 "bootstrapAdapters() 函数" 改为 "系统的适配器注册机制"。
2. **重写 SC-005**: 将实现约束（"仅需一个新源文件..."）替换为可测量的成功标准，例如 "新增 Java 适配器不需要修改现有的文件扫描、spec 生成和批量处理等核心流水线模块的代码"。
3. **调整 SC-006**: 将 "单元测试覆盖所有 MUST 级别需求，测试数量不少于 15 个" 改为技术无关的表述，如 "所有 MUST 级别功能需求均有对应的自动化验证"。
4. **简化 Edge Cases 中的技术引用**: 移除 `[AUTO-RESOLVED]` 标记中对 `extractVisibility()` 函数行为和 `_extractClassLike()` 过滤条件的引用，改为用户可理解的行为描述。
5. **精简 Key Entities**: 保留实体名称和职责描述，移除实现关系描述（如 "482 行完整实现"、"JavaLanguageAdapter 通过 TreeSitterAnalyzer 间接使用"）。
6. **现状描述去实现化**: 概述中的现状部分应聚焦于"用户当前无法分析 Java 项目"的问题陈述，而非描述内部模块的现有状态。
