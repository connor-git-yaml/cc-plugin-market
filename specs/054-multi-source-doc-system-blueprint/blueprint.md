# 多源文档系统 Milestone 蓝图

**版本**: 1.0.0
**创建日期**: 2026-03-20
**最后更新**: 2026-03-22
**状态**: Implemented

---

## 1. 概览与目标

### 愿景

在已完成的全景文档化能力（034-053）基础上，将 Reverse Spec 从“技术参考文档生成器”升级为“**多源事实驱动的文档编排平台**”。

该平台不只生成模块 spec 和项目级 panoramic 文档，还要能够：

1. 以一致的文档分层输出技术文档（reference / explanation / architecture bundle）
2. 沉淀架构中间表示（Architecture IR），避免不同视图各自重复建模
3. 将 ADR、产品事实、用户旅程和质量门纳入同一文档系统
4. 明确区分“确定事实”和“LLM 综合叙事”，用 provenance 和 confidence 管理可信度

### 范围

本蓝图自身占用 `054` 编号，后续规划 **6 个 Feature**（`055-060`），划分为 **3 个 Phase**：

| Phase | 名称 | Feature 数量 | 定位 |
|-------|------|-------------|------|
| Phase 0 | 交付与中间表示层 | 2 | 先补文档 bundle / 发布链路与统一架构 IR，给后续所有文档视图提供共同底座 |
| Phase 1 | 架构深描层 | 2 | 从项目级“概览”下钻到组件级与动态链路，并补 ADR 决策记录 |
| Phase 2 | 产品与治理层 | 2 | 增加 provenance / quality gate 与产品 / UX 外部事实接入，补齐完整文档系统的可信度和产品面 |

### 目标陈述

1. **文档体系化**: 让产物从“多个 generator 文件集合”升级成可导航、可发布、可复用的文档 bundle
2. **技术视图下钻**: 让维护者不仅看到模块级 spec，还能看到 component / runtime / dynamic scenario / ADR
3. **产品层打通**: 让 Spec Driver 的 `current-spec.md`、Issue/PR/设计资料等进入 Reverse Spec 文档编排主链路
4. **可信度前置**: 所有 explanation / narrative 型文档都必须显式区分 deterministic facts 与 LLM synthesis
5. **开源能力优先复用**: 能直接采用成熟开源格式或工具的，不在仓库内重新发明一套协议

---

## 2. 编号映射表

| 编号 | 类型 | 名称 | 所属 Phase |
|------|------|------|-----------|
| 054 | BLUEPRINT | 多源文档系统 Milestone 蓝图 | Blueprint |
| 055 | FEATURE | 文档 Bundle 与发布编排 | Phase 0 |
| 056 | FEATURE | 架构中间表示（Architecture IR）导出 | Phase 0 |
| 057 | FEATURE | 组件视图与动态链路文档 | Phase 1 |
| 058 | FEATURE | ADR 决策流水线 | Phase 1 |
| 059 | FEATURE | Provenance 与文档质量门 | Phase 2 |
| 060 | FEATURE | 产品 / UX 事实接入 | Phase 2 |

---

## 3. 开源复用策略

后续能力不建议“全部自己做”。按每类能力给出 `Adopt / Borrow / Build` 策略：

| 能力域 | 借鉴对象 | 策略 | 说明 |
|--------|----------|------|------|
| 文档站点 / 搜索 / 发布 | Backstage TechDocs, mkdocs-techdocs-core | Adopt | 直接采用成熟站点/发布生态，Reverse Spec 只负责生成文档包与 manifest |
| 自动 API 文档 | mkdocstrings, Sphinx AutoAPI | Borrow | 作为特定语言的补充参考源或校验器，不替代现有多语言事实层 |
| 架构中间表示 | Structurizr DSL / JSON | Borrow | 用作统一 IR 和视图输出合同，不重造一套独有架构 DSL |
| 架构决策记录 | MADR, adr-tools | Adopt | 直接采用 ADR 结构和 CLI 生态，生成 ADR 草稿与索引即可 |
| 代码到架构文档的工作流 | RepoAgent, C4-Agent | Borrow | 学习其分层生成与增量更新思路，但核心抽取与可信度管理保持自研 |
| 产品与 UX 文档 | 无成熟单体替代方案 | Build | 这部分必须结合 Spec Driver 的 current-spec、Issue/PR、设计物料自研多源融合 |

### Adopt / Borrow / Build 原则

1. **格式优先 Adopt**: OpenAPI / AsyncAPI / ADR / Structurizr 这类格式成熟稳定，优先对齐
2. **站点优先 Adopt**: 文档站点、导航、搜索、版本化发布不自建
3. **事实层优先自研**: 多源事实抽取、冲突检测、confidence/provenance 仍是 Reverse Spec 的核心竞争力
4. **叙事层谨慎用 LLM**: LLM 只负责 explanation / summarization / draft，不负责编造 canonical facts

