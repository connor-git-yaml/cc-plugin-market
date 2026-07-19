# 路线选型决策 — AST-anchored Spec Drift Detection（F189）

**决策日期**：2026-06-13
**状态**：草案（待 prototype 验证后定稿）
**关联**：[../spec.md](../spec.md) · [../research/prior-art-synthesis.md](../research/prior-art-synthesis.md)
**决策权**：路线最终拍板在用户；本文档给选型建议 + 理由 + M9 ship 路径，供 GATE_DESIGN 决策

---

## 0. 决策摘要（TL;DR）

| 项 | 结论 |
|----|------|
| **MVP/prototype 选哪条** | **点锚路线（per-reference，Fiberplane Drift 式）** |
| **核心理由** | 最贴合"精简真实 spec"非目标、工程量最小（复用 F174/F181 id 资产 + F182 文件级 hash）、可演进。⚠️「低误报」是 M9-C normalized-AST 版的目标，**非 MVP 当下属性**（MVP 文件级 raw-content hash 格式化敏感） |
| **全仓路线（OpenLore 式）地位** | M9+ 可叠加增强，不在本期闭环；我们的 symbol 级图节点能做出比 OpenLore 更细的版本 |
| **两条路线关系** | 不是二选一对立，而是**同一锚定基座上的两种消费方式**——点锚先落地，全仓后叠加 |

---

## 1. 两条路线的本质区别

| 维度 | 点锚（per-reference） | 全仓（whole-repo lint） |
|------|---------------------|------------------------|
| 已核验参照 | Fiberplane Drift `github.com/fiberplane/drift` | OpenLore `github.com/clay-good/OpenLore` |
| 锚定单元 | 单条 spec 引用 → symbol/file 内容指纹 | spec domain ↔ code graph 子图映射 |
| 触发信号 | 指纹失配（点对点） | git diff × spec 映射（覆盖扫描） |
| staleness 判定 | 被绑定实体变了才报 | "改了 domain 内文件且 spec 没动"就报 |
| 误报面 | **低**（只在被显式绑定的 symbol 变化时） | **中**（目录启发式映射 + "改了就报"易噪声） |
| 覆盖面 | 仅被显式锚定的引用（需主动建锚） | 全仓自动覆盖（无需逐条建锚） |
| 锚的来源 | 显式 `drift link` / spec 内标记 | 自动从 `Source files` header + 目录推断 |
| 适合回答的问题 | "我引用的这个 symbol 还准吗？" | "全仓哪些 spec 落后于代码了？" |

**关键观察**：两条路线的差异本质是**锚的粒度与来源**，不是底层技术栈——两者都需要"解析代码实体 + 算内容指纹 + 存映射 + 比对"。我们的 F174 canonicalize/fuzzy（id 解析）+ F182 文件级 content hash（指纹，粗粒度）是**两条路线共用的基座**。

---

## 2. 我们的资产位置（为什么点锚是 MVP 首选）

### 2.1 点锚路线：id 资产齐全，指纹层够用但粗
| Fiberplane 点锚需要的能力 | 我们的现成资产 | 缺口 |
|--------------------------|---------------|------|
| 代码实体 → 稳定 id | F181 symbol id（`filePath::name`）+ F174 canonicalize/fuzzy | 无 |
| 内容指纹 | F182 **文件级 raw-content SHA-256**（名 skeletonHash 实哈希全文） | ⚠️ **非 normalized-AST、非 symbol 级**——MVP 可用但格式化敏感 + 文件级误报；normalized/symbol 级是 M9-C 缺口 |
| 跨 worktree id 一致 | F193 relativizeSymbolId | 无 |
| binding 存储（drift.lock） | —— | **薄壳**（prototype 建） |
| check 命令 + 退出码 | —— | **薄壳**（prototype 建） |

