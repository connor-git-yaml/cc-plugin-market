# Requirements Checklist: sync 合并算法确定性化

**Purpose**: 对 spec.md 的需求质量进行逐项检查——验证需求本身是否完备、清晰、一致、可度量
**Created**: 2026-04-06
**Feature**: [spec.md](../spec.md)
**Reviewed by**: checklist sub-agent

---

## Scope & Boundary

- [x] CHK001 - 是否明确 091 只提取当前 sync.md 已有的确定性操作，不扩展合并功能？ [Completeness, Spec Constraints]
- [x] CHK002 - 是否明确决策与执行的分离边界：Agent 负责语义决策，脚本负责确定性执行？ [Clarity, Spec Overview]
- [x] CHK003 - 是否明确 sync 整体编排流程不变（仍由 sync Agent 驱动），只是部分操作外移至脚本？ [Clarity, Spec Constraints]
- [x] CHK004 - 是否明确前置依赖（090 + 092 合并到 master 后执行）？ [Completeness, Spec Dependencies]
- [x] CHK005 - "范围内"和"范围外"列表是否覆盖了所有容易产生歧义的边界区域？ [Coverage, Spec Constraints]

## Determinism Requirements

- [x] CHK006 - 是否要求同一输入产生完全一致的 JSON 输出（确定性保障）？ [Completeness, Spec SC-002]
- [x] CHK007 - 是否要求所有 lib 模块为纯函数导出，无副作用？ [Clarity, Spec FR-012]
- [x] CHK008 - 是否要求文件 I/O 仅在入口脚本中完成，lib 模块不做 side effect？ [Clarity, Spec FR-012]
- [x] CHK009 - 确定性的定义是否无歧义——"完全一致"是指字节级一致还是语义等价？ [Clarity, Spec SC-002]
      > PASS: SC-002 明确写了"JSON 输出完全一致"，结合 US1 的"比对 JSON 输出完全一致"，语义为字节级一致

## Prompt Slimming

- [x] CHK010 - 是否要求 sync.md 瘦身至 <5,000 bytes？ [Completeness, Spec FR-008 / SC-001]
- [x] CHK011 - 是否要求瘦身后 Prompt 仅保留语义决策层（产品归属推断、14 章融合、信息推断、摘要生成）？ [Completeness, Spec FR-008]
- [x] CHK012 - 是否要求确定性操作（排序、匹配、差集、格式校验）不出现在瘦身后的 Prompt 中？ [Clarity, Spec FR-008]
- [ ] CHK013 - Prompt 瘦身后的"质量不低于当前版本"（US3 场景 3）是否有可度量的验收标准？ [Measurability, Spec US3-AC3]
      > FAIL: "质量不低于"是主观描述，缺乏可客观度量的指标（如：功能条目数量 >= 基线、章节结构完整度、特定字段覆盖率等）

## Dry-run Mode

- [x] CHK014 - 是否要求 `--dry-run` 模式不修改任何文件？ [Completeness, Spec FR-007 / SC-003]
- [x] CHK015 - 是否要求默认输出人类可读混合格式（统计摘要 + 关键变更）？ [Clarity, Spec FR-007]
- [x] CHK016 - 是否要求 `--dry-run --json` 输出 machine-readable JSON？ [Completeness, Spec FR-007]
- [x] CHK017 - `--dry-run` 和 `--json` 同时使用的行为是否在 Edge Cases 中明确？ [Coverage, Spec Edge Cases]
- [ ] CHK018 - "混合格式预览"的具体输出结构是否有定义（哪些字段、什么排版）？ [Clarity, Spec FR-007]
      > FAIL: FR-007 仅描述"统计摘要 + 关键变更"，未定义具体输出字段和结构。machine-readable JSON 的 schema 也未给出

## Independence & Runtime

