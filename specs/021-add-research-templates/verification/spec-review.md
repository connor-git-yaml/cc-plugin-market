# Spec 合规审查报告

**特性**: 021-add-research-templates (调研模板纳入 specify-base 同步体系)
**审查时间**: 2026-03-02
**审查依据**: `specs/021-add-research-templates/spec.md`
**审查范围**: FR-001 ~ FR-010, SC-001 ~ SC-004

---

## 逐条 FR 状态

| FR 编号 | 描述 | 状态 | 证据/说明 |
|---------|------|------|----------|
| FR-001 | 调研模板纳入 `REQUIRED_TEMPLATES` | 已实现 | **TypeScript**: `src/utils/specify-template-sync.ts` 第 17-21 行，`REQUIRED_TEMPLATES` 数组在 `agent-file-template.md` 之后新增 4 项调研模板，含注释 `// 调研模板（FR-001: 纳入同步体系）`。**Bash**: `plugins/spec-driver/scripts/init-project.sh` 第 53-57 行，`REQUIRED_SPECIFY_TEMPLATES` 数组在 `agent-file-template.md` 之后新增 4 项，含注释 `# 调研模板（纳入同步体系）`。两处列表完全一致，均包含 `product-research-template.md`、`tech-research-template.md`、`research-synthesis-template.md`、`verification-report-template.md`。Tasks T006 [x]、T007 [x] 均已勾选。 |
| FR-002 | specify-base 包含 4 个调研模板基准版本 | 已实现 | `plugins/spec-driver/templates/specify-base/` 目录包含 10 个 .md 文件（6 个基础 + 4 个调研），通过 `diff` 验证 4 个调研模板与 `plugins/spec-driver/templates/` 根目录下的对应模板内容完全一致。Tasks T002-T005 [x] 均已勾选。 |
| FR-003 | 幂等复制（已存在不覆盖） | 已实现 | `src/utils/specify-template-sync.ts` 第 78-80 行：`if (fs.existsSync(targetPath)) { continue; }`——目标文件存在时直接跳过，不执行覆盖。`plugins/spec-driver/scripts/init-project.sh` 第 88-90 行：`if [[ -f "$target_path" ]]; then continue; fi`——相同的幂等逻辑。此幂等机制为已有基础模板的同步逻辑，调研模板通过数组扩展自动继承此行为。Task T013 [x] 已勾选。 |
| FR-004 | product-research 子代理条件加载 | 已实现 | `plugins/spec-driver/agents/product-research.md` 第 10 行：`使用模板：优先读取 .specify/templates/product-research-template.md（项目级），若不存在则回退到 plugins/spec-driver/templates/product-research-template.md（plugin 内置）`。第 48-51 行新增步骤 5.5"加载报告模板"，包含完整的条件加载指令（检查 `.specify/templates/product-research-template.md` 是否存在，存在用项目级，不存在回退 plugin 内置）。Task T008 [x] 已勾选。 |
| FR-005 | tech-research 子代理条件加载 | 已实现 | `plugins/spec-driver/agents/tech-research.md` 第 11 行：`使用模板：优先读取 .specify/templates/tech-research-template.md（项目级），若不存在则回退到 plugins/spec-driver/templates/tech-research-template.md（plugin 内置）`。第 56-59 行新增步骤 6.5"加载报告模板"，包含完整的条件加载指令。Task T009 [x] 已勾选。 |
| FR-006 | 编排器 research-synthesis 条件加载 | 已实现 | `plugins/spec-driver/skills/speckit-feature/SKILL.md` 第 374 行：Phase 1c 段落已修改为 `加载产研汇总模板（优先读取 .specify/templates/research-synthesis-template.md，若不存在则回退到 plugins/spec-driver/templates/research-synthesis-template.md）`。Task T010 [x] 已勾选。 |
| FR-007 | verify 子代理条件加载 | 已实现 | `plugins/spec-driver/agents/verify.md` 第 14 行：`使用模板：优先读取 .specify/templates/verification-report-template.md（项目级），若不存在则回退到 plugins/spec-driver/templates/verification-report-template.md（plugin 内置）`。第 103 行步骤 7"生成验证报告"中新增：`加载报告模板: 检查 .specify/templates/verification-report-template.md 是否存在，如存在则使用项目级模板，否则使用 plugins/spec-driver/templates/verification-report-template.md`。Task T011 [x] 已勾选。 |
| FR-008 | 项目级不存在时回退 plugin 内置 | 已实现 | 四个文件均包含"若不存在则回退到 plugin 内置"的明确指令：product-research.md 第 10 行和第 51 行、tech-research.md 第 11 行和第 59 行、SKILL.md 第 374 行、verify.md 第 14 行和第 103 行。回退路径均指向 `plugins/spec-driver/templates/{template-name}`，确保向后兼容。Tasks T008-T011 [x] 及 T014 [x] 均已勾选。 |
| FR-009 | 同步结果返回 copied/missing | 已实现 | `src/utils/specify-template-sync.ts` 第 24-27 行导出接口 `EnsureSpecifyTemplatesResult { copied: string[]; missing: string[] }`，第 92 行函数返回 `{ copied, missing }`。调研模板通过数组扩展自动纳入此返回逻辑，无需额外修改。Bash 脚本同样在 `sync_specify_templates()` 函数中通过 `INIT_RESULTS` 数组报告同步状态（第 107-117 行）。Tasks T006 [x]、T007 [x] 已勾选。 |
| FR-010 | 与现有基础模板行为一致 | 已实现 | 调研模板的同步机制完全复用现有基础模板的代码路径：TypeScript 中 `REQUIRED_TEMPLATES` 数组扩展后由同一 `for...of` 循环处理（第 76 行），Bash 中 `REQUIRED_SPECIFY_TEMPLATES` 数组扩展后由同一 `for` 循环处理（第 86 行）。三处定义（TypeScript 常量、Bash 数组、specify-base 目录文件）均为 10 项，完全匹配。子代理的条件加载模式（"项目级优先，plugin 回退"）与现有模板加载行为一致。Tasks T002-T005 [x]、T006-T007 [x]、T008-T011 [x]、T012 [x] 均已勾选。 |

