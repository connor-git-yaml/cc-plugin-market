# Prior Art 深读综合 — AST-anchored Spec Drift Detection（F189）

**调研日期**：2026-06-13
**调研方式**：Perplexity research（detailed）+ 定向 web_search 二次核验
**核验原则**：每条结论标注 **[已核验]** / **[未核验]** / **[概念archetype]**，未核验来源不得在 spec 中作为事实引用（遵循 CLAUDE.md「查不到就明确说不知道」）

---

## 0. 关键核验结论（先说最重要的）

| 立项弹药 | 用户原始表述 | 核验结果 | spec 中的处置 |
|---------|------------|---------|-------------|
| Fiberplane Drift | tree-sitter AST 指纹 + git provenance 点锚；drift.lock schema 作参照 | **[已核验]** 真实开源产品，机制完全吻合 | 可作为点锚路线的事实级参照 |
| OpenLore | spec 实体映射代码图节点 + drift 三态 | **[已核验]** 真实开源产品（4 态：Gap/Stale/Uncovered/ADR-gap） | 可作为全仓路线的事实级参照；与我们资产最契合 |
| Dusk Pituitary | 全仓矛盾 lint + MCP 暴露 | **[未核验/概念archetype]** 未找到同名真实产品 | 仅作「全仓矛盾 lint」概念引用，不绑定产品名 |
| Meta 30% spec drift | 生产分类法 Specification Drift ~30%（问题规模证据） | **[未核验]** 找不到任何 Meta 官方研究/博客/talk | **不得引用为 Meta 事实**；改用可核验的开源/IEEE 数据 |
| AGENTbench 反例 | drift 服务于「spec 精简且真实」而非生成更多内容 | **[已核验]** ETH Zurich《Evaluating AGENTS.md》实证支撑 | 可作为非目标的事实级弹药 |

**对立项的影响**：问题规模弹药需要换锚点。「Meta 30%」不可用，但「文档随代码腐化」这一问题本身有大量可核验证据（见 §4），且 AGENTbench 反例（§5）反而是更强、更精准的弹药——它把本 Feature 的价值主张从「文档会过时」升级为「过时/冗余的 spec 会主动伤害 agent」，这正好支撑非目标。

---

## 1. Fiberplane Drift —— 点锚路线（per-reference）**[已核验]**

**来源**：`github.com/fiberplane/drift`（持续提交 + tagged release）；Fiberplane 博客自述为「documentation rot 的 linter」。

### 1.1 核心机制
- **绑定单元**：markdown spec 中的 anchor 绑定到一个具体代码位置——文件，或文件内 `#Symbol`。
- **指纹算法**：用 tree-sitter 解析（TS / Python / Rust / Go / Zig / Java），对目标的 **normalized AST**（node kinds + token text，忽略空白与位置）计算 **XxHash3** 得到 `sig`。
- **降级路径**：不支持的语言回退到 raw content 比对。
- **staleness 检测**：重算指纹与存储的 `sig` 比对——纯格式化改动不触发 stale。

### 1.2 drift.lock schema（兼容性参照）
- 仓库根的**版本化 TOML lockfile**。
- 每条 binding 记录：doc path、code target（file + 可选 `#Symbol`）、AST 指纹 `sig`、可选 `origin`（跨仓库 doc）。

### 1.3 CLI 形态
- `drift link`：新增/刷新 binding，写 `drift.lock`，盖上 AST 指纹。
- `drift check`（别名 `drift lint`）：检查所有 binding，有 stale 则 **exit 1**（适合 CI gate）。
- `drift status` / `drift unlink` / `drift refs`（反向查询：哪些 doc 引用了某文件）。

### 1.4 与我们资产的映射关系（关键）
Fiberplane 的 **symbol 锚点机制**（`file#Symbol`）与我们 **F181 symbol id + F174 canonicalize/fuzzy**（`src/knowledge-graph/query-helpers.ts`）思路一致，可直接复用。**但指纹层有关键差距**：Fiberplane 用 **normalized AST**（忽略空白/位置/注释）→ XxHash3，而我们现成的 **F182 `skeletonHash` 实为文件级 raw-content SHA-256**（`createHash('sha256').update(sourceFile.getFullText())`，见 [src/core/ast-analyzer.ts:507](../../../src/core/ast-analyzer.ts)、[src/core/tree-sitter-analyzer.ts:200](../../../src/core/tree-sitter-analyzer.ts)）——名为 skeleton，实际哈希全文，**格式化/注释会改 hash**。