---

## 4. LLM 使用边界

本 Milestone 会比 034-053 更频繁使用 LLM，但必须严格限制用途。

### 4.1 只能走 deterministic / parser / graph 的内容

- API 方法、路径、参数、schema
- 配置项、默认值、环境变量
- Docker / Compose / deployment 拓扑
- workspace / package / import / dependency graph
- 代码符号、类、函数、成员签名
- 已存在的 current-spec / issue / ADR 文件内容

### 4.2 可以交给 LLM 做 synthesis 的内容

- 文档首页摘要与阅读路径
- 架构 explanation 与 narrative
- 动态场景的“链路讲解”
- ADR 草稿中的 tradeoff 总结
- 产品 brief、用户旅程、对外文档摘要

### 4.3 必须带上的治理规则

1. 任何 narrative 型段落必须标明来源类型：`code / config / test / spec / issue / design / inference`
2. 任何生成型 explanation 文档必须输出 `confidence`
3. 不允许让 LLM 直接决定 OpenAPI / AsyncAPI / Structurizr 的结构事实
4. 文档存在事实冲突时，优先输出冲突而不是输出单一结论

---

## 5. Phase 分解与 Feature 详情

### 5.1 Phase 0: 交付与中间表示层

**阶段目标**: 先解决“文档怎么交付、怎么发布、怎么统一建模”的问题。没有统一 bundle 和 IR，后续 component view / ADR / 产品文档都会各自为政。

#### Feature 055: 文档 Bundle 与发布编排

**描述**: 在 batch 生成完成后，按照目标受众和使用场景组织文档包，并输出可供 TechDocs / MkDocs 消费的 manifest 与目录结构。
**预估工作量**: 1.5-2.5 天
**前置依赖**: Feature 053（强）

**交付物**:
- `docs-bundle.yaml` 或等价 bundle manifest
- 支持至少 4 个 bundle profile：
  - `developer-onboarding`
  - `architecture-review`
  - `api-consumer`
  - `ops-handover`
- `index.md` / landing page 自动生成
- TechDocs / MkDocs 兼容输出骨架

**验证标准**:
1. 对 `claude-agent-sdk-python` 执行 bundle 输出后，可生成至少 1 套可直接被 MkDocs/TechDocs 读取的目录结构
2. Bundle 内的导航顺序不是简单按文件名排序，而是反映阅读路径（如 index → architecture → runtime → module specs）

#### Feature 056: 架构中间表示（Architecture IR）导出

**描述**: 将现有 `architecture-overview`、`runtime-topology`、`workspace-index`、`cross-package-deps` 等事实统一导出为结构化 Architecture IR，并支持 Structurizr DSL / JSON 输出。
**预估工作量**: 2-3 天
**前置依赖**: 043、045、053（强）

**交付物**:
- `ArchitectureIR` 数据模型
- Structurizr DSL / JSON exporter
- system context / deployment / component 的基础实体映射
- 与现有 Mermaid 输出的互通适配层

**验证标准**:
1. 对存在 runtime/workspace 信息的项目输出 `structurizr.dsl` 或等价 JSON，至少包含 system context 与 deployment 视图实体
2. `architecture-overview` 中已有的结构关系可无损映射到 IR，不需要再重新解析源工程

### 5.2 Phase 1: 架构深描层

**阶段目标**: 从“项目级概览”继续向下钻到组件级结构、动态链路和设计决策，补齐真正可读的技术架构文档。

#### Feature 057: 组件视图与动态链路文档

**描述**: 为关键模块输出 Component View 与 Dynamic Scenarios，不再只停留在 `src/` / `tests/` 级别模块摘要。
**预估工作量**: 2.5-4 天
**前置依赖**: 056（强）、053（强）

**交付物**:
- `component-view.md/.json/.mmd`
- `dynamic-scenarios.md/.json`
- 关键组件列表（如 Query / Transport / Session / Parser）
- 关键链路（请求流、控制流、事件流、session 流）

**验证标准**:
1. 对 `claude-agent-sdk-python` 生成的 component view 至少识别 `Query`、`ClaudeSDKClient`、`InternalClient`、`SubprocessCLITransport` 等关键组件
2. 至少有 1 条 dynamic scenario 能清晰描述从 `query()` 到 CLI transport 再到消息解析的链路，而不是只罗列方法名

#### Feature 058: ADR 决策流水线

**描述**: 基于 blueprint、增量 spec、commit、current-spec 与 pattern hints 自动归纳候选架构决策，并生成 ADR 草稿与索引。
**预估工作量**: 1.5-2.5 天
**前置依赖**: 056（弱）、057（弱）、Spec Driver current-spec（强）