- [x] CHK019 - 是否要求脚本可通过 `node sync-merge-engine.mjs` 独立运行，不依赖 Claude Code 运行时？ [Completeness, Spec FR-010 / SC-004]
- [x] CHK020 - 是否要求零 npm 依赖，仅使用 Node.js 内置模块？ [Completeness, Spec NFR-001]
- [x] CHK021 - 是否要求复用现有 helper（simple-yaml.mjs、product-artifact-paths.mjs、script-report-io.mjs）？ [Completeness, Spec NFR-003]
- [ ] CHK022 - 当 `--project-root` 参数指向无效路径或缺失时，脚本的行为是否有定义？ [Coverage, Gap]
      > FAIL: 未定义 --project-root 路径不存在、权限不足、不是有效项目目录等场景的预期行为

## Degradation & Compatibility

- [x] CHK023 - 是否要求降级兼容：脚本不可用时 sync Agent 按简化规则完成合并？ [Completeness, Spec FR-009 / US5]
- [x] CHK024 - 降级触发条件是否覆盖"文件不存在"和"执行返回非零退出码"两种场景？ [Coverage, Spec US5]
- [ ] CHK025 - 降级路径中 Agent 使用的"简化规则"具体内容是否有描述或引用？ [Clarity, Spec FR-009]
      > FAIL: FR-009 提到"降级路径描述"，Architecture Notes 估算约 500 bytes，但未定义这些简化规则的具体行为——Agent 在降级模式下如何完成合并的最低要求未明确

## Interface Contract

- [x] CHK026 - 是否要求 JSON 输出包含 schemaVersion 字段防止接口漂移？ [Completeness, Spec FR-011 / NFR-005]
- [x] CHK027 - 是否要求 Agent Prompt 声明期望的 schema version？ [Completeness, Spec Architecture Notes]
- [ ] CHK028 - schemaVersion 不匹配时（Agent 期望 v2 但脚本返回 v1）的行为是否有定义？ [Coverage, Gap]
      > FAIL: 虽然有 schemaVersion 字段要求，但未定义版本不匹配时的具体处理策略（报错中断？降级？警告继续？）

## Code Style & Conventions

- [x] CHK029 - 是否要求遵循现有 scripts/lib/ 模块化风格（.mjs、ES Module、import.meta.url 守卫）？ [Consistency, Spec NFR-002]
- [x] CHK030 - 是否要求错误处理遵循现有模式（关键文件抛 Error、可选文件返回 null、警告收集）？ [Consistency, Spec NFR-004]
- [x] CHK031 - 是否要求中文错误信息？ [Consistency, Spec NFR-004]

## Verification & Success Criteria

- [x] CHK032 - 是否要求 `npm run repo:check` 通过？ [Completeness, Spec SC-005]
- [x] CHK033 - 是否明确 current-spec.md 14 章模板结构不变？ [Clarity, Spec Constraints]
- [x] CHK034 - 是否明确不修改 entity.yaml / catalog-index.yaml 等后置 helper 逻辑？ [Clarity, Spec Constraints]
- [x] CHK035 - SC-001 到 SC-006 是否都有可客观度量的指标？ [Measurability, Spec Success Criteria]
      > PASS: SC-001 文件大小, SC-002 字节一致, SC-003 文件不变, SC-004 exit code 0, SC-005 脚本通过, SC-006 纯函数属性——均可度量

## User Stories Coverage

- [x] CHK036 - 是否为每个 User Story 提供了 Given/When/Then 格式的验收场景？ [Completeness, Spec US1-US5]
- [x] CHK037 - 是否为每个 User Story 提供了 Independent Test 描述？ [Completeness, Spec US1-US5]
- [x] CHK038 - User Story 优先级标记（P1/P2）是否覆盖所有 story？ [Completeness, Spec US1-US5]
- [x] CHK039 - 是否有 Edge Cases 章节覆盖异常/边界场景？ [Coverage, Spec Edge Cases]

## Edge Case & Exception Requirements