因此准确表述：**我们已有可复用的 graph id（F181）+ canonicalize/fuzzy（F174）+ 文件级 content hash（F182），足以验证「粗粒度点锚 prototype」**；normalized-AST 指纹 + symbol 级粒度是**缺口**（M9-C follow-up）。prototype 的最小闭环 = 在 graph-id/content-hash 基座上加「binding 存储 + check 命令」薄壳。**不可声称「与 Fiberplane 同构 / 零件已全部具备」。**

> 📌 **research-phase 视角更新**：以上为调研阶段对「最省事路径」的判断（复用 F182 文件级 hash）。GATE_DESIGN 后用户拍板「prototype 内现写 symbol 级指纹」，故实际 prototype 没用 F182 文件级 hash，而是自实现 symbol 级源切片 + 逐行空白归一化（介于 F182 文件级与 Fiberplane 全 AST 之间的中间档）——已消除「文件级同文件连累」误报、达成「缩进/空行不敏感」。详见 [../spec.md](../spec.md) Gate 决策修订 与 [../decision/route-selection.md](../decision/route-selection.md) §7。

---

## 2. OpenLore —— 全仓 / 图节点映射路线（whole-repo）**[已核验]**

**来源**：`github.com/clay-good/OpenLore`，npm `openlore`；配套 OpenSpec living spec。

### 2.1 核心机制
- 用静态分析把代码库建成 **call-graph backed 知识图谱**（持久化在 SQLite：functions / clusters / routes / DB schemas 等），与 OpenSpec spec 层共存为「co-equal」资产。
- `openlore drift`：把 **git 改动**与 spec 映射比对，「毫秒级」完成，可作 pre-commit hook。
- 管线：`analyze` → `generate`（产 OpenSpec spec）→ `drift` → `decisions`（管 ADR）。

### 2.2 drift 分类（4 态，可坍缩为三态）
| OpenLore 原始类别 | 语义 | 三态坍缩 |
|------------------|------|---------|
| **Gap** | 代码改了但对应 spec 没更新（spec 落后实现） | stale |
| **Stale** | spec 引用的文件被删/移动（指向不存在的实现） | stale/orphaned |
| **Uncovered** | 新文件没有任何 spec section 映射（覆盖空洞） | orphaned（code 侧孤儿） |
| **ADR gap** | 代码改在被 ADR 引用的 domain（偏离已记录决策） | stale（决策级） |

### 2.3 映射规则（从改动文件 → 受影响 spec）
1. git diff 求出 added/modified/deleted/renamed 文件，过滤 test/generated/lock/asset/CI 噪声。
2. 用 spec 的 `> Source files:` header + technical note 里的 implementation 引用，把每个改动文件映射到 domain。
3. 显式映射缺失时，用目录结构启发式（`src/auth/` → auth domain）。

### 2.4 与我们资产的契合点（关键）
OpenLore 的「spec 实体 ↔ code graph node」正是我们 **F193 id 相对化 + F183 normalizeGraphForWrite** 封闭图链 + `specs/` 增量 spec 的天然形态。区别：OpenLore 的锚点粒度偏 **file/domain 级**（靠 `Source files` header + 目录启发式），我们的图节点已下到 **symbol 级**（functions/methods，带稳定 id），理论上能给出比 OpenLore 更细的锚点。

### 2.5 旁证：Tessl Drift Guard **[已核验/相关]**
Tessl developer-kit 的「Drift Guard」（`spec-sync-context` / `spec-sync-with-code` / `drift-init|monitor|report`）走的也是「持久化 JSON 知识图谱 + spec↔code 映射」路线，与 OpenLore 同构，佐证全仓路线是一条被多方独立采用的成熟路线。

---

## 3. Dusk Pituitary —— 全仓矛盾 lint + MCP 暴露 **[未核验/概念archetype]**

定向搜索**未找到同名真实产品**。Perplexity 将其作为一类架构 archetype 处理：「whole-repo contradiction linter，把全仓 doc/spec/code/test 抽成 constraint graph，检测矛盾后经 MCP 暴露给 agent」。

**处置**：spec 中只引用其**概念**（全仓矛盾 lint + MCP 暴露 = 比 drift 检测更激进的一类形态），**不绑定产品名**。其价值在于划定本 Feature 的能力边界上界：我们本期做的是「锚点 staleness」（点对点失配），不是「全仓语义矛盾推理」（constraint graph 级 contradiction）——后者是更远期、误报面更大的形态，明确写进非目标的「不做什么」。

---

## 4. 问题规模弹药（换锚点后的可核验版本）**[部分已核验]**

「Meta 30%」**[未核验]**，剔除。改用以下可核验/可标注来源支撑「文档随代码腐化」的规模：