点锚路线的 MVP = 在已有 id 基座 + 文件级 content hash 上加"绑定存储 + check"两层薄壳，**零生产代码改动**（只读复用），完全落在 `specs/189-*/prototype/`。指纹层用粗粒度的 F182 先闭环，把 normalized-AST/symbol 级指纹明确留给 M9-C——这是本期 prototype 在最小工程量下闭环、且不掩盖局限的取舍。

### 2.2 全仓路线：基座也有，但映射规则要新建
全仓路线我们也有基座（F193/F183 封闭图链 + `specs/` 增量 spec），但需新建：
- spec domain ↔ 文件集的**映射规则**（OpenLore 靠 `Source files` header + 目录启发式，我们 spec 没有这个 header 约定，要先定 schema）
- **分类引擎**（Gap/Stale/Uncovered/ADR-gap）+ 严重度分级
- git diff 噪声过滤（test/generated/lock/asset）

工程量明显大于点锚，且映射靠目录启发式会引入误报——不适合作为"立项最小闭环"。

---

## 3. 与非目标的契合度（决定性因素）

spec 非目标 #1："drift 检测服务于**精简且真实的 spec**，不是生成更多文档"（AGENTbench 实证撑腰）。两条路线对此的契合度：

- **点锚 ✅ 强契合**：点对点证伪——只对"研发主动声明要锚的引用"做 staleness 检查，天然最小化、不鼓励补覆盖。stale 信号直接指向"这条引用该删/修"。
- **全仓 ⚠️ 中等契合**：Uncovered 类别会主动提示"这个文件没有 spec 覆盖"，**容易诱导研发去补更多 spec** —— 与"精简真实、不生成更多文档"的非目标存在张力。全仓路线若 M9+ 引入，需谨慎处理 Uncovered 的 UX，避免变成"覆盖率焦虑"驱动文档膨胀。

这条是点锚胜出的决定性理由：它不仅工程量小，而且**价值取向与本 Feature 的立项哲学一致**。

---

## 4. 选型结论与理由

**选点锚路线作为 MVP/prototype，理由按权重排序：**

1. **价值取向一致**（最高权重）：点对点证伪 = 精简真实，全仓 Uncovered 易诱导文档膨胀，与非目标 #1 冲突。
2. **误报面相对全仓更可控**：只在被显式绑定的引用上报，不像全仓"目录启发式映射 + 改了就报"那样宽。⚠️ 但 MVP 用文件级 content hash，**仍有两类 MVP 误报**：纯格式化触发 stale、同文件他处改动连累本锚——这两类要等 M9-C normalized-AST/symbol 级指纹才消除，本期不声称"误报最低"。
3. **工程量最小**：复用 F174/F181 id 资产 + F182 文件级 hash + F193 相对化，只加两层薄壳，零生产代码改动，本期可闭环。
4. **可演进**：点锚基座是全仓路线的子集——M9+ 要做全仓时，锚定/指纹/解析层完全复用，只在其上加"自动映射 + 分类引擎"。先点锚不堵全仓的路。

**全仓路线不是被否决，而是被排序到 M9+**：我们的 symbol 级图节点（比 OpenLore 的 file/domain 级更细）是差异化优势，值得做，但不在"立项最小闭环"里。

---

## 5. M9 Ship 路径草案

> 本期**不**实际接入；以下为 ship 形态草案，供 M9 决策。

### 5.1 阶段拆解
| 阶段 | 交付 | 依赖 |
|------|------|------|
| **M9-A 点锚 ship** | prototype → 生产：`scripts/spec-drift-check.mjs` + 仓库根/`specs/` 内 `spec-drift.lock`；`drift link`/`drift check` 命令 | 本期 prototype 验证通过 |
| **M9-B repo:check 集成** | drift check 作为 `validateRepository()` 的子 check，stale 锚以 **warning**（非 hard-fail）暴露 | M9-A |
| **M9-C symbol 级指纹** | 指纹粒度从"文件 skeletonHash"下沉到"symbol AST 子树 hash"，消除同文件 false-positive（对齐 Fiberplane `#Symbol`） | M9-A；需在 graph 节点上挂 per-symbol hash |
| **M9-D rename-follow** | symbol 重命名时跟随（fuzzy + git rename detection），区分真 orphaned 与 renamed | M9-C |
| **M9-E（可选）全仓叠加** | 在点锚基座上加自动映射 + Gap/Uncovered 分类，谨慎处理 Uncovered UX | M9-A~D |