- [x] CHK040 - YAML Front Matter 缺失时的宽松解析行为是否有定义？ [Coverage, Spec Edge Cases]
- [x] CHK041 - product-mapping.yaml 不存在时返回空映射的行为是否有定义？ [Coverage, Spec Edge Cases]
- [x] CHK042 - 编号冲突（同编号不同目录）的处理策略是否有定义？ [Coverage, Spec Edge Cases]
- [x] CHK043 - spec 数量为 0 的产品处理策略是否有定义？ [Coverage, Spec Edge Cases]
- [x] CHK044 - 超大 spec 目录（>200）的性能评估是否有记录？ [Coverage, Spec Edge Cases]
- [ ] CHK045 - 并发写入场景（多个 Agent 同时调用合并脚本）是否有定义？ [Coverage, Gap]
      > FAIL: 未说明是否允许并发执行，或是否需要文件锁等机制。鉴于 Agent 串行编排，风险较低，但 spec 未显式声明这一假设

## Risk & Dependencies

- [x] CHK046 - 是否有风险表且覆盖主要技术风险？ [Completeness, Spec Dependencies & Impacts]
- [x] CHK047 - 每个风险是否有"影响/概率/缓解措施"三要素？ [Completeness, Spec Risk Table]
- [x] CHK048 - 影响范围是否列出所有受影响的文件和流程？ [Completeness, Spec Dependencies & Impacts]

## Spec 格式与合规

- [x] CHK049 - 是否使用中文正文 + 英文技术术语？ [Consistency, Spec Rules]
- [x] CHK050 - YAML Frontmatter 是否使用英文 key？ [Consistency, Spec Rules]
- [x] CHK051 - 是否有未解决的 [NEEDS CLARIFICATION] 或 [TODO] 标记？ [Completeness]
      > PASS: 全文无未解决的澄清标记
- [x] CHK052 - Functional Requirements 是否使用 MUST/SHOULD/MAY 关键词？ [Clarity, Spec FR-001 to FR-012]
      > PASS: 所有 FR 项均使用 MUST

---

## Summary

| Dimension | Pass | Fail | Total |
|-----------|------|------|-------|
| Scope & Boundary | 5 | 0 | 5 |
| Determinism | 4 | 0 | 4 |
| Prompt Slimming | 3 | 1 | 4 |
| Dry-run Mode | 4 | 1 | 5 |
| Independence & Runtime | 3 | 1 | 4 |
| Degradation & Compat | 2 | 1 | 3 |
| Interface Contract | 2 | 1 | 3 |
| Code Style | 3 | 0 | 3 |
| Verification & SC | 4 | 0 | 4 |
| User Stories | 4 | 0 | 4 |
| Edge Case & Exception | 5 | 1 | 6 |
| Risk & Dependencies | 3 | 0 | 3 |
| Format & Compliance | 4 | 0 | 4 |
| **Total** | **46** | **6** | **52** |

**Pass Rate**: 88.5% (46/52)

### Failed Items Summary

| ID | Issue | Severity | Recommendation |
|----|-------|----------|----------------|
| CHK013 | US3-AC3"质量不低于当前版本"缺乏可度量验收标准 | Medium | 定义具体的质量基线指标（如功能条目数量、章节覆盖完整度） |
| CHK018 | dry-run 混合格式预览的输出结构未定义 | Low | 可延迟到 plan 阶段细化，但建议 spec 中至少给出示例骨架 |
| CHK022 | --project-root 无效路径时的行为未定义 | Low | 补充 Edge Case 或在 NFR-004 错误处理中覆盖 |
| CHK025 | 降级路径"简化规则"的具体行为未明确 | Medium | 至少列出降级模式下 Agent 必须完成的最低操作列表 |
| CHK028 | schemaVersion 不匹配时的处理策略未定义 | Medium | 建议明确：不匹配时 Agent 走降级路径并记录警告 |
| CHK045 | 并发执行场景未声明假设 | Low | 补充显式假设"脚本由单 Agent 串行调用，不支持并发" |
