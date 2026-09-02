# 代码质量审查报告（架构合理性 + 可读性维度）

**范围**：`scripts/regen-collector-fingerprint-fixtures.ts` 主改动 + 三个消费/文档文件的同步改动
**对照**：`specs/279-guardrail-detection-widening/plan.md`
**审查者**：quality-review 子代理（不重复做 bug 猎捕，聚焦架构/可读性/YAGNI/重复/职责/注释一致性）

## 六维度评估

| 维度 | 评级 | 关键发现 |
|------|------|---------|
| 架构合理性 | EXCELLENT | 完全照 plan 执行：就地泛化（无平行维度 4）、denylist（`GRAPH_GRAPH_EXCLUDED_FIELDS`）、零新增导出面，均已逐条核实无偏离 |
| 设计模式合理性 | GOOD | `describeScalarField`/`describeGraphField` 存在可消除的真实重复（见问题清单 W1）；其余泛化/骨架复用符合 plan 的复杂度权衡 |
| 安全性 | N/A | 未审查（非本次任务范围，另有对抗代理负责） |
| 性能 | N/A | 未审查（非本次任务范围） |
| 可读性 | EXCELLENT | 新增注释延续本文件"大段 why"风格，无"解释 what 而非 why"的段落；FR 引用逐条核实与 spec.md 编号一致 |
| 可维护性 | NEEDS_IMPROVEMENT | `compareNodeShapes` 泛化后行数增长约 2.8×（~30 行 → ~85 行含注释），超出项目"函数 >50 行应拆分"的约定阈值，建议拆分单节点富诊断分支 |

## 问题清单

| 严重程度 | 维度 | 位置 | 描述 | 修复建议 |
|---------|------|------|------|---------|
| WARNING | 消除重复 | `scripts/regen-collector-fingerprint-fixtures.ts:267-270`（`describeScalarField`）与 `:499-501`（`describeGraphField`） | 两个函数逻辑体逐字相同（`raw === undefined ? '<absent>' : JSON.stringify(raw)`），仅入参形态不同（前者先从 node 取字段，后者直接收原始值）。`describeGraphField` 的注释自己已承认"与节点侧 `describeScalarField` 同口径"——即实现者已经意识到这是同一逻辑却仍写了两份。这不是"为不同语义各自建模"，是可机械消除的字面重复：`describeScalarField` 完全可以委托给 `describeGraphField`（`return describeGraphField((node as unknown as Record<string, unknown>)[field]);`），零行为变化、少一份需要同步维护的逻辑。 | 把 `describeScalarField` 实现改为对 `describeGraphField` 的委托调用；或反过来让 `describeGraphField` 成为唯一实现，`describeScalarField` 仅负责"从 node 取字段"这一步再转发。两种方向任选，但不应保留两份独立的 `undefined ? '<absent>' : JSON.stringify` 三元表达式。 |
| WARNING | 单一职责 / 函数长度 | `scripts/regen-collector-fingerprint-fixtures.ts:385-470`（`compareNodeShapes`） | 泛化后函数体（不含函数头文档）约 84 行，超过项目"函数 >50 行应拆分"的约定（`CLAUDE.md` 可维护性维度）。函数内实际做了三件可分离的事：①按 id 分组排序遍历、②重复 id 的 multiset 计数分支、③单节点富诊断分支（kind/label/metadata 三个 facet 逐一比较，含 metadata 的 missing/extra 路径计算，约占 40 行）。③ 本身逻辑内聚（"给定一对同 id 的单节点形态，产出这对节点的完整差异文案列表"），是天然可独立测试的子问题，与①②的"分组/去重骨架"职责不同。 | 建议把"单节点富诊断分支"（现 `:428-467`）提取为独立函数，如 `describeNodeShapeDifferences(id, rebuiltShape, pinnedShape): string[]`，`compareNodeShapes` 内对该函数的返回值 `differences.push(...)`。提取后 `compareNodeShapes` 主体收敛到"分组 + 两个分支路由"的骨架职责，可读性与可测试性都提升，且不改变任何输出文案（纯函数搬移）。 |
| INFO（偏好） | 消除重复 | `scripts/regen-collector-fingerprint-fixtures.ts:431-440`（`compareNodeShapes` 内 kind/label 两段） | kind 与 label 的差异 push 逻辑模式完全相同（`if (a.xSignature !== b.xSignature) { differences.push(\`节点 ${field} 不一致...\`) }`），只有 facet 名字不同。可提取为形如 `pushFacetDiff(differences, '节点 kind', rebuiltShape.kindSignature, pinnedShape.kindSignature, id)` 的小 helper。 | 这是风格偏好而非质量缺陷：当前只有 2 处重复、每处 4 行，提取收益（省 ~4 行）与引入一层间接调用的可读性代价大致相抵。**不强制**，若上一条 W1 的拆分（提取 `describeNodeShapeDifferences`）落地，可顺带在新函数内部做这个提取，否则维持现状也可接受。 |
| INFO | 格式一致性 | `scripts/regen-collector-fingerprint-fixtures.ts:322-323` | `collectMetadataKeyPaths` 函数结束后出现连续两个空行（其余全文件均为单空行分隔顶层声明），是本次 diff 引入的格式噪声（大概率是移动/插入代码时的编辑残留），与文件既有排版惯例不一致。 | 删去多余的一个空行，保持全文件顶层声明间距一致；若项目配了 Prettier/ESLint 的空行规则，`npm run lint` 应能自动捕获或修复，implement 阶段顺手清理即可。 |