### 5.2 repo:check 集成形态（grounded 在现有结构）
现有 `scripts/repo-check.mjs` 调 `validateRepository(projectRoot)`，返回 `{status, checks:[{id,status}], warnings, errors}`，`status==='fail'` → exit 1。

M9-B 集成方式：在 `scripts/lib/repo-maintenance-core.mjs` 的 `validateRepository` 加一个子 check：
```
{ id: 'spec-drift', status: 'pass' | 'warn' | 'fail' }
```
- stale/orphaned 锚 → 进 `warnings`（不让 `status='fail'`，避免 drift 阻断提交）
- 仅当 `--strict` 或 lock 文件损坏 → `fail`
- 对齐 spec FR-008 / US3：drift 是 warning 信号，不是 hard gate

### 5.3 ship 前必须解决的已知局限（本期 prototype 会暴露）
1. **文件级指纹 false-positive**（同文件 symbol B 变化误标 symbol A）→ M9-C 解决
2. **rename → orphaned 误判** → M9-D 解决
3. **建锚的 UX**：研发如何低成本声明锚（spec 内标记语法 vs 单独 `drift link`）→ ship 前定 schema

---

## 6. Follow-up（本期非目标，登记备查）
- symbol 级 AST 子树指纹（M9-C）
- rename-follow（M9-D）
- 全仓自动映射 + 分类引擎（M9-E）
- spec 内锚标记语法 schema（ship 前必做）
- 多语言 parser 覆盖（依赖 graph 既有支持）

---

## 7. Prototype 验证结果（已回填）

prototype 跑通 11/11 验收场景（`npx tsx specs/189-.../prototype/demo.ts` → exit 0），实测结论：

- [x] **点锚最小闭环成立**：建锚（裸名 `add` → `math.ts::add` + symbol 级指纹）→ 改 symbol 体 → 标 `stale`（exit 1，expected≠actual），如设计工作。
- [x] **GATE 决策升级生效——缩进/空行不敏感成立**：`add` 仅缩进/空行重排 → 保持 `fresh`。symbol 级源切片 + 逐行空白归一化（保留换行，避免 ASI 漏报）达成点锚 MVP 的「缩进/行内空白/空行不敏感」（比原 file-level 方案强；GATE 选 symbol 级的直接收益）。
- [x] **symbol 级消除「同文件连累」误报**：改 `multiply`、`add` 不变 → `add` 保持 `fresh`。原 file-level 方案在此会误报 stale，symbol 级实测已消除。
- [x] **check 退出码 + 报告适合 M9-B**：standalone exit 0/1/2（fresh / stale·orphaned / graph-unavailable）+ 结构化 `DriftReport`，可直接映射到 repo:check 的 warning 语境（见 prototype/README §repo:check 集成草案）。
- [x] **全仓 demo 成立**：gap/uncovered/stale-ref 分类正确，与点锚并列对照——实证全仓覆盖广但靠映射启发式、点锚精准但需建锚，支撑「点锚先行、全仓 M9+ 叠加」选型。

**残留待 M9 项**（prototype 已显式暴露，非阻塞立项）：span 内注释/字面值变化仍触发 stale，而**前导 JSDoc/注释在 span 外、变化静默判 fresh**（后者是 under-report 盲区而非保守残留，方向相反；两向均需 M9-C normalized-AST）；`Class.method` 回退到 Class span（member 无 span）；rename → orphaned 不跟随（M9-D）。
