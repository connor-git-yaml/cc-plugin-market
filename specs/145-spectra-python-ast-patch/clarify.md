# 需求澄清报告：Feature 145

**生成时间**：2026-04-29
**状态**：已完成（无 CRITICAL 问题，全部自动解决）

---

## 执行摘要

扫描 spec.md 共识别 **4 个歧义点**（含 2 个 spec 内已 AUTO-RESOLVED + 2 个新增细粒度歧义）。
新增 2 个歧义点均属非 CRITICAL，已自动解决。

**结论：spec 可直接进入 plan 阶段，无需用户裁决。**

---

## 已有 AUTO-RESOLVED（spec.md 末尾记录，不重复分析）

1. P2 修复方案 → 选方案 (b) debt-scanner 独立扫描
2. P0 触发机制 → 无 flag 默认注入

---

## 新识别歧义点

### 歧义 1：P0 实现层——新建独立文件 vs 在 python-adapter.ts 中新增方法

**描述**：spec.md 在边界约定中同时列出了两个可能修改目标：
- `src/adapters/python-adapter.ts`（扩展 `extractSymbolNodes()` 方法）
- `src/adapters/python-ast-extractor.ts`（若新建）

这形成两种实现策略，未明确选择哪种，对任务分解和测试文件命名有影响。

**可行选项**：
| 选项 | 描述 | 影响 |
|------|------|------|
| A：方法内联 | 在 `PythonLanguageAdapter` 中新增 `extractSymbolNodes()` 方法，直接扩展已有适配器 | 改动面集中在一个文件；适配器类职责略有扩大；测试可复用已有 `python-adapter.test.ts` |
| B：新建适配器 | 新建 `python-ast-extractor.ts`，`PythonLanguageAdapter` 委托调用 | 职责更清晰；多一个文件；新建测试文件 `python-ast-extractor.test.ts` |

**推荐**：**选项 A**（方法内联）

**理由**：tech-research.md 已明确"约 100-150 行代码"的桥接转换层，规模不足以独立成文件；`PythonLanguageAdapter` 已掌握 `TreeSitterAnalyzer` 和 `PythonMapper` 的引用，内联方法无需新增依赖传递；spec 复杂度评估为 LOW，避免不必要的文件拆分。

**[AUTO-CLARIFIED: 选项 A — 方法内联 — 桥接层 < 150 行，不值得独立文件，内联保持改动面最小]**

---

### 歧义 2：P3 校准时序——先提交 overhead 常量还是等 P0 实测后再定稿

**描述**：spec.md FR-010 要求 `estimateModuleCost` 加入 overhead 常量（推荐值：overhead=2000，multiplier=1.35），FR-011 说"SHOULD 在 P0 实现后通过实际运行 batch 测量后校准"。这形成两种交付策略：先提交初版常量还是等 P0 完成后一次性提交校准后的值。

**可行选项**：
| 选项 | 描述 | 影响 |
|------|------|------|
| A：先提交初版 | 在 P0 之前或同步提交初版常量（2000 / 1.35），P0 完成后按实测单独 patch | 两次提交，P3 先上线；初版可能需要二次修改 |
| B：等 P0 后一次性提交 | P0 实现完成后实测 token 偏差，P3 常量校准后与 P0 打包一次提交 | 一次提交精度更高；P3 实现依赖 P0 的运行结果；单次 PR 改动面更大 |

**推荐**：**选项 B**（等 P0 后一次性提交）

**理由**：tech-research.md 第 8 节建议"先做 P0，再修 P3，避免二次校准"；SC-001/SC-005 端到端验收要求实际/预估 < 1.3x，必须在 P0 生成真实图谱后才能准确测量 system prompt 实际大小；两次提交的成本高于等待 P0 的成本，且常量错了还需要再改一次。

**[AUTO-CLARIFIED: 选项 B — 等 P0 实现后一次性校准提交 — 避免二次校准，与 tech-research 建议一致]**

---

## 轻微不一致点（不影响实施，记录备查）

### 不一致 1：SC-001 vs SC-005 重复

端到端验收标准 SC-001 和 SC-005 描述的是同一个偏差验证场景（dry-run vs 实际 token 偏差 < 1.3x），SC-005 的存在意义仅在于与其他 SC 形成完整的 5 场景列表。实施时二者合并为同一个测试即可，不需要重复验证。

**[AUTO-CLARIFIED: 合并处理，plan 阶段只设计一个测试场景]**

### 不一致 2：NF-004 大型项目内存约定的触发条件

NF-004 说"> 100 个 `.py` 文件"需复用 `TreeSitterAnalyzer.dispose()` 机制，但没有说明文件数 ≤ 100 时是否可以不 dispose。

**[AUTO-CLARIFIED: dispose 无条件执行（batch 结束后统一释放），≤ 100 文件不例外，NF-004 的数字只是风险说明，不是阈值]**

---

## 综合结论

| 歧义点 | 自动选择 | 对实施的影响 |
|--------|---------|-------------|
| P0：新建文件 vs 内联方法 | 方法内联到 `python-adapter.ts` | plan 不新增 `python-ast-extractor.ts`，测试复用已有文件 |
| P3：先提交 vs 等 P0 | 等 P0 实测后一次性提交 | P3 任务排在 P0 之后，依赖 P0 运行结果 |
| SC-001/005 重复 | 合并为一个场景 | plan 中只写一个 dry-run 偏差测试 |
| NF-004 dispose 阈值 | 无条件 dispose，无文件数阈值 | 实施时 batch 结束统一调用 dispose |

**无 CRITICAL 问题，spec 可直接进入 plan 阶段。**