## 逐项裁决核实记录（用于佐证上表 EXCELLENT/GOOD 结论，非独立问题）

- **就地泛化 vs 新增平行维度**：`compareNodeMetadataKeys` → `compareNodeShapes`、`describeNodeMetadata` 保留为 `describeNodeShape` 内部子过程、`groupNodeMetadataShapes` → `groupNodeShapes`，命名/骨架/复杂度分布均与 plan §"架构裁决：kind/label 与 metadata 共享同一比较骨架"的映射表一致，未发现新增平行函数或维度 4。
- **denylist 而非 allowlist**：`GRAPH_GRAPH_EXCLUDED_FIELDS = new Set(['builder', 'fingerprint'])` + `compareGraphMetadata` 用两侧 key 并集减排除集，符合 plan §"开放项 A 裁决"的最终实现策略；未发现固定 allowlist。
- **不新增导出面**：`grep -n '^export '` 复核，导出符号集合与改动前一致（`compareGraphOnlyStructure`/`compareModuleGraphSnapshot`/`swapPinnedAssets`/`rebuildTracks`/`runRegen` 等既有导出未变，plan 列出的 8 个新增/泛化符号 `describeNodeShape`/`describeScalarField`/`groupNodeShapes`/`compareNodeShapes`/`compareGraphMetadata`/`escapeMetadataPathSegment`/`collectMetadataKeyPaths`/`GRAPH_GRAPH_EXCLUDED_FIELDS` 全部 module-private）。
- **FR-013 三处断言迁移**：`collector-fingerprint-guardrail.test.ts:382`（原）与 `collector-fingerprint-regen-script.test.ts:342-344` 均已更新为三路径完整文案（`lineRange, lineRange.end, lineRange.start`），`:396`（`__mutantKey`）保持不变，与 plan §"开放项 B 裁决"的判断（只有前两处受影响）一致，未发现遗漏。
- **README 同步**：`tests/fixtures/collector-fingerprint-guardrail/README.md` 的"护栏报 `metadata key 集合不一致` 时的处置路径"一节已更新为"递归 key 路径集合"措辞，并补充了第四维度（`graph.graph`/`directed`/`multigraph`）说明，符合 plan 风险登记 (c).2 的建议。
- **注释与实现一致性抽查**：`describeScalarField`/`describeNodeShape`/`compareGraphMetadata`/`GRAPH_GRAPH_EXCLUDED_FIELDS` 等新增符号的文档注释与实际代码行为逐条核对（缺席态处理、递归终止条件、denylist 排除理由、`directed`/`multigraph` 单独两行的原因）均无漂移；FR 编号引用（如"FR-008 / F279 FR-006"）与 `spec.md` 实际 FR 编号核对一致，未发现引用错误。
- **YAGNI 抽查**：`isRecursableMetadataValue` 单独成函数并非过度抽象——它作为 TypeScript 类型谓词（`value is Record<string, unknown>`）被 `collectMetadataKeyPaths` 递归调用时用于类型收窄，是惯用写法而非可有可无的中间层；`describeGraphField` 与 `describeScalarField` 的"重复"问题（见上表 W1）性质是**该合并的真实重复**，不是"过度拆分的假设性抽象"，两者应分开评价。

## 总体质量评级

**GOOD**

评级依据：零 CRITICAL，WARNING = 2（W1 重复消除 + W2 函数长度），均为真实、可低成本修复的质量项，不影响功能正确性；INFO 2 项（1 偏好 + 1 格式噪声）不计入评级公式但一并列出供 implement 阶段顺手处理。架构维度完全对齐 plan 裁决，无静默偏离；可读性维度延续既有文件哲学，无发现。

## 问题分级汇总

- CRITICAL: 0 个
- WARNING: 2 个
- INFO: 2 个（含 1 项明确标注为"偏好"，不强制处理）
