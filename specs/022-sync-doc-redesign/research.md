# 技术研究笔记: sync / doc 文档架构重设计

**Branch**: `022-sync-doc-redesign` | **Date**: 2026-03-07 | **Spec**: [spec.md](spec.md)

## Decision 1: `sync` 与 `doc` 不合并为一个命令

**Decision**: 保持 `speckit-sync` 与 `speckit-doc` 为两个命令，不做统一入口；但重构成同一套文档体系中的上下游。

**Rationale**:
1. 外部研究显示，好的文档系统应按内容类型和受众分层，而不是把教程、操作指南、参考和解释混成一个输出。Diataxis 明确区分 tutorial / how-to / reference / explanation 四种内容类型，它们的目的不同，不应强行合并到一个 artifact 或一条命令里。
2. 本地现状也证明两者职责不同：`sync` 处理 `specs/* -> specs/products/*` 的内部产品知识聚合，`doc` 处理 `project metadata/code layout -> repo root docs` 的外部文档生成。
3. 粗暴合并会让用户无法区分“更新产品级活规范”和“生成仓库 README/贡献指南”两类动作，反而提高心智负担。

**Sources**:
- Diataxis documentation framework: <https://diataxis.fr/start-here/>
- GitHub Docs content model / procedural content: <https://docs.github.com/en/contributing/writing-for-github-docs/using-style-guide-and-content-model/using-the-content-model#procedural-content>
- 本地现状: [speckit-sync/SKILL.md](./../../plugins/spec-driver/skills/speckit-sync/SKILL.md), [speckit-doc/SKILL.md](./../../plugins/spec-driver/skills/speckit-doc/SKILL.md)

## Decision 2: 采用“内部产品知识层 -> 外部文档层”的双层文档架构

**Decision**: 将 `sync` 重新定义为“产品级文档单一信息源”，并让 `doc` 在存在 `current-spec.md` 时优先消费它，而不是重复推断产品定位和用户价值。

**Rationale**:
1. 当前 `sync` 已经生成 14 章节的 `current-spec.md`，事实上承担了“内部产品知识层”的角色，只是它与 `doc` 缺少明确契约。
2. 外部研究中，Atlassian 的 PRD/technical documentation 指南强调：需求、技术设计、用户文档应该共享事实，但表达方式和粒度不同；单一信息源应该先沉淀事实，再做面向不同读者的重写。
3. Google 技术写作建议把大文档按 audience、scope、progressive disclosure 组织；这更适合 `sync` 先聚合事实，再由 `doc` 做面向开源用户的表达。

**Sources**:
- Atlassian PRD guide: <https://www.atlassian.com/agile/product-management/requirements>
- Atlassian software / technical documentation guides:
  - <https://www.atlassian.com/work-management/knowledge-sharing/documentation/software-documentation>
  - <https://www.atlassian.com/work-management/knowledge-sharing/documentation/technical-documentation>
- Google technical writing / organizing large docs:
  - <https://developers.google.com/tech-writing>
  - <https://developers.google.com/tech-writing/one/organization>
- 本地现状: [specs/products/spec-driver/current-spec.md](../products/spec-driver/current-spec.md)

## Decision 3: `current-spec.md` 增加“对外文档摘要”作为 handoff 契约

**Decision**: 不让 `doc` 直接从整份 `current-spec.md` 生吞硬抄，而是在 `current-spec.md` 中新增一个面向 `doc` 的摘要区块，作为 README/使用文档的稳定输入。

**Rationale**:
1. 当前 `current-spec.md` 同时承载产品范围、FR 分组、技术架构、风险和术语，对 `doc` 来说信息过多且粒度不稳定。
2. 增加显式 handoff summary 后，`sync` 负责把内部事实压缩成对外可用的“电梯陈述 + 价值主张 + 核心工作流 + 使用边界”，`doc` 只需转译表达，不必再次发明事实。
3. 这比直接合并两个命令风险更小，也比让 `doc` 继续只读 package metadata 更能减少漂移。

**Sources**:
- GitHub Docs style guide: <https://docs.github.com/en/contributing/style-guide-and-content-model/style-guide>
- Microsoft Writing Style Guide: <https://learn.microsoft.com/en-us/style-guide/welcome/>
- 本地现状: [product-spec-template.md](./../../plugins/spec-driver/templates/product-spec-template.md)

