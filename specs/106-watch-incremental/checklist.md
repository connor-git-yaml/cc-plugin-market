# Feature 106 质量检查清单：文件监听 + 增量批处理模式

**Feature Branch**: `106-watch-incremental`  
**生成时间**: 2026-04-12  
**基于规范**: `specs/106-watch-incremental/spec.md`

---

## Content Quality（内容质量）

| # | 检查项 | 状态 | Notes |
|---|--------|------|-------|
| CQ-01 | 无实现细节（未提及具体语言、框架、API 实现方式） | [ ] | spec 正文多处直接提及 chokidar（FR-005、FR-020、Story 5）、`fs.watch`、`_meta/needs_update` 字段名、原子写入机制、lock 机制等实现细节，超出需求规范边界 |
| CQ-02 | 聚焦用户价值和业务需求 | [x] | 用户场景章节清晰描述了开发者在编码中保持文档同步的业务价值 |
| CQ-03 | 面向非技术利益相关者编写 | [ ] | 功能需求章节（FR-013 原子写入、FR-014 内容哈希校验、FR-007 manifest 写入竞争）包含大量面向实现者的技术描述，非技术利益相关者难以理解 |
| CQ-04 | 所有必填章节已完成 | [x] | 用户场景、功能需求、成功标准、复杂度评估均已填写 |

---

## Requirement Completeness（需求完整性）

| # | 检查项 | 状态 | Notes |
|---|--------|------|-------|
| RC-01 | 无 [NEEDS CLARIFICATION] 标记残留 | [x] | 规范中无残留 [NEEDS CLARIFICATION] 标记 |
| RC-02 | 需求可测试且无歧义 | [x] | 每个 User Story 均提供了 Independent Test 和 Acceptance Scenarios，可测试性良好 |
| RC-03 | 成功标准可测量 | [x] | SC-001 至 SC-007 均有具体数值或可观察结果（如 5 秒内、20 秒内、50MB、非零退出码） |
| RC-04 | 成功标准是技术无关的 | [x] | 成功标准描述从用户可观察行为出发，未绑定实现技术 |
| RC-05 | 所有验收场景已定义 | [x] | 5 个 User Story 均包含 Acceptance Scenarios，Edge Cases 章节补充了边界场景 |
| RC-06 | 边界条件已识别 | [x] | Edge Cases 章节覆盖了并发写入、目录删除、进程强杀、生成失败、超大量文件、.gitignore 热重载、无 manifest 等 7 个边界场景 |
| RC-07 | 范围边界清晰 | [x] | FR-015 明确标注 [YAGNI-移除]，FR-012 标注 [可选]，优先级通过 P1/P2/P3 清晰分层 |
| RC-08 | 依赖和假设已识别 | [x] | FR-020 明确唯一新增外部依赖为 chokidar；复杂度评估列出了跨模块耦合的 3 个现有文件；Edge Case 中提及依赖现有 manifest 初始化前置条件 |

---

## Feature Readiness（特性就绪度）

| # | 检查项 | 状态 | Notes |
|---|--------|------|-------|
| FR-A | 所有功能需求有明确的验收标准 | [x] | FR-001 至 FR-020 均可映射到 Acceptance Scenarios 或 Success Criteria 中的可测量条件 |
| FR-B | 用户场景覆盖主要流程 | [x] | 覆盖了 watch 启动与自动同步（Story 1）、手动增量更新（Story 2）、忽略规则（Story 3）、变更分类展示（Story 4）、降级处理（Story 5）等主要流程 |
| FR-C | 功能满足 Success Criteria 中定义的可测量成果 | [x] | FR 章节中的 MUST 需求与 SC-001 至 SC-007 之间存在清晰映射（如 FR-002 debounce → SC-001，FR-018/019 性能 → SC-003/004） |
| FR-D | 规范中无实现细节泄漏 | [ ] | 与 CQ-01 相同问题：FR-013（原子写入、临时文件替换）、FR-014（内容哈希校验逻辑复用）、FR-007（lock 机制）、FR-005（chokidar/fs.watch 具体 API）、Key Entities（WatchSession、StaleMarker 等代码级实体）属于实现细节，不应出现在需求规范中 |

---

## 汇总

| 维度 | 通过 | 未通过 |
|------|------|--------|
| Content Quality | 2/4 | CQ-01、CQ-03 |
| Requirement Completeness | 8/8 | — |
| Feature Readiness | 3/4 | FR-D |

**总计**：16 项检查，13 项通过，**3 项未通过**。

---

## 未通过项汇总与修复建议

### CQ-01 / FR-D：实现细节泄漏（高优先级）

**问题**：以下内容属于实现层，不应出现在需求规范中：
- FR-005：提及 chokidar、fs.watch 具体降级机制
- FR-007：提及 lock 机制、manifest 写入竞争
- FR-013：提及原子写入、临时文件替换策略
- FR-014：提及内容哈希校验逻辑
- FR-020：将 chokidar 列为唯一允许的外部依赖（限定了实现选型）
- Key Entities：WatchSession、StaleMarker、FileChangeEvent 等是代码级实体而非业务概念
- Edge Cases 中多处描述了实现层行为（如"原子化写入"、"manifest schema"）

**修复建议**：将上述内容从 spec.md 移至 plan.md 或 tasks.md；需求规范层面只描述"系统应能从文件监听失败中恢复并继续运行"，而不是"降级到 fs.watch"。

### CQ-03：技术利益相关者语言（中优先级）

**问题**：功能需求章节（FR-007、FR-013、FR-014）使用了并发控制、manifest 原子写入、内容哈希等仅技术人员能理解的表述。

**修复建议**：将 FR 章节重写为用户可理解的能力描述，例如将"原子写入"改为"系统保证即使在意外中断时文档索引文件不会损坏"。

---

**结论**：规范在需求完整性维度表现优秀，但在内容质量上存在系统性实现细节泄漏问题。建议回到 specify 阶段，将实现层内容（chokidar、原子写入、lock 策略、代码实体等）迁移至 plan.md，同时用业务语言重写对应的功能需求条目。