- **[已核验/开源研究]** 开源项目研究：25–40% 文档元素（注释/API doc/设计文档）在创建后 **6 个月内过时**，commit 频率越高、团队越大腐化越快。
- **[已核验/IEEE 调查]** IEEE Computer Society 调查：约 **65%** 软件维护团队把「过时文档」列为维护的重大阻碍（top-3 挑战之一）。
- **[已核验/JSS]** 维护程序员 30–50% 时间花在理解既有代码，其中相当部分用于在代码与文档不一致间导航。
- **[标注为综合估计]** 多份研究的衰减曲线一致：初始 >90% 准确，6 个月降到 50–60%，1 年降到 30–40%（无专门维护时）。

**spec 写法**：问题规模段落用「文档腐化是被多项独立研究量化的成熟问题（25–40%/6mo、65% 团队受阻）」立论，**不出现「Meta 30%」字样**。

---

## 5. AGENTbench 反例边界 —— 最强弹药（非目标的事实根据）**[已核验]**

**来源**：ETH Zurich《Evaluating AGENTS.md》，在 SWE-bench Lite（300 任务）+ 自建 AGENTbench（138 任务/12 仓）上评测 repo 级 context 文件（AGENTS.md/CLAUDE.md 形态）。

### 5.1 核心实证
- **LLM 生成的 context 文件平均把成功率拉低 ~2–3%**，同时 token 成本 **+20–23%**、多 2–4 步推理。
- 人写 context 文件平均小幅 +4pp（AGENTbench），但仍带 10–22% token 开销。
- **关键对照**：当剥离仓内所有文档、只留 context 文件时，LLM 生成文件反而 +2.7%——证明伤害来自**冗余**（与可从代码推断的信息重复），不是文档本身。
- 启发式：「**如果 agent 能靠读代码/配置发现，就从 AGENTS.md 删掉它**」；实践甜区 200–300 行，超 ~500 行引入 context rot。

### 5.2 对本 Feature 价值主张的升级
这条把 F189 的定位从「文档会过时（被动问题）」升级为「**过时/冗余的 spec 会主动伤害 agent 成功率并加成本（主动伤害）**」。因此 drift 检测的目的不是「生成更多文档」，而是「持续证伪 spec 引用、把不真实的部分标出来删/修，保持 spec 精简且真实」——这正是非目标要钉死的边界，且现在有硬数据撑腰。

---

## 6. 路线选型的研究结论（喂给决策文档）

两条已核验路线 + 我们的资产位置：

| 维度 | 点锚（Fiberplane 式） | 全仓（OpenLore 式） |
|------|---------------------|-------------------|
| 锚定单元 | 单条 spec 引用 → symbol/file 指纹 | spec domain ↔ code graph 子图 |
| 我们的现成零件 | F181 symbol id + F174 canonicalize/fuzzy（齐全）+ F182 **文件级 content hash**（可用但粗：非 normalized-AST、非 symbol 级） | F193/F183 封闭图链 + `specs/`（齐全，但锚点映射规则要新建） |
| staleness 信号 | 指纹失配（精准、点对点、低误报） | git diff × spec 映射（覆盖广，但 file/domain 粒度、误报面更大） |
| 误报面 | 低（只在被绑定 symbol 变化时报） | 中（目录启发式映射 + 「改了就报」易噪声） |
| MVP 工程量 | **小**（绑定存储 + check 薄壳） | 中（映射规则 + 分类引擎 + 严重度分级） |
| 与「精简真实 spec」非目标的契合 | 强（点对点证伪，天然最小化） | 中（domain 级，易鼓励补更多覆盖） |

**研究层倾向**（最终选型在决策文档 + 用户拍板）：**点锚路线作为 MVP/prototype 首选**——它工程量最小、与我们已有 symbol-id（F174/F181）资产 1:1 对接、且最贴合「精简真实」非目标。⚠️ 注意 MVP 用 F182 文件级 content hash 是**粗粒度**版本（格式化敏感 + 文件级误报），「低误报」是 normalized-AST/symbol 级指纹（M9-C）的目标，**不是 MVP 当下的属性**；全仓路线作为 M9+ 的可叠加增强（我们的 symbol 级图节点能做出比 OpenLore 更细的版本），不在本期闭环。

---

## 附：来源可信度备注
- Fiberplane Drift / OpenLore / Tessl / ETH AGENTbench 研究：定向 web_search 二次核验通过，有 repo/论文实体。
- Meta 30% / Dusk Pituitary：二次核验未通过，已在上文显式标注，不进入 spec 事实层。
- 本文件中的具体百分比（25–40%、65% 等）来自 Perplexity 综合的二手文献转述，spec 引用时统一标注为「多项研究综合估计」，不伪装成单一权威出处。