## Decision 4: 用户文档风格采用“清晰、可扫描、动作导向、单段单受众”

**Decision**: `doc` 的面向用户文档风格以 GitHub / Microsoft / Google 的共识为准：主动语态、短标题、plain language、一步一事、先给结论再给细节。

**Rationale**:
1. Google 和 GitHub 都强调 active voice、task-based steps、front-load outcome；Microsoft 强调 conversational but clear。
2. 这些规则非常适合 README / Quickstart / Contributing：读者通常是在执行动作，不是在阅读内参。
3. 当前 `sync` 的 14 章节更偏 reference / explanation；如果直接拿来当 README，会把内部设计和用户操作混写。

**写作规则提炼**:
- 一个章节只服务一个核心读者和一个主要任务
- 先说 outcome，再给 prerequisites 和 steps
- 标题必须可扫描，不要把内部阶段名直接暴露给终端用户
- 对外文档默认不展开内部实现细节；技术深挖通过链接指向产品规范或架构章节

**Sources**:
- Google developer style guide: <https://developers.google.com/style>
- Microsoft Writing Style Guide: <https://learn.microsoft.com/en-us/style-guide/welcome/>
- GitHub Docs style guide and content model:
  - <https://docs.github.com/en/contributing/style-guide-and-content-model/style-guide>
  - <https://docs.github.com/en/contributing/writing-for-github-docs/using-style-guide-and-content-model/using-the-content-model#procedural-content>

## Decision 5: 技术文档继续采用结构化事实层，增强 ADR / 架构表达

**Decision**: `sync` 里的技术层继续放在 `current-spec.md`，并保持架构、决策记录、NFR、风险等结构化表达；其目标受众是工程团队和未来的 `doc` 消费者，而不是直接面向首次用户。

**Rationale**:
1. 业内技术文档普遍强调结构化 architecture + decisions + constraints。C4 模型强调用不同层级的抽象组织架构信息；ADR 强调记录“上下文、决策、后果”。
2. `sync` 现在已经有“当前技术架构”“设计原则与决策记录”“已知限制与技术债”“假设与风险”章节，这个方向是对的，不应该因面向用户文档的需求而弱化。
3. 真正要改变的是为 `doc` 提供更适配的上游摘要，而不是把技术层删掉。

**Sources**:
- C4 model: <https://c4model.com/>
- ADR guidance: <https://learn.microsoft.com/en-us/azure/well-architected/architect-role/architecture-decision-records>
- 本地现状: [sync.md](./../../plugins/spec-driver/agents/sync.md)

## Decision 6: 先做“Prompt/模板级重设计”，再考虑共享脚本抽象

**Decision**: 本轮先在 `speckit-sync/SKILL.md`、`sync.md`、`product-spec-template.md`、`speckit-doc/SKILL.md` 中重构职责与契约；共享 preflight 抽象和 `scan-project` 契约作为本轮顺手补强，但不引入任何运行时依赖。

**Rationale**:
1. Constitution 对 `spec-driver` 的约束是 Prompt 工程优先、零运行时依赖。当前最合适的落点就是 Markdown Prompt、模板和 Bash 合同文件。
2. 研究显示 `doc` 目前最大的问题不是执行脚本少，而是缺少明确的输入契约和上游语义来源。
3. 先把 prompt contract 和 output structure 定清楚，再决定是否抽脚本或新增 agent，风险更低。

## 最终推荐

**推荐方案**:
1. 不合并 `sync` 和 `doc`
2. 将 `sync` 明确升级为“产品级事实层 + 对外文档 handoff 层”
3. 让 `doc` 在存在 `current-spec.md` 时优先消费它，成为“对外表达层”
4. 对齐共享 preflight 语义，并补上 `scan-project.sh` 的契约文件

**不推荐方案**:
- 直接把 `sync` 和 `doc` 合并成一个大命令
- 让 `doc` 继续只看 `package.json` / 目录树，忽略现有产品活文档
- 让 `current-spec.md` 直接充当 README，而不经过受众重写