**交付物**:
- `docs/adr/*.md`
- MADR 兼容模板
- ADR 索引页
- 候选决策提取规则（如 CLI 宿主、双端兼容、AST-only 降级、append-only session）

**验证标准**:
1. 对 `claude-agent-sdk-python` 和本仓库自身至少各生成 2 篇 ADR 草稿，且决策主题和仓库现有事实一致
2. ADR 正文必须区分 `decision / context / consequences / alternatives`，禁止只输出摘要段落

### 5.3 Phase 2: 产品与治理层

**阶段目标**: 把文档从“可生成”提升到“可信、可审核、可覆盖产品面”。

#### Feature 059: Provenance 与文档质量门

**描述**: 为 explanation / narrative / product 类文档增加来源追踪、冲突检测和质量评分，并建立 required-doc 校验机制。
**预估工作量**: 2-3 天
**前置依赖**: 055、056、057（强）

**交付物**:
- provenance 标注结构（段落级或条目级）
- conflict detector（code vs spec vs current-spec vs README）
- quality report
- required-doc rule set（按项目类型给出最低文档集合）

**验证标准**:
1. narrative / ADR / product docs 中任一结论都可追溯到来源类别，不能只标 `low confidence`
2. 当 README 与 current-spec 对同一产品定位矛盾时，quality report 明确列出冲突而不是静默选择其一

#### Feature 060: 产品 / UX 事实接入

**描述**: 将代码外事实源纳入编排，包括 `current-spec.md`、Issue/PR、设计说明、可选截图或路由图，使 Reverse Spec 能生成产品概览、用户旅程和 feature brief。
**预估工作量**: 3-4.5 天
**前置依赖**: 055（弱）、058（弱）、059（强）、Spec Driver sync（强）

**交付物**:
- `product-overview.md`
- `user-journeys.md`
- `feature-briefs/*.md`
- 多源事实 ingest 层（至少支持 current-spec + GitHub issue/PR + 本地设计文档）

**验证标准**:
1. 对存在 `current-spec.md` 的项目，生成的产品概览不得只复述技术栈，必须覆盖目标用户、核心场景、关键任务流
2. 当缺少产品事实源时，输出必须显式说明“仅基于代码与现有规格推断”，不能伪装成确定的产品结论

---

## 6. 依赖关系与推荐实施顺序

### 6.1 依赖矩阵

| Feature | 强依赖 | 弱依赖 | 可并行 |
|---------|--------|--------|--------|
| 055 | 053 | 无 | 056 |
| 056 | 043, 045, 053 | 040, 041 | 055 |
| 057 | 056, 053 | 047, 050 | 058 |
| 058 | Spec Driver current-spec, 056 | 057 | 057 |
| 059 | 055, 056, 057 | 058 | 无 |
| 060 | 059, Spec Driver sync | 055, 058 | 无 |

### 6.2 推荐实施顺序

1. **055** 先做，把现有大量文档输出编成可消费的 bundle
2. **056** 随后做，把多种架构视图汇到同一 IR
3. **057** 基于 IR 下钻到 component / dynamic scenarios
4. **058** 在已有技术事实基础上补 ADR
5. **059** 给 explanation / ADR / narrative 加 provenance 与质量门
6. **060** 最后接入产品 / UX 外部事实源

### 6.3 并行建议

- 线 A：`055 -> 059`
- 线 B：`056 -> 057`
- 线 C：`058`
- `060` 作为最后汇合项，等待 059 稳定后再做

---

## 7. 验证计划

### 验证目标项目

| 项目 | 角色 | 用途 |
|------|------|------|
| `claude-agent-sdk-python` | 单包 Python SDK | 验证 component view、dynamic scenario、ADR 和 narrative 质量 |
| `cc-plugin-market`（本仓库） | 混合文档 / 插件 / Spec Driver 工程 | 验证 current-spec、ADR、product facts、双产品聚合 |
| `OctoAgent` | Monorepo + 多语言 | 验证 workspace、runtime、product/UX 多源事实接入 |

### 分阶段里程碑

1. **Phase 0 里程碑**
   - `claude-agent-sdk-python` 输出可导航的 docs bundle
   - 至少 1 种 bundle 可被 TechDocs / MkDocs 直接消费
   - `ArchitectureIR` 导出通过 Schema 校验

2. **Phase 1 里程碑**
   - `claude-agent-sdk-python` 的 component view 能识别关键组件与关键链路
   - 至少生成 2 篇 ADR 草稿，主题与仓库事实一致

3. **Phase 2 里程碑**
   - explanation / ADR / product docs 都带 provenance
   - `cc-plugin-market` 能生成产品概览、用户旅程与 feature brief
   - quality report 能识别至少 1 条真实冲突和 1 条缺失文档项

---

## 8. 风险清单