---

## 总体合规率

**10/10 FR 已实现（100%）**

---

## 偏差清单

无偏差。所有 FR 均已正确实现。

| FR 编号 | 状态 | 偏差描述 | 修复建议 |
|---------|------|---------|---------|
| (无) | - | - | - |

---

## Success Criteria 满足情况

| SC 编号 | 描述 | 状态 | 证据 |
|---------|------|------|------|
| SC-001 | 同步后 `.specify/templates/` 包含全部 10 个模板 | 已满足 | `REQUIRED_TEMPLATES` 和 `REQUIRED_SPECIFY_TEMPLATES` 均扩展为 10 项；specify-base 目录包含 10 个模板文件；同步循环自动遍历全部 10 项 |
| SC-002 | 用户自定义调研模板定制生效率 100% | 已满足 | 4 个子代理/编排器均包含"项目级优先"的条件加载指令，用户修改项目级模板后将被优先使用 |
| SC-003 | 未配置项目级模板时向后兼容性 100% | 已满足 | 4 个子代理/编排器均包含"plugin 内置回退"指令；幂等同步仅在目标不存在时复制，不影响已有行为 |
| SC-004 | 重复同步不覆盖自定义模板（幂等保护率 100%） | 已满足 | TypeScript `fs.existsSync` 检查（第 78 行）和 Bash `-f` 检查（第 88 行）确保目标文件存在时跳过 |

---

## 过度实现检测

未检测到过度实现。所有变更均在 spec.md 定义的 FR 范围内：

- TypeScript 和 Bash 的修改仅为常量数组扩展（从 6 项到 10 项），未引入新的公共 API、配置项或用户可见行为
- 4 个子代理 prompt 修改仅为模板路径引用方式变更，未新增功能
- specify-base 中新增的 4 个模板文件内容与 plugin 根目录下的源模板完全一致，未新增额外内容

| 位置 | 描述 | 风险评估 |
|------|------|---------|
| (无) | - | - |

---

## 问题分级汇总

- **CRITICAL**: 0 个（FR 未实现）
- **WARNING**: 0 个（FR 部分实现）
- **INFO**: 0 个（过度实现）

---

## 审查结论

本特性 10 条功能需求（FR-001 ~ FR-010）全部已实现，4 项成功标准（SC-001 ~ SC-004）全部满足，无偏差、无过度实现。变更范围精确对齐 spec.md 定义，实现方式与任务清单描述一致。

### 关键验证文件清单

| 文件路径 | 变更类型 | 对应 FR |
|---------|---------|---------|
| `src/utils/specify-template-sync.ts` | 常量数组扩展 (6->10) | FR-001, FR-003, FR-009, FR-010 |
| `plugins/spec-driver/scripts/init-project.sh` | 常量数组扩展 (6->10) | FR-001, FR-003, FR-010 |
| `plugins/spec-driver/templates/specify-base/product-research-template.md` | 新增文件 | FR-002 |
| `plugins/spec-driver/templates/specify-base/tech-research-template.md` | 新增文件 | FR-002 |
| `plugins/spec-driver/templates/specify-base/research-synthesis-template.md` | 新增文件 | FR-002 |
| `plugins/spec-driver/templates/specify-base/verification-report-template.md` | 新增文件 | FR-002 |
| `plugins/spec-driver/agents/product-research.md` | 条件加载指令 | FR-004, FR-008 |
| `plugins/spec-driver/agents/tech-research.md` | 条件加载指令 | FR-005, FR-008 |
| `plugins/spec-driver/skills/speckit-feature/SKILL.md` | 条件加载指令 | FR-006, FR-008 |
| `plugins/spec-driver/agents/verify.md` | 条件加载指令 | FR-007, FR-008 |