| # | 风险描述 | 概率 | 影响 | 缓解策略 |
|---|----------|------|------|----------|
| 1 | LLM 参与面增大后，文档“看起来很像”，但事实边界变弱 | 高 | 高 | 先做 059 provenance / quality gate；deterministic facts 与 synthesis 明确分层 |
| 2 | Structurizr IR 与现有 Mermaid 输出之间存在语义缺口 | 中 | 中 | 056 先做最小 IR，仅覆盖已有 architecture-overview / runtime-topology 可稳定表达的实体 |
| 3 | 产品 / UX 外部事实源差异极大，难以统一 ingest | 高 | 高 | 060 第一版只支持 `current-spec.md` + GitHub issue/PR + 本地 Markdown 设计说明，不一开始覆盖 Figma 私有 API |
| 4 | component view 过度依赖目录聚合，仍然无法讲清关键类/关键方法 | 高 | 高 | 057 必须引入 symbol graph / call chain / test evidence，不允许只在 narrative 层做名字排序 |
| 5 | 直接采用开源工具后，仓库内输出合同碎片化 | 中 | 中 | 055/056 中统一 manifest 与 IR 层，把外部工具视为 renderer / publisher，而不是事实源 |
| 6 | ADR 草稿质量不足，变成泛泛而谈的解释文 | 中 | 中 | 058 必须绑定具体 source refs（spec / commit / current-spec / issue），无来源则降级为“候选 ADR” |

---

## 9. Success Criteria

| ID | 成功标准 |
|----|----------|
| SC-001 | 文档输出不再只是文件集合，而是至少 1 套可导航、可发布的 bundle |
| SC-002 | `claude-agent-sdk-python` 的 component / dynamic 文档能让不了解项目的人快速识别核心组件和主链路 |
| SC-003 | ADR、narrative、product docs 都具备 provenance / confidence，不再只用 `low confidence` 粗粒度标记 |
| SC-004 | Spec Driver 的 `current-spec.md` 能稳定作为 Reverse Spec 产品文档的事实源之一 |
| SC-005 | 采用的开源方案（TechDocs / Structurizr / MADR）均通过适配层接入，不要求用户额外手工整理大量中间文件 |

---

## 10. 结案验证

### 已完成项

- **055**: 文档 bundle 与发布编排已接入 batch，输出 `docs-bundle.yaml`、4 个 profile、landing page 和 MkDocs 兼容骨架
- **056**: `ArchitectureIR` 已落地，支持 JSON / Mermaid / Structurizr DSL 导出
- **057**: 组件视图与动态链路文档已接入项目级文档套件
- **058**: ADR 决策流水线已接入 `docs/adr/*.md`
- **059**: provenance、quality report、required-doc rule set 与冲突检测已落地
- **060**: 产品 / UX 事实接入已落地，支持 `current-spec.md`、README、本地设计 Markdown、GitHub issue/PR 的第一版聚合

### 真实验证结论

- `claude-agent-sdk-python` 已验证：
  - project docs suite 可完整生成
  - component / dynamic / ADR / narrative / quality 可共同工作
- 当前仓库 `cc-plugin-market` 已验证：
  - 060 可直接从 `current-spec.md`、README、PR 历史生成 `product-overview`、`user-journeys` 和 `feature-briefs`
- docs bundle、Architecture IR、quality gate 和产品文档层已能同时进入 batch 主链路

### 已知边界

- 第一版 060 仍只覆盖 `current-spec.md` + GitHub issue/PR + 本地 Markdown 设计说明，不包含 Figma / analytics / support ticket 等外部事实源
- 开源站点与发布层仍采用“兼容输出合同”策略，未在仓库内直接嵌入 TechDocs / Backstage runtime
- narrative / component / dynamic 质量已达可用，但对超大仓库的细粒度类/方法级讲解仍有继续优化空间

---

## 11. 维护说明

1. 本蓝图默认不替换 `033` 全景文档化蓝图，而是建立在 `034-053` 已落地能力之上的下一阶段蓝图
2. 后续每完成一个 Phase，更新本蓝图版本号的 minor 号
3. 若决定让 `054-060` 真正进入交付，应为每个 Feature 创建独立目录并补对应 spec / tasks / verification
4. 若发现某个外部开源方案不适配，应优先调整“接入层”，不要让核心事实模型直接耦合外部工具

---

## 12. 参考与借鉴来源

- Diataxis: https://diataxis.fr/start-here/
- Backstage TechDocs: https://backstage.io/docs/features/techdocs/
- Structurizr Documentation: https://docs.structurizr.com/ui/documentation
- Structurizr DSL: https://docs.structurizr.com/dsl
- MADR: https://adr.github.io/madr/
- ADR Templates: https://adr.github.io/adr-templates/
- mkdocstrings: https://github.com/mkdocstrings/mkdocstrings
- RepoAgent: https://github.com/OpenBMB/RepoAgent
