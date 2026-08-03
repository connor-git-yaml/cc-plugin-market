
# Feature Specification: Graph Collector Fingerprint（图产物版本化）

**Feature Branch**: `249-graph-collector-fingerprint`
**Created**: 2026-08-03
**Status**: Draft
**Input**: User description: "为 Spectra 知识图谱的 freshness 判定设计并实现 collector 指纹（graph 产物版本化）"

## 背景修正说明

任务陈述中"TSJS 采集面已扩展到含 .mjs/.cjs"的前提**不成立**（master@264338b 实测：`walkTsJsFiles` 仍为 4 扩展）。本 spec 基于代码上下文摘要 §2 修正后的事实编写：今天可复现的机制缺口实例是 **F242 行为变更**（同源码、同 commit、工作树干净，但 call-edge 抽取逻辑改变导致边集不同），而非采集面扩展。采集面扩展是**已登记但尚未发生**的未来风险，本需求需同时防住这两类失效。

Specify 阶段 Codex 对抗审查（R1）另证伪代码上下文摘要中 3 处事实断言（`.pyi` 采集面遗漏、Java/Go 大小写匹配语义、`module-derivation`/`ts-js-adapter` 声明层实为建图生产面），编排器逐条源码复核确认后已在 `codebase-context.md` v2 修正；同轮审查另确认"既有 F214 门禁可借力""additive 字段零契约影响""fingerprint 判定与 dirty 正交并列"三处方案假设不成立。本次修订即针对这 6 处 CRITICAL + 7 处 WARNING 逐条落实的改写。

第二轮对抗审查（R2）在前述基础上再证伪 2 处事实断言：`moduleDerivationScan`（#7/#8）的匹配语义实为**大小写不敏感**（而非未定义或与 skeleton walk 同为大小写敏感）、`graph-only` 模式实际**不消费** `moduleDerivationScan` 产物（仅 full batch 主链消费）；编排器逐条源码复核后已在 `codebase-context.md` v3 修正。本次修订同时封堵护栏"再生不 bump"绕过、补齐畸形指纹（invalid）判定、约束单一事实源模块的零依赖叶子落位、并强化 Success Criteria 的可执行性与 FR→SC 覆盖度。

第三轮对抗审查（R3）终审确认 R2 七项 CRITICAL/WARNING 全部 closed，并新抓 1 处 CRITICAL（护栏盲区 N-001：FR-005 此前只用 graph-only 链路重建-对比，但 `moduleDerivationScan` 管线仅 full batch 消费，该管线的行为变更不会让 graph-only pinned 图变红）与 1 处 CRITICAL（N-002：`codebase-context.md` §2/§6 残留"fingerprint 缺失与 unknown-provenance 对齐""`.mjs` 只在声明层"两处过时表述，已由编排器直接修正；spec 侧全文扫描确认无同类残留）；另有 3 处验收强度类 WARNING（N-003/N-004/N-005）。本次修订将 FR-005 护栏升级为**双轨**（a-track graph-only 重建对比 + b-track module producer 直接探针），补齐结构 oracle 覆盖面（#4/#5/#6 + import 边界静态 oracle）、bump 责任清单结构化导出、确定性验收升级为跨进程对比、并补两条回归 oracle。

Plan 阶段审查反馈回写（第一轮）：SC-005 oracle 形态与 #4 seam 命名校准（C-02 处置）。

Plan 阶段审查反馈回写（第二轮）：再生脚本拒绝判据回归 FR-005(e) 原文的二元判据（方向性撤回第一轮编排器自行引入的扩展判据，当前表述见 plan.md「再生脚本」一节，被否决方案的历史记录仅存于 plan.md「Complexity Tracking」的 `[已否决方案记录]` 一行）、SC-010 校准为可执行的扰动注入测试三件套证明形态、SC-005 #4/#8 oracle 归类进一步校准（#4 归类为 seam 导出层 `===` + 消费点 AST oracle 双重覆盖；#8 移出 `===` 名单改用 AST oracle + 行为探针，因该落点无外部可持有的运行时 seam）、复杂度评估的影响文件数与实现风险等级同步 plan 阶段判定（见下方「复杂度评估」一节）。至此 spec 层面共经历四轮 Codex 对抗审查（specify 阶段 R1-R3 + plan 阶段两轮回写），全部已收敛处置。

Plan 阶段审查反馈回写（第三轮）：SC-005 a1 清单补齐 #3（Java/Go adapter 运行时引用同一性断言，此前 a1 清单仅显式列举 #4/#7，遗漏已在盘点表汇总句中隐含声称覆盖的 #3，见下方 SC-005 定义）。

### v6 · rebase 调和补记（2026-08-03）：预言的"未来扩面"在交付窗口内真实发生

本 Feature 实现完成、等待交付期间，master 已由 **d27ba75（对方 F243，`243-fix-mjs-graph-coverage`）** 落地 `.mjs`/`.cjs` 采集面扩展。这使本 spec 开篇的两处判断同时被现实校验：

- **本节原判断"采集面扩展是已登记但尚未发生的未来风险"不再成立**——它已经发生，且发生在本 Feature 的交付窗口内。原判断在写作当时（master@264338b）对源码是准确的，此处**不撤回**该记录，只追加事实更新。
- **本 Feature 的核心论证被正面验证**：codebase-context §2 曾论证"F249 是安全做该扩展的前置条件（没有指纹，扩面那天全球所有旧图静默变陈旧）"。d27ba75 正是在**没有指纹机制**的前提下扩了面——所有 d27ba75 之前建的图从此系统性缺 `.mjs`/`.cjs` 节点，而 freshness 判定对此毫无信号（源码 commit 未动 + 工作树干净 → 仍判 `fresh`）。这不再是推演，是已发生的既成事实；本 Feature 的指纹机制正是该类静默陈旧的唯一检出手段。

**实现方式的差异与收敛**：d27ba75 采用的是**四处镜像同步**（`walkTsJsFiles` 白名单 / `source-commit.ts::TSJS_COLLECTOR_EXTENSIONS` / `ignore-oracle.ts::TSJS_EXTENSIONS` / `cache-key-builder.ts::INCLUDED_EXTENSIONS` 各自加字面量 + 注释互指 + 防漂移测试）——这正是 FR-002 认定的问题形态本身。rebase 调和的处置是：**四处镜像随本 Feature 的 SSoT 收敛一并消亡，6 扩展面改由 `TSJS_SKELETON_WALK_SURFACE` 单点表达**，扩面语义 100% 保留（并经 d27ba75 自带的回归测试 `tests/batch/source-discovery.test.ts` / `tests/panoramic/cache/cache-key-builder.test.ts` / `ignore-oracle.test.ts` 反向验证）。"四处手工同步"的旧模式由本 Feature 终结。

**撞号重编**：d27ba75 抢占了 F243 编号，本 Feature 重编为 **F249**（目录 `specs/249-graph-collector-fingerprint`）。全仓 spec 编号引用已同步；对 d27ba75 的指代一律保留"F243"并显式标注"对方 F243"或直接引 commit hash 以免混淆。

#### v6 新登记残留：第七处镜像（跨语言，本 Feature 显式不修）

rebase 核查时发现 d27ba75 的"四处扩展名脱节同步收口"实际漏了**第五处**——`plugins/spec-driver/scripts/lib/graph-consumption-decision.mjs::GRAPH_SCOPE_EXTENSIONS`（F241 引入），其文档明写"图 walker 的扩展名白名单（O-5：`source-discovery.ts` 只收这四类）"并声称自己是"全仓唯一定义处"，但值仍是 4 扩展：

```js
export const GRAPH_SCOPE_EXTENSIONS = Object.freeze(['.ts', '.tsx', '.js', '.jsx']);
```

**实际影响**：F241 的图消费决策会把 `.mjs`/`.cjs` 改动判为 `out-of-graph-scope`，而这些文件现在确实在图内（本仓实测图中含 1040 个 `.mjs` 相关节点）——即"范围内不注解"的自相矛盾，正是该常量注释自己警告要避免的形态。

**本 Feature 显式不修**，三条理由：(1) 它在 plugin 的 `.mjs` 层，无法 import TS 侧 SSoT，需要独立的跨语言同步机制（生成器或 contract 校验），属独立设计题；(2) 修它会翻转 F241 自带的防漂移断言（`graph-consumption-decision.test.mjs` 断言恰为 4 扩展），需连同 F241 的合同一起重新裁决；(3) 仓库规则禁止在当前需求里顺手改动范围外工具源码。**建议作为 M9/M10 的 fix 候选单独立项**（可与本 Feature 的 SSoT 联动：让 plugin 侧从指纹或生成产物读取采集面，而不是再抄一份字面量）。

**F248 集成的实际处置**（`src/panoramic/graph/collector-extname.ts::extractExtension` 零依赖叶子，790b29f）：编排器原裁决为"把本 Feature `surfaceMatchesFile` 的 extname 族提取改为消费 `extractExtension`，并相应外科修订 FR-019/SC-015 的 import 允许集"。实施核查发现该裁决的前提不成立（SSoT 内不存在 `extractExtension` 式提取，`path.extname` 与之语义不等价，替换会造成 W-004 缺陷回归），故**未按原裁决执行、也未走裁决给的回退方案**（回退方案是"保留内联提取 + 加行为等价对拍测试"），而是采取第三种更彻底的处置——按"保留双方语义意图"原则自行处置并如实登记：

| 落点 | 处置 | 结果 |
|------|------|------|
| `ignore-oracle.ts::extnameOf`（本 Feature 版本仍保留的私有提取） | 删除，改 import F248 的 `extractExtension` | F248 原本的收敛目标之一，**逐字保留其语义**（该处是"手上只有扩展名"的分派型消费方，仍需提取步骤） |
| `source-commit.ts::extname`（F248 已收敛为 `extractExtension` 调用） | 连 `extractExtension` 调用一并删除 | dirty 判定改为整条委托 `surfaceMatchesFile`——提取口径随管线而异，已内化进 SSoT，本模块**不需要任何提取步骤** |
| `source-discovery.ts::fileExtension`（本 Feature 实现期新引入的第三份提取） | 删除，两条 walk 改为 `surfaceMatchesFile(surface, entry.name)` | 消除本 Feature 自己引入的重复；同时修正了原实现对 SSoT 自身文档约定的违反（该文档明确要求"判定某文件是否会被采集 MUST 用 `surfaceMatchesFile`"，原实现却用了 `surfaceHasExtension` + 本地提取） |
| `collector-surface.ts::surfaceMatchesFile` | 不改（`case-sensitive` 用 `endsWith`、`case-insensitive` 用 `path.extname`） | 维持零依赖叶子；避免 W-004 回归 |

净结果：全仓 `lastIndexOf('.') + slice` 式提取实现从 3 份收敛到 **1 份**（F248 的共享叶子），消费方从 2 处减到 1 处（`ignore-oracle.ts`）——F248 的意图达成度**高于**其自身交付时的状态。共享叶子未被孤立（仍有真实消费方 + 其共置的 11 个边界用例）。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 外部项目升级 Spectra 后旧图必须获得"需重建"信号（Priority: P1）

外部项目升级 Spectra 到新版本（该版本改变了图产物的抽取行为，例如 F242 式的 call-edge 归属逻辑变更），但项目自身源码 commit 未变、工作树干净。用户此时运行 `spectra graph-quality` 或 `repo:check`，期望得到"图与当前 collector 行为不一致，需要重建"的信号，而不是被现有四态判定误判为 `fresh`。

**Why this priority**: 这是本需求的核心失效场景——不解决它，graph-quality 六指标全 pass 会给出虚假的信任信号，用户会长期使用一份系统性缺节点/缺边的陈旧图而不自知。这是所有后续价值的前提。

**Independent Test**: 可独立验证：用旧版本 collector 生成图（记录旧指纹），升级到含新指纹常量的新版本后，不改动任何源码文件，直接跑 freshness 判定，验证结果不是 `fresh`。

**Acceptance Scenarios**:

1. **Given** 一份用旧版本 Spectra 建的图（记录了旧 collector fingerprint），源码 commit 与 HEAD 一致、工作树干净，**When** 用户升级到 collector fingerprint 已 bump 的新版本 Spectra 并运行 freshness 判定，**Then** 判定结果不是 `fresh`，且返回信息中包含"collector 指纹不一致"的可辨识信号（而非笼统的 stale）。
2. **Given** 图的 fingerprint 与当前 collector fingerprint 完全一致，源码 commit 一致、工作树干净，**When** 运行 freshness 判定，**Then** 判定结果为 `fresh`（无回归：一致场景不应引入误报）。

---

### User Story 2 - 维护者扩展采集面/变更抽取行为时有结构化落点（Priority: P1）

Spectra 维护者要扩展采集面（例如未来把 `.mjs/.cjs` 纳入 TSJS collector walk）或变更抽取逻辑（例如未来的 F242 式改动），需要一个明确的、单一的地方去声明"这次变更需要让指纹变化"，而不是依赖人工记忆去同步散落在多处的扩展名镜像，也不会遗漏 bump 指纹导致该变更悄悄逃过 freshness 检测。

**Why this priority**: 没有这个落点，User Story 1 描述的机制无法维持——每次真实的 producer 行为变更都可能因为维护者忘记 bump 常量而失效。这与 P1 同等关键，缺一不可。

**Independent Test**: 可独立验证：修改采集面单一事实源（例如新增一个扩展名）后，不改任何其他文件，重新计算 collector fingerprint，验证其自动感知了该变更（采集面分量自动推导）；同时验证行为版本分量必须显式手动 bump 才会变化（不会被无关改动误触发）；并验证 FR-005 定义的双轨重建-对比护栏在"行为变更但未 bump"时能真实变红（而非依赖任何既有资产），以及在"变更后忘 bump 却直接跑再生脚本"时脚本本身能拒绝执行（FR-005(e)）——双轨（a-track graph-only 重建对比 + b-track module producer 直接探针）任一轨检出行为变更均需成立，覆盖 graph-only 链路可感知与仅 `moduleDerivationScan` 内可感知两类行为变更。

**Acceptance Scenarios**:

1. **Given** 采集面单一事实源中新增一个扩展名，**When** 重新计算 collector fingerprint 的 `extensionSurface` 分量，**Then** 对应管线子分量的值发生变化，且无需在其他任何文件中手工同步。
2. **Given** 抽取逻辑发生行为变更（如 F242 式改动，或仅影响 `moduleDerivationScan` 管线、graph-only 链路本身不消费的行为变更）但未修改采集面单一事实源、也未显式 bump 行为版本常量，**When** 运行 FR-005 定义的双轨重建-对比护栏测试——(a-track) 用当前 producer 以 graph-only 链路重建入库 fixture 并与 pinned graph-only 期望图做语义对比；(b-track) 直接调用 `buildModuleGraphForProject` 对同一 fixture 重建 module graph 并与 pinned 期望 module graph 做语义对比，**Then** 至少一轨测试必须失败（红）——纯 graph-only 链路可感知的变更由 a-track 抓住，仅 `moduleDerivationScan`（仅 full batch 消费、graph-only 链路本身不执行）内的行为变更由 b-track 抓住，作为"此时必须 bump 行为版本"的强制提示；理由：既有 `graph-semantic-diff.mjs` 与既有 pinned fixture 测试均未接线到 test/repo:check/prepublish 链路（`codebase-context.md` §5.1 C-004），不能作为本需求的既有护栏引用，护栏必须由本需求自建并接线。

---

### User Story 3 - 存量旧图（无指纹字段）的诚实降级路径（Priority: P1）

用户持有一份在本需求上线之前生成的图产物，其中不含 collector fingerprint 字段。用户运行 freshness 判定时，系统不应因缺失该字段而崩溃，也不应默认放行判为 `fresh`（否则本需求上线前的所有存量图会天然绕过整套机制），而应给出明确的"collector 版本无法证明与当前实现一致"的降级信号——这是保守的 fail-closed 处理，而非对旧图的负面事实断言（详见 FR-010）。

**Why this priority**: 这是本需求的核心验收点之一——若处理不当，新机制形同虚设：上线前的图永远得不到检测。必须与 P1 同批完成，否则整个机制的实际覆盖率为零。

**Independent Test**: 可独立验证：构造一份不含 fingerprint 字段的图产物（模拟旧版本产出，或模拟绕过 CLI 直接调用建图 API 的合法产出），在 fingerprint 已存在的新版本下运行 freshness 判定，验证结果既不是 `fresh`（宽松放行）也不是硬性报错（crash），而是 `stale` 状态 + `collector-fingerprint-unrecorded` 判别信号，并在 graph-quality CLI / repo:check 两个消费方均产生非静默告警、且告警文案与"sourceCommit 不一致"型 stale 不同（reason-aware）。

**Acceptance Scenarios**:

1. **Given** 图产物的 fingerprint 字段为 `undefined`（旧图），源码 commit 与工作树判定均满足 `fresh` 条件（即 sourceCommit 判定链未先短路到 `unknown-provenance`），**When** 运行 freshness 判定，**Then** 判定结果为 `stale`，并带有 `staleReasons` 数组中包含 `collector-fingerprint-unrecorded`（或等价命名），明确区别于"源码 commit 不一致"型 stale。
2. **Given** 图产物的 fingerprint 字段为 `undefined`，**When** 运行 `graph-quality` CLI 或 `repo:check`，**Then** 系统不崩溃，且按 FR-011/FR-012 对该 stale 情形发出与"sourceCommit 不一致导致的 stale"同级或更强的告警（不得静默视为通过），文案准确反映"指纹缺失"而非"源码不一致"。

---

### Edge Cases

- **非 git 仓库**：`resolveSourceCommit` 返回 `null` 时，现有逻辑短路为 `unknown-provenance`；新增指纹判定必须遵循同一优先级——指纹比较不应绕过或覆盖这一已有短路路径。该短路路径的直接回归验收见 SC-017。
- **fingerprint 存在但 sourceCommit 为 null**（如图产物来自 `spectra graph` 命令，F217 决策：sourceCommit 写 `null`）：判定顺序以 FR-009 为准——`sourceCommit` 为 `null` 会先短路到 `unknown-provenance`（FR-009 步骤 (1)），此时指纹不被单独报告为 stale 原因；实现约束仅为"任一组合（fingerprint 存在/缺失/畸形 × sourceCommit 存在/null）都不得抛未捕获异常"，MUST NOT 假设二者同时存在或同时缺失。具体行为语义以 SC-003b 的回归断言为准。
- **fingerprint 为 `null`（而非 `undefined`）且 sourceCommit 非 null**：这是类型上可表示但语义异常的组合（正常情形下 fingerprint 仅在 `spectra graph` 路径写 `null`，该路径 sourceCommit 也必为 `null`）。`null` 与 `undefined` 在指纹判定上 MUST 同等处理，均按 FR-010 的 `collector-fingerprint-unrecorded` 路径处理，MUST NOT 判为 `fresh`。
- **匹配语义按语言族保真镜像**（取代原"全局大小写敏感"表述）：`extensionSurface` 的自动推导必须按各采集管线原样保真其现有匹配语义——TSJS skeleton walk（#1）与 PY walk（#2）延续大小写敏感的精确 `endsWith`；Java/Go 泛语言 adapter（#3）延续 `path.extname().toLowerCase()` 大小写不敏感匹配；module 派生扫描（#7/#8 `moduleDerivationScan`）延续其 `scanFiles`/`file-scanner.ts:298` walkDir 内部 `path.extname().toLowerCase()` 大小写不敏感匹配（R2 复审证伪原"未定义匹配语义"表述：该管线并非未定义，而是与 Java/Go adapter 同属大小写不敏感一族，`.MJS`/`.CTS` 等大小写变体会被采集）；MUST NOT 为求统一而对任一管线引入或移除 `toLowerCase()` 归一化（会与该管线生产者 walk/adapter 的真实行为脱节，制造新的镜像失真）。
- **`.pyi` 与大小写变体收敛后新触发 dirty（预期行为变化，非回归）**：收敛前 `getDirtySourceExtensions()` 的 PY 分量只有 `.py`（缺 `.pyi`）、Java/Go 分量大小写敏感（`.JAVA` 不识别），均是与生产者 walk/adapter 脱节的已证实漏报（`codebase-context.md` #2/#3）。收敛后，未提交的 `.pyi` 改动与未提交的 `.JAVA` 等大小写变体改动均 MUST 触发 dirty；这是本需求收敛单一事实源的直接副作用、修复现存漏报，属核心交付而非附带改动。
- **双采集管线独立记录**：TSJS 存在两条并存的进图管线——skeleton walk（#1，4 扩展）与 module 派生扫描（#7 `ts-js-adapter.ts` 声明集 / #8 `module-derivation.ts` fallback，8 扩展，二者本身是引用同一事实源的镜像对）。二者的 `extensionSurface` 子分量必须独立结构化记录（`tsjsSkeletonWalk` vs `moduleDerivationScan`），MUST NOT 合并为单一扁平集合——合并会静默改变"该次变更影响哪条管线"的可辨识性。
- **mode 不区分指纹的权衡**：collector fingerprint 是全局组合值，不按 `--mode` 区分（mode 是运行参数、不是 producer 版本）。R2 复审证伪原表述"module-derivation 管线 graph-only/full 均消费"——`moduleDerivationScan`（#7/#8）**仅 full batch 主链消费**：`graph-assembly.ts` 的 `selectPrimaryModuleGraph`（:312/:317）调用 `buildModuleGraphForProject`，其注释自证 graph-only 路径不执行该函数；`buildAstGraphOnly`（:199）只走 skeleton 采集 + `buildUnifiedGraph`。因此当 `moduleDerivationScan` 的扩展面变更时，graph-only 建的图会被保守标记 stale，即使该图实际不含 module 扫描产物（不受影响）；此为显式接受的保守误报，权衡结论不变（重建成本低，graph-only ~3s），但前提描述已按实锤修正。此保守误报权衡（extensionSurface 变更导致的误报）与护栏检测能力（behaviorVersion 层面的行为变更是否能被检出）是两件不同的事：后者由 FR-005 双轨护栏的 b-track module producer 探针覆盖，不依赖 graph-only 建图路径是否消费 `moduleDerivationScan`，二者不冲突。
- **提交前脏工作树不得吞没指纹 mismatch（FR-009 判定顺序的直接后果）**：commit 一致、fingerprint mismatch、且工作树同时存在未提交改动的场景，判定结果 MUST 为 `stale` 且 `staleReasons` 含 fingerprint 相关原因，MUST NOT 因工作树脏而被判为 `dirty`（fingerprint 判定必须排在 dirty 判定之前评估，见 FR-009）。
- **schemaVersion 1.0 旧 fixture**：`graph-quality` CLI 的 `MIN_SUPPORTED_SCHEMA_VERSION='2.0'` 双边界（`codebase-context.md` §3 FIX-7）**不因本需求改变**——schemaVersion 1.0 的图在该 CLI 依旧被判 `schema-too-old`，判定链路根本到不了 freshness/指纹判定这一步；fingerprint 作为图自身 schema 内的可选新增字段，不在双边界的任一侧新增拒绝条件（不会让原本可解析的图变得不可解析，也不会让原本被拒的旧图变得可解析）。这与 FR-009 提及的 `graph-quality-report.schema.json`（--json 输出契约，独立 schema 对象）的升级互不影响。该双边界回归的执行断言见 SC-018。
- **指纹算法自身演进**：指纹对象 MUST 含 `formatVersion` 字段（当前固定 `1`，见 FR-001）作为未来格式演进的判别锚点；本迭代范围内不做多版本兼容解析（见 FR-016），锚点存在只用于让未来的格式变更"可被识别"，不承诺自动兼容旧格式；未知/不受支持的 `formatVersion` 值不做兼容解析尝试，而是直接归入 FR-018 定义的 `collector-fingerprint-invalid` 路径，使锚点具备稳定的消费语义（"无法识别"本身就是一个可判定、可诊断的结果，而非静默失败或崩溃）。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Collector fingerprint MUST 是一个结构化对象，由三部分构成：`formatVersion`（固定值 `1` 的必填整数，作为未来指纹格式演进的判别锚点，本迭代不做多版本兼容解析）、`extensionSurface`（采集面分量，从单一事实源自动推导，按采集管线结构化区分）、`behaviorVersion`（行为版本分量，显式声明的版本标识常量，反映抽取/归属逻辑的实现版本）。`[必须]`
- **FR-002**: `extensionSurface` 分量 MUST 按采集管线分别结构化记录各自的 `{扩展集, 匹配语义}` 二元组，覆盖代码上下文摘要 §4 盘点表的 #1（`tsjsSkeletonWalk`：4 扩展，大小写敏感 `endsWith`）、#2（`pyWalk`：`.py`+`.pyi`，大小写敏感 `endsWith`，收敛后修复现存 `.pyi` 漏报）、#3（`genericAdapters(java,go)`：按各 adapter `.extensions`，`extname().toLowerCase()` 大小写不敏感）、#7/#8（`moduleDerivationScan`：`ts-js-adapter.ts` 声明集与 `module-derivation.ts` fallback 收敛为对同一单一事实源的引用，8 扩展，大小写不敏感——扩展集经 `scanFiles`/`file-scanner.ts:298` walkDir 用 `path.extname().toLowerCase()` 匹配，`.MJS`/`.CTS` 等大小写变体会被采集，R2 复审证伪原"未定义匹配语义"表述）。MUST NOT 将不同管线的扩展集合并为单一扁平集合。现有 #4 dirty 判定面（原 `getDirtySourceExtensions()` 扁平 `Set<string>` 契约）MUST 收敛为逐管线谓词消费公开 seam `DIRTY_SOURCE_SURFACES`（对本条定义的单一事实源多管线集合的直接 re-export）——原扁平 Set 契约由此废除，由逐管线 `{扩展集,匹配语义}` 谓词替代；#5 `ignore-oracle.ts`、#6 `cache-key-builder.ts` 中的代码扩展子集 MUST 改为引用该单一事实源（而非各自镜像硬编码）；#6 中 doc/config 扩展（`.json/.md/.yaml/.yml/.toml/.lock`）与其自身的 `toLowerCase()` 匹配语义属 cache fallback 自有职责，不纳入本次收敛与指纹范围。`[必须]`
  - **[实现期审查补记 · W-002 · 2026-08-03 落账]** 上述盘点遗漏了**第六条生产管线**：`adapters/python-adapter.ts::scanPyFiles` 的 python 符号扫描面（`pythonSymbolScan`：仅 `.py`、大小写敏感 `endsWith`）。该管线产物经 `extractSymbolNodes` 进入 graph-only 与 full 两种 mode 的图（`stages/graph-assembly.ts` 与 `batch-orchestrator.ts` 各一处调用），因此属于建图采集面，MUST 纳入单一事实源与 `extensionSurface`（第五个 key）。其扫描面（仅 `.py`）与 python adapter 的声明面 `.extensions`（`.py`+`.pyi`，即 #2 `pyWalk` 面）**既有失配**：本轮按「如实记账现状、不改采集行为」处置——`scanPyFiles` 行为不变（`.pyi` 仍不产出符号节点），两面各由一个 SSoT 常量表达并由行为探针钉死；`.pyi` 是否应产出符号节点属产品裁决，另行登记 follow-up。
- **FR-003**: `evaluateFreshness` 的 dirty 判定 MUST 按 FR-002 定义的各管线 `{扩展集, 匹配语义}` 二元组分别应用（而非沿用单一全局语义）；收敛后，未提交的 `.pyi` 改动与未提交的 Java/Go 大小写变体（如 `Foo.JAVA`）改动均 MUST 触发 dirty——这是修复现存已证实漏报（`codebase-context.md` #2/#3），属本需求核心交付而非附带改动。`[必须]`
- **FR-004**: `behaviorVersion` 分量 MUST 是一个需要维护者显式修改才会变化的常量（不可从代码结构自动推导，因为"抽取逻辑是否发生了值得关心的变化"是语义判断，非结构信号）。该常量的 bump 责任覆盖范围 MUST 以**机器可读的结构化导出**（如 `BEHAVIOR_VERSION_BUMP_RESPONSIBILITIES` 常量数组，每项为字符串标识 + 简短说明）呈现，而非仅停留在代码注释列举；代码注释 MAY 与该结构化导出并存作为人读补充，但结构化导出是权威定义，可被测试直接消费断言。该清单 MUST 覆盖以下六类条件（这些条件不属于 `extensionSurface` 的扩展名维度，但属于"采集哪些文件被计入"的行为范畴）：ignore dirs 剪枝规则变化、`.gitignore` 规则解释变化、大小写匹配策略变化、symlink 处理策略变化、单文件 1MB size guard 调整、采集失败降级策略变化。`[必须]`
- **FR-005**: F249 MUST 新建并接线一套**双轨**"重建-对比"护栏，作为 `behaviorVersion` bump 纪律的软提示机制（不做硬性自动检测，理由见 FR-004）：(a) 入库 hermetic 多语言源码 fixture（小型，覆盖 TSJS 4 扩展 + `.py`/`.pyi` + Java + Go，含至少一个大小写变体样本，且含足以触发 `moduleDerivationScan` 的 module 派生结构样本）；(b) 两份 pinned 期望资产——**graph-only 期望图**（含记录的 collector fingerprint）与**期望 module graph**（`buildModuleGraphForProject` 对该 fixture 的直接产出，同样记录 collector fingerprint）；(c) 一个接线到 vitest 套件的双轨护栏测试：**a-track** 用当前 producer 以 graph-only 链路重建该 fixture 图，与 pinned graph-only 期望图做语义对比；**b-track** 直接调用 `buildModuleGraphForProject`（纯 AST/fs 扫描、零 LLM，可在 vitest 内廉价执行）重建 module graph，与 pinned 期望 module graph 做语义对比——理由：`moduleDerivationScan`（#7/#8）仅 full batch 主链消费（见 FR-006），graph-only 链路本身不执行该管线，若护栏只用 a-track 重建-对比，该管线的行为变更永远不会让任一轨变红，构成检测盲区（R3 N-001）；任一轨内容不一致即该轨测试失败（红），修复路径为"bump `behaviorVersion` 常量 + 跑再生脚本"；两轨测试同时 MUST 各自断言对应 pinned 期望资产记录的 `behaviorVersion` 与当前代码中的常量值相等（抓住"bump 后忘再生"半失效——重建产物与 pinned 内容不一致但版本号已声明不同，测试仍会因内容比对而红）；(d) 配套的 fixture 再生脚本入库，**同时产出两份 pinned 资产**（graph-only 期望图 + 期望 module graph）；(e) **再生脚本自身 MUST 内置拒绝机制**：脚本执行双轨重建后，若**任一轨**重建产物与对应现有 pinned 期望资产的语义内容不一致、且当前计算的指纹（`behaviorVersion` + `extensionSurface` 整体）与 pinned 记录的指纹相等，脚本 MUST 拒绝覆写**全部**pinned 资产并打印"检测到指纹不可见的行为变更：先 bump behaviorVersion 再跑再生"；若 `extensionSurface` 已因单一事实源变更而不同，指纹已自动变化，脚本正常放行再生（无需 bump）——(e) 用以封堵"再生后忘 bump"半失效，与 (c) 的版本相等断言互补，共同覆盖两种半失效方向，双轨均受其约束。**fixture 输入（护栏基线）变更同样触发拒绝**：维护者应 bump `behaviorVersion` 声明基线变化后再生——拒绝文案按 `fixtureInputHash` 诊断分流（见 plan.md「再生脚本」一节：该字段仅用于区分"producer 行为漂移"与"fixture 基线变更"两类拒绝文案，不参与放行判定本身）。理由：既有 `graph-semantic-diff.mjs` 与既有 pinned fixture 测试均未接线到 test/repo:check/prepublish 链路，micrograd fixture 再生依赖仓外目录非 hermetic，均不能作为本需求的既有护栏引用（`codebase-context.md` §5.1 C-004）。实施约束：护栏测试与再生脚本 MUST 使用临时目录隔离输出（不得写回入库 fixture 目录本身，仅在双轨校验均通过后才落盘覆写两份 pinned 资产），重建耗时预算在 tasks 阶段以本 fixture 实测值为准给出（历史参考 graph-only ~3s 为 self-dogfood 规模数据，非本 fixture 实测值，不可直接复用）。`[必须]`
- **FR-006**: System MUST 在 batch 主链（`batch-orchestrator.ts` 写入 sourceCommit 处）与 graph-only 模式（`stages/graph-assembly.ts`）两条建图路径中，均计算并写入 collector fingerprint 到图 metadata。两条路径 MUST 共用同一套全局组合指纹（不按 `--mode` 区分 producer 版本，mode 是运行参数非版本标识）；`moduleDerivationScan`（#7/#8）管线**仅 full batch 主链实际消费**（graph-only 的 `buildAstGraphOnly` 不执行 `selectPrimaryModuleGraph`/`buildModuleGraphForProject`，见 `codebase-context.md` §4 #8 [v3 修正]），因此该管线扩展面变更会把 graph-only 建的图也保守标记 stale，即使该图实际不含 module 扫描产物；此为显式接受的误报权衡（graph-only 重建成本低，~3s），本条显式记录该设计决策。`[必须]`
- **FR-007**: `spectra graph` 命令（不解析源码的路径）MUST 遵循 F217 已确立的 provenance 诚实降级惯例——对 fingerprint 字段写 `null`（与 sourceCommit 处理方式一致），不得凭空推导一个虚假的 fingerprint。`[必须]`
- **FR-008**: Collector fingerprint 的计算函数 MUST 作为公共导出提供（而非仅内部消费），使绕过 CLI 直接调用建图 API（如 `buildKnowledgeGraph`）的合法消费者也能显式计算并写入指纹；这与 FR-010 的保守 fail-closed 语义互补——公开导出降低"合法路径产出无指纹图"的发生率，但不改变缺失时的判定结果。`[必须]`
- **FR-009**: `evaluateFreshness` 判定 MUST 按以下优先级顺序求值：(1) `recordedSourceCommit` 为 `null`/`undefined` → `unknown-provenance`；(2) 当前 HEAD 解析失败（`null`）→ `unknown-provenance`；(3) **聚合 stale 判定**：commit mismatch 与 fingerprint mismatch/unrecorded/invalid（fingerprint 为 `null`/`undefined` 归 unrecorded，见 FR-010；结构畸形归 invalid，见 FR-018；且判定链未在 (1)(2) 短路）任一命中 → `stale`，并附带有序判别字段 `staleReasons: string[]`（如 `['source-commit', 'collector-fingerprint']`），多原因并存时全部保留，不得只报告其一，且该数组元素顺序 MUST 确定性（同一输入产出同一顺序，见 SC-007/SC-009）；(4) 工作树按 FR-003 判定 dirty；(5) 否则 `fresh`。fingerprint 判定 MUST 排在 dirty 判定之前评估，理由：dirty 是最常见运行态（提交前的脏工作树），若 fingerprint 判定与 dirty 正交并列或排在其后，会被 dirty 静默吞没（`codebase-context.md` §6 C-006）。本次新增判别字段 MUST 同步升级 `specs/217-graph-quality-gates/contracts/graph-quality-report.schema.json` 中 `GraphFreshnessVerdict` 的定义（该 schema 当前 `additionalProperties: false`，新增字段会被严格校验拒绝）及其配套契约测试；`state` 枚举本身不新增值。`[必须]`
- **FR-010**: 图产物的 fingerprint 字段为 `undefined` 或 `null`（旧图，或来自 FR-008 描述的合法直连 API 路径但未显式写入指纹）、且 sourceCommit 判定链未先短路到 `unknown-provenance`（即 `recordedSourceCommit` 非 null/undefined，判定能走到指纹比较这一步）时，freshness 判定 MUST 归入 `stale` 状态并在 `staleReasons` 中标注 `collector-fingerprint-unrecorded`（或等价命名），MUST NOT 判为 `fresh`。理由：fingerprint 缺失说明系统无法证明该图与当前 collector 行为一致——这是保守的 fail-closed 处理（一次性迁移代价），而非对旧图"内容必然不一致"的事实断言（合法 API 直连消费者也可能产出无指纹图）。此为核心验收点：若宽松放行为 `fresh`，本需求上线前的所有存量图将系统性绕过整套机制；同时复用现有 `stale`→`warn` 消费链，使 FR-011/FR-012 的告警要求自动满足（`spectra graph` 的 `null` fingerprint 路径因 sourceCommit 亦为 `null` 而先短路到 `unknown-provenance`，不受本条影响）。`[必须]`
- **FR-011**: `graph-quality` CLI 的 `computeOverallVerdict` MUST 对"fingerprint 不一致导致的 stale"（含 FR-010 的 `collector-fingerprint-unrecorded` 与 FR-018 的 `collector-fingerprint-invalid` 情形）给出至少与"sourceCommit 不一致导致的 stale"同级或更强的告警，不得静默降级为 pass。`[必须]`
- **FR-012**: `repo:check` 第 12 族（`scripts/lib/graph-quality-core.mjs`）MUST 对"fingerprint 不一致导致的 stale"（含 FR-010 的 `collector-fingerprint-unrecorded` 与 FR-018 的 `collector-fingerprint-invalid` 情形）发出 warn 级别告警，遵循与现有 stale 状态一致的噪音哲学（FR-026——F217 spec 的 FR-026，见 `specs/217-graph-quality-gates/spec.md`：不因 dirty 而告警，但 fingerprint mismatch 是"必须重建"信号，其严重度不低于 stale）。`[必须]`
- **FR-013**: `graph-quality` CLI 的人读文本/`nextSteps`/`--json` 输出、`repo:check` 第 12 族的 warning 文案与 evidence、`graph-bootstrap-status.mjs` 的状态透传 MUST reason-aware——按 `staleReasons` 分别展示准确诊断，不得对"指纹型 stale"展示"sourceCommit 不一致"的错误文案。验收覆盖五类：source-commit mismatch / collector-fingerprint mismatch / collector-fingerprint-unrecorded / collector-fingerprint-invalid / 多原因并存（`staleReasons` 含 2 项以上）。`[必须]`
- **FR-014**: 采集面单一事实源的收敛范围 MUST NOT 纳入盘点表 #9（`file-watcher.ts` 触发面）与 #10（`import-resolver.ts` 解析层）——理由：#9 是 watch 触发器而非建图链路本身，其扩展面变化不改变已建图产物的内容；#10 是 import specifier 解析层，语义上不是"采集哪些文件"而是"如何解析已采集文件内的引用"，与 collector 采集面是不同维度的关注点。此为显式 out-of-scope 声明，非遗漏。`[必须]`
- **FR-015**: `[YAGNI-移除]` ~~System MUST 在指纹不一致时自动触发图重建~~——本迭代只负责产出可辨识的"需重建"信号，MUST NOT 实现自动重建触发逻辑；重建决策与执行交由用户/上层工作流（如 goal_loop），理由：自动重建涉及模式选择（graph-only vs full）、成本决策（LLM full 模式 ~$6/10min），不应由 freshness 判定模块单方面代为决定。
- **FR-016**: `[YAGNI-移除]` ~~System MUST 支持指纹格式的多版本兼容解析~~——本迭代不实现指纹格式的版本化协商机制；指纹以单一当前格式写入与比较，格式升级时的兼容策略留待该情形真实发生时再设计（YAGNI）。FR-001 定义的 `formatVersion` 字段仅作判别锚点，不构成解析机制。降级为 MAY：未来如需要，指纹字段结构应预留可扩展空间（已以对象而非裸字符串承载三个分量），但不实现向后兼容解析逻辑。
- **FR-017**: Collector fingerprint 的序列化 MUST 是确定性的——各管线扩展名集合排序后再序列化、匹配语义标记（如 `case-sensitive` / `case-insensitive`）作为结构化字段纳入序列化输入、不含时间戳/随机分量/平台相关路径分隔符等非确定性输入；同一输入在跨进程、跨平台重复计算时结果 MUST byte-identical。这是 fingerprint 比较语义成立的前提，也是 `--json` 输出契约稳定性的要求。`[必须]`
- **FR-018**: 图 metadata 中 `fingerprint` 字段**存在但畸形**（类型错误、缺任一必填子字段、`formatVersion` 非当前受支持值、空对象 `{}` 等结构性不合法情形）时，`evaluateFreshness` MUST 判为 `stale` 并在 `staleReasons` 中标注 `collector-fingerprint-invalid`——与 FR-010 的 `collector-fingerprint-unrecorded`（字段缺失/为 `null`）区分为不同原因，语义分别对应"没有指纹"与"指纹存在但不可信"。该判定 MUST 与其他指纹相关原因（mismatch/unrecorded）同优先级，排在 dirty 判定之前评估（沿用 FR-009 的优先级顺序）；判定过程 MUST NOT 抛出未捕获异常（结构校验失败即归类为 invalid，不向上抛错）。`[必须]`
- **FR-019**: 采集面单一事实源（FR-002 定义的多管线 `{扩展集, 匹配语义}` 权威定义）MUST 落位为**零依赖叶子模块**——仅允许依赖 Node 内建模块，MUST NOT import `batch`/`panoramic`/`adapters`/`registry` 等任何现有生产层；所有消费方（含各采集管线自身、`ignore-oracle.ts`、`cache-key-builder.ts` 代码子集、`ts-js-adapter.ts`/`module-derivation.ts`、collector fingerprint 计算模块）MUST 单向引用它，禁止该单一事实源反向落位在任一现有消费层内部。理由：`batch`↔`panoramic`、`adapters`↔`knowledge-graph` 已存在交叉引用，`ignore-oracle.ts` 现有"不 import batch-orchestrator 避免循环 + 冷启动"注释是已验证的先例约束，落位不当会重现该类循环依赖或冷启动代价问题。`[必须]`

  **[rebase 调和补记 · 2026-08-03]** 编排器授权在此外科修订 FR-019/SC-015 的 import 允许集（为集成 F248 的 `collector-extname.ts::extractExtension`），**但实施核查后判定该修订不必要，FR-019/SC-015 保持原样不修改**。理由：本 SSoT 模块的 `surfaceMatchesFile` 从未内联 `extractExtension` 那套 `lastIndexOf('.') + slice` 提取——它的 `case-sensitive` 分支直接对文件名做 `endsWith` 逐扩展比较（无提取步骤），`case-insensitive` 分支用的是 `path.extname()`，而 `path.extname` 与 `extractExtension` 是**语义不等价的两个函数**（F248 自身的合同文档明确记载差异表，并写明"通用路径处理场景应当直接用 `path.extname`，不要使用本函数"）。若按原裁决把该分支换成 `extractExtension`，纯点文件（如 `src/.go`）会从"不命中"翻转为"命中"，正是 W-004 修掉的误报 dirty 缺陷回归。因此 SSoT 内**不存在** `extractExtension` 的重复实现，无需 import 它，零依赖叶子约束（仅 `node:path`）维持不变，SC-015 的 builtins-only 断言无需扩展。

  F248 的"消除取扩展名双实现"意图仍被完整达成，且比原方案更彻底——见下方"F248 集成的实际处置"。

### 已知残余绕过面（诚实标注）

- **已封堵：moduleDerivationScan 护栏盲区**：R3 对抗审查（N-001）指出 FR-005 护栏此前仅用 graph-only 链路重建-对比，而 `moduleDerivationScan` 仅 full batch 消费，该管线的行为变更不会让 graph-only pinned 图变红；本轮修订新增 b-track module producer 探针（直接调用 `buildModuleGraphForProject`，零 LLM、纯 AST/fs 扫描，可在 vitest 内执行）后，该盲区已封堵，移出残余面。
- **人工纪律残余（修正方向）**："bump 后忘再生"由 FR-005(c) 的版本相等断言抓住（pinned `behaviorVersion` 与当前常量不等即测试红）；"再生后忘 bump"由 FR-005(e) 的再生脚本拒绝机制抓住（指纹不可见的行为变更会被脚本拦截拒绝覆写，含 fixture 基线变更同样受此纪律覆盖）。真正的残余面缩小为：**绕过再生脚本手工直接编辑 pinned 资产**（跳过脚本内置的拒绝检查），或**在脚本调用之外同时手工改动常量与 fixture**（使脚本看到的"重建 vs pinned"总是一致，检测不到语义漂移）——这两种情形均属人工纪律层面的残余，机制无法覆盖，如实标注。
- **组合变更残余面（Plan 阶段审查 P11 新增登记）**：同一提交同时修改 `extensionSurface` 与未 bump 的行为逻辑时，因指纹已因扩展面变化而自动不同，FR-005(e) 的拒绝判据（依赖"指纹不变但内容变"这一充分条件）不会触发、判定链路会因"指纹已变化"而放行，此时无法判定内容变化是否全部由扩展面变化解释——属 FR-005(e) 合同本身接受的残余，如实标注，不做进一步机制封堵。该残余面同样覆盖"fixture 输入与行为逻辑同时变化"的组合场景（Plan 阶段审查第二轮补充登记）：只要 `behaviorVersion` 已显式 bump，判据同样放行，无法单独判定内容变化是否全部由 fixture 变化解释——由同一条 bump 纪律覆盖，不额外区分。
- **语义对比字段覆盖边界**：FR-005 护栏的对比口径以图的结构性内容（节点/边集合、拓扑）为准；若某次行为变更只影响非结构性字段（如置信度分数、展示用 label 等），且该字段未被判定为语义对比的关键字段，护栏可能不会变红。此边界按实际实现的对比口径如实标注，不承诺覆盖全部字段维度。
- **fixture 覆盖边界**：FR-005 的入库 fixture 是小型样本，未覆盖的语法结构或降级路径（如某些边缘语法、异常兜底分支）的行为变更不在该护栏的检出范围内。SC-010 的自动化验收（比较器灵敏度证明 + 真实重建绿路径证明 + 拒绝纯函数真值表）不试图扩大这一边界，由本条兜底如实标注。
- **人工纪律残余（新增如实登记）**：full batch 主链中 LLM 依赖阶段（如语义抽取、doc-graph 构建等非纯 AST 行为）无法 hermetic 化接入 FR-005 的双轨护栏（护栏的两轨均限定为纯 AST/fs 扫描、零 LLM 的可重复产出），该类阶段自身的行为变更仍完全依赖维护者的人工 bump 纪律，机制无法覆盖，如实标注为残余面。

### 兼容性边界

本机制的向后兼容保护是**单向的**：只保护"新 consumer 读旧图"（旧图缺 fingerprint → 新 consumer 走 FR-010 的诚实降级路径，不误判 fresh）。"旧 consumer（pre-F249 版本的 Spectra 或依赖其 schema 的下游工具）读新图"**不受保护**——若用户回滚到 F249 之前的 Spectra 版本，旧版本的判定逻辑不认识 `fingerprint`/`staleReasons` 字段，会忽略它们并按旧逻辑判定（可能误判 `fresh`）。本迭代不引入"最低 consumer 版本"声明机制来保护回滚场景，这与 Out of Scope 中排除 schema bump 方案的理由一致（回滚保护若要做，需要类似 schema 双边界的强制拒绝机制，代价与收益的权衡属于另一议题）；若未来确有保护回滚场景的需求，应作为重新评估 schema bump 方案的触发条件单独提出，不在本迭代范围内。

### Key Entities

- **CollectorFingerprint**：图产物 metadata 中的新增字段，结构化对象，含 `formatVersion`（固定 `1`）、`extensionSurface`（按采集管线 `tsjsSkeletonWalk` / `pyWalk` / `pythonSymbolScan` / `genericAdapters` / `moduleDerivationScan` 分别记录 `{扩展集, 匹配语义}` 的自动推导摘要）、`behaviorVersion`（显式版本标识）；与 `sourceCommit` 同级、可选、遵循相同的 provenance 诚实降级哲学。该字段的畸形判定（见 FR-018）作为独立于"缺失"的第三类判别原因 `collector-fingerprint-invalid`。（W-002 实现期补记，2026-08-03）
- **GraphFreshnessVerdict（扩展）**：现有四态判定结果结构，新增可选 `staleReasons: string[]` 判别字段以区分 `stale` 状态下的多种原因（`source-commit` / `collector-fingerprint` / `collector-fingerprint-unrecorded` / `collector-fingerprint-invalid`，可并存，数组顺序确定性）；`state` 枚举本身不变；该扩展需同步升级 `graph-quality-report.schema.json` 契约定义。
- **采集面单一事实源**：由本需求新建或重构收敛出的权威定义，按采集管线（非扁平合并）暴露各自的 `{扩展集, 匹配语义}`；现有 `getDirtySourceExtensions()`（盘点表 #4）、`ignore-oracle.ts`（#5）、`cache-key-builder.ts` 代码子集（#6）收敛后改为引用它，而非各自声明；`ts-js-adapter.ts`（#7）与 `module-derivation.ts`（#8）收敛为对同一份 `moduleDerivationScan` 定义的引用。该定义模块本身 MUST 是零依赖叶子模块（FR-019），仅所有消费方单向引用，不得落位在任一现有消费层内部。`moduleDerivationScan`（#7/#8）匹配语义为大小写不敏感（经 `file-scanner.ts` walkDir `extname().toLowerCase()`），与 Java/Go adapter（#3）同属大小写不敏感一族，区别于 TSJS skeleton walk（#1）与 PY walk（#2）的大小写敏感语义。
- **重建-对比护栏 fixture**：本需求新增的入库资产，含 hermetic 多语言源码样本、**两份** pinned 期望资产（graph-only 期望图 + 期望 module graph，均含指纹）、**双轨**（a-track graph-only 重建对比 + b-track module producer 直接探针）vitest 护栏测试、再生脚本（同时产出两份 pinned 资产，内置指纹不可见行为变更时对任一轨的拒绝机制，见 FR-005(e)），作为 `behaviorVersion` bump 纪律的可验证软提示机制。

## 复杂度评估（供 GATE_DESIGN 审查）

- **组件总数**：4——(1) CollectorFingerprint 计算模块（三分量结构，跨 5 条采集管线（tsjsSkeletonWalk/pyWalk/pythonSymbolScan/genericAdapters/moduleDerivationScan），新增畸形指纹判别分支 `collector-fingerprint-invalid`，见 FR-018）；(2) 采集面单一事实源收敛（#1/#2/#3/#6代码子集/#7/#8 六处引用改造，R2 复审后追加零依赖叶子模块落位约束，见 FR-019；R3 追加 #4/#5/#6 结构引用断言与 import 边界静态 oracle，见 SC-005/SC-015）；(3) **双轨**重建-对比护栏（a-track graph-only 链路重建对比 + b-track module producer 直接探针；fixture + **两份** pinned 期望资产（graph-only 期望图 + module graph）+ vitest 双轨测试 + 再生脚本，再生脚本内置对任一轨的拒绝机制，见 FR-005(e)，R3 由单轨升级为双轨以封堵 moduleDerivationScan 护栏盲区，全新交付物）；(4) reason-aware 传播改造（CLI/repo:check/bootstrap-status 三处消费方文案与结构，新增 invalid 类文案分支）——四项组件内部分支均因三轮复审增厚，但未产生第 5 个独立组件，仍落在 MEDIUM 区间（3-5）。（W-002 实现期补记，2026-08-03）
- **接口数量**：8——`computeCollectorFingerprint()`（新函数，公开导出，内含 invalid 结构校验分支）、`evaluateFreshness()` 签名扩展+判定优先级重排（含 `collector-fingerprint-invalid` 归类逻辑）、`GraphFreshnessVerdict` 类型新增 `staleReasons` 字段（枚举含 invalid 值）、`graph-quality-report.schema.json` 契约升级、`graph-quality-core.mjs` 告警逻辑分支扩展、`graph-bootstrap-status.mjs` 状态透传扩展、采集面单一事实源的多管线访问器 API（新增零依赖叶子模块落位约束，FR-019）、`behaviorVersion` 常量与 bump 责任**结构化导出**（R3 由"注释合同"升级为机器可读常量数组 `BEHAVIOR_VERSION_BUMP_RESPONSIBILITIES`，仍是同一接口的内部结构增强，不计为新接口）——b-track 探针复用既有导出的 `buildModuleGraphForProject`（非新增接口），故接口数不因双轨扩充而增加，复核后仍为 8，落在 MEDIUM 区间上沿。
- **依赖新引入数**：0（沿用 `node:crypto` 内建，无新增外部依赖，符合 constitution X）。
- **跨模块耦合**：是——预计影响文件 **~30**（plan 阶段实测校准为 32，见 plan.md Impact Assessment 与 Scale/Scope；此处沿用 spec 立项阶段惯用的近似量级表述，精确数字以 plan.md 为准）。在原 spec 立项阶段估算的 ~20-24 基础上，主因是 plan 阶段两轮审查回写新增的护栏机制强化文件（第一轮 6 个：`package.json`、`src/panoramic/graph/index.ts`、`scripts/lib/collector-fingerprint-regen-predicate.mjs`、`tests/helpers/bootstrap-guardrail-registry.ts`、`tests/unit/collector-fingerprint-regen-predicate.test.ts`、`tests/integration/collector-fingerprint-regen-script.test.ts`；第二轮再增 2 个：`tests/helpers/pinned-asset-loader.ts`、`tests/unit/pinned-asset-swap.test.ts`）；具体列表见 plan.md Project Structure 一节。
- **复杂度信号**：无递归结构、无状态机、无并发控制、无数据迁移（fingerprint 是纯可选新增字段，不触发图自身 schemaVersion bump 或数据迁移；`graph-quality-report.schema.json` 升级是新增可选字段，非破坏性迁移；再生脚本的拒绝机制是纯条件判断，非状态机；双轨探针是两次独立、无状态的重建-对比调用，非并发控制）。
- **总体复杂度**：**MEDIUM**（组件数 4、接口数 8 均落在 MEDIUM 区间；R3 将护栏由单轨升级为双轨、新增 pinned module graph 资产，均折叠进既有组件 (3) 与接口列表内部，未产生新组件或新接口，未跨越 HIGH 阈值；跨模块耦合面因三轮对抗审查诚实化持续扩大，但未触及 HIGH 判定阈值）。
- **实现风险等级**：**HIGH**（plan 阶段依据 Impact Assessment 判定：影响文件数 ~30-32 > 20 阈值，且修改公共契约 `graph-quality-report.schema.json`，两条独立触发条件均命中 HIGH）。这与本节判定的 MEDIUM **复杂度**（组件数/接口数维度）是两个不同评估维度，不冲突——复杂度评估回答"这个需求本身概念上复杂吗"，风险等级回答"这次改动的影响面与失败代价有多大"。HIGH 风险已按 Constitution 强制分阶段要求拆分为 5 个可独立验证 Phase（见 plan.md「实施顺序」）。
- **审查轮次记录**：spec 层面共四轮 Codex 对抗审查（specify 阶段 R1/R2/R3 + plan 阶段两轮回写）；plan 层面三轮 Codex 对抗审查（第一轮 7 CRITICAL + 9 WARNING + 3 INFO 全处置；第二轮打回后全处置；第三轮记账级修订全处置，见 plan.md 头部三轮回写说明）。
- **scope 决策维持**：仍维持 story 模式而非升级为 feature，理由不变——三轮复审的范围扩张（moduleDerivationScan 语义修正、护栏拒绝机制、invalid 路径、单一事实源落位约束、双轨护栏、结构 oracle 补全、SC 可执行性强化）以及 plan 阶段两轮审查回写（判据方向性调整、验收形态校准、写盘方案调整）均是对同一需求的进一步诚实化与漏洞封堵，不引入新目标或新用户价值维度，不构成需要重新走 feature 立项的范围膨胀；HIGH 实现风险是"改动谨慎程度"要求的提升（需要分阶段、需要更强验证证据），不等同于"需求范围/立项形态"需要升级。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 用模拟 F242 式行为变更场景验证——同一源码 commit、工作树干净，仅 bump `behaviorVersion` 分量常量后重新建图，新图的 fingerprint 与旧图不同；用旧图对新版本运行 freshness 判定，结果非 `fresh`。
- **SC-002**: 用模拟未来采集面扩展场景验证——在单一事实源中新增一个扩展名后（不改动 `behaviorVersion` 分量），重新计算 fingerprint，对应管线的 `extensionSurface` 子分量自动变化；用扩展前的图对扩展后的版本运行 freshness 判定，结果非 `fresh`。
- **SC-003**: 限定样本为"`recordedSourceCommit` 与当前 HEAD 均非空、且判定链未在 FR-009 (1)(2) 步短路"——该样本集中，fingerprint 字段为 `undefined` 的存量旧图 100% 判为 `stale` + `staleReasons` 含 `collector-fingerprint-unrecorded`，不判 `fresh`，且不产生任何未捕获异常。
- **SC-003b**（回归断言）：`recordedSourceCommit` 缺失（`null`/`undefined`）的旧图，无论 fingerprint 是否存在，仍 100% 判为 `unknown-provenance`（现状语义不变，未被指纹判定绕过或覆盖）。
- **SC-003c**（异常组合样本，Edge Case 交叉覆盖）：构造"fingerprint 为 `null` 且 `recordedSourceCommit` 非 `null`"这一类型上可表示但语义异常的组合样本（非 `spectra graph` 正常路径产出），验证判定结果按 FR-010 归入 `collector-fingerprint-unrecorded` 路径处理，MUST NOT 判为 `fresh`，且不抛未捕获异常。
- **SC-004**: 一致场景零误报——fingerprint、sourceCommit 均一致且工作树干净时，freshness 判定结果为 `fresh` 的比例为 100%（不因引入新机制而对未变化场景产生误报）。
- **SC-005**: 采集面单一事实源收敛验收采用双重 oracle，缺一不可，且按落位形态分两类：(a1) **公开 seam 处运行时引用同一性**——对以公开 seam 形式对外暴露、可被消费方从外部持有引用的落点，断言消费方运行时实际持有的引用与事实源导出对象同一性（`===`）：覆盖 #7 `ts-js-adapter.ts` extensions 字段（class 实例字段，外部可读取 `.extensions` 与 SSoT 常量做 `===` 断言）、#4 `DIRTY_SOURCE_SURFACES` re-export 本身（公开导出常量，可从测试直接 import 并与其源常量 `ALL_PRODUCER_SURFACES` 做 `===` 断言）、**#3** `JavaLanguageAdapter`/`GoLanguageAdapter` extensions 字段（class 实例字段，外部可读取 `new JavaLanguageAdapter().extensions` 与 `JAVA_ADAPTER_SURFACE.extensions` 做 `===` 断言，`GoLanguageAdapter`/`GO_ADAPTER_SURFACE` 同理——Plan 阶段审查第三轮回写补齐，此前 a1 清单仅显式列举 #4/#7）；(a2) **私有函数管线/无公开 seam 落点处 AST import + 无本地字面量重声明 oracle**——对内部私有函数消费、或消费值被赋给函数内部局部变量而不构成可从外部持有的公开 seam 的落点（无法暴露 `===` 引用），用静态 AST 解析消费文件的 import 声明，断言其确实 import 了对应单一事实源 symbol，**且**文件内不存在本地扩展名字面量集合重声明（如残留 `'.ts'`/`'.py'` 等字面量数组/Set 声明）：覆盖 #1 `walkTsJsFiles`、#2 `walkPyFiles`、#5 `ignore-oracle.ts`、#6 `cache-key-builder.ts` 代码子集、**#4 `source-commit.ts` 内部消费 `DIRTY_SOURCE_SURFACES` 的谓词函数**（该消费点是私有函数内部引用，需额外 AST 校验，与上方 (a1) 对 `DIRTY_SOURCE_SURFACES` 导出本身的 `===` 断言构成双重覆盖，缺一不可——Plan 阶段审查第二轮校准，#4 由单一 oracle 升级为双重 oracle）、**#8 `module-derivation.ts` fallback**（该值在 fallback 分支内被赋给函数局部变量后使用，不构成外部可持有的运行时 seam，故不适用 `===` 断言，改用 AST oracle——Plan 阶段审查第二轮校准，由 (a1) 名单移正到此处）；(a1)/(a2) 合计覆盖盘点表 #1/#2/#3/#4/#5/#6/#7/#8，确保各消费方直接持有事实源导出的引用或经静态验证的 import 关系，而非自制拷贝，失败模式必须是"引用/import 关系断裂"（如误删导入），而非"手工同步的两份定义碰巧不一致"；#4 的行为面已由 SC-008 的 dirty 判定探针覆盖，此处补的是结构/静态引用面，二者不重复；(b) **行为探针（与 a1/a2 互补，非替代）**——每条管线在临时目录放置覆盖各扩展名+大小写变体的样本文件，实跑该管线的 walk/scan 逻辑，断言采集结果与事实源声明面精确一致，用以抓住"结构引用/AST import 校验通过但运行时行为未真正对齐事实源"的假绿；对 #8 fallback 分支（registry 为空场景）**MUST** 单独覆盖此行为探针（因该落点不适用 `===` 断言，行为探针是其除 AST oracle 外唯一的运行时保真验证）。
- **SC-006**: `graph-quality` CLI 与 `repo:check` 第 12 族对"fingerprint mismatch 型 stale"（含 `collector-fingerprint-unrecorded`、`collector-fingerprint-invalid`）的告警级别，经人工审查确认不低于"sourceCommit mismatch 型 stale"（FR-011/FR-012 的可验证落地）。
- **SC-007**（C-006 反例场景）：构造"commit 一致 + fingerprint mismatch + 工作树存在未提交改动"的组合样本，验证判定结果为 `stale`（`staleReasons` 含 collector-fingerprint 相关原因），而非被误判为 `dirty`；同一样本重复运行多次，验证 `staleReasons` 数组元素顺序保持确定性（不因执行顺序或对象键遍历顺序而波动）。
- **SC-008**（漏报修复验收）：收敛后，构造"仅新增未提交 `.pyi` 文件改动"、"仅新增未提交大小写变体（如 `Foo.JAVA`）改动"、"仅新增未提交 module 派生扫描大小写变体（如 `foo.MJS`）改动"三类样本，均 100% 触发 dirty 判定（对应修复 `codebase-context.md` #2/#3 已证实漏报，以及 R2 复审确认 `moduleDerivationScan` 大小写不敏感语义纳入后的并集覆盖）；注：dirty 过滤面的收敛结果是四管线扩展面按各自匹配语义分别判定后的并集，`.MJS` 命中 `moduleDerivationScan` 的大小写不敏感语义而触发。
- **SC-009**（reason-aware 覆盖验收）：分别构造 source-commit mismatch / collector-fingerprint mismatch / collector-fingerprint-unrecorded / collector-fingerprint-invalid / 多原因并存五类样本，验证 CLI 文本、`--json`、repo:check warning、bootstrap-status 四个消费面输出的诊断文案均准确对应实际原因，不出现"指纹型问题展示成 sourceCommit 诊断文本"的错配；多原因并存的样本重复运行多次，验证 `staleReasons` 数组顺序确定性一致（同一输入产出同一顺序），确保下游文案渲染不因顺序抖动而产生不一致展示。
- **SC-010**（护栏自证，双轨两段验收，Plan 阶段审查第二轮校准为可执行证明形态）：(a) 可执行证明形态为**三件套**（不依赖真实制造一次"行为版本变更但未 bump"的场景，而是直接对护栏机制本身的检出能力、活性与判据正确性给出自动化证明）：①**扰动注入测试**——对 a-track（graph-only 链路可感知的行为变更）与 b-track（仅 `moduleDerivationScan` 管线内、graph-only 链路本身不消费的行为变更）各自的**真实重建产物**注入语义扰动（如删一条边、改一个节点/module id），断言对应比较器**必然报不一致**——证明护栏比较器本身具备检出能力，覆盖"比较器逻辑写错、永远判一致"这类假绿；②**真实重建绿路径**——不注入扰动时，a-track/b-track 各自的真实重建产物与 pinned 期望资产比对**必然一致**，证明护栏链路处于活性状态，排除"比较器永远报不一致"的退化假阳性（与①互补，缺一不可）；③**拒绝纯函数真值表**——FR-005(e) 对应的二元拒绝判据（内容不一致 ∧ 指纹相等）2×2=4 组合真值表全覆盖。三者合计构成"该护栏本身不是形同虚设的空壳"的自动化证明；fixture 未覆盖的语法结构/降级路径的检出边界由"已知残余绕过面"中的"fixture 覆盖边界"一条兜底如实标注，不在 SC-010 内强行扩大证明范围。(b) 可演示同一场景下，若维护者尝试直接跑 FR-005(d) 的再生脚本覆写 pinned 资产，脚本必须拒绝执行并提示"先 bump behaviorVersion 再跑再生"（FR-005(e) 的拒绝机制生效，覆盖双轨任一轨触发的场景，也覆盖 fixture 基线单独变更的场景），验证"再生后忘 bump"半失效同样被机制拦截，而非仅停留在测试层面的事后检出。
- **SC-011**：batch 主链与 graph-only 两条写入路径产出的图，100% 含合法（非 undefined/null/invalid）collector fingerprint。
- **SC-012**：`spectra graph` 命令产出的图，fingerprint 字段为 `null`（对齐 F217 sourceCommit 的诚实降级先例）。
- **SC-013**：`computeCollectorFingerprint()` 以公共导出可访问——验收覆盖 API 存在性（可被外部模块 import 调用）与产出一致性（直连调用产出与 batch/graph-only 两条内部写入路径实际写入图 metadata 的指纹值 byte-identical）。
- **SC-014**：确定性验收——(a) **跨进程一致性**：spawn 两个独立 node 子进程，各自计算 collector fingerprint 并序列化，byte-identical 对比（不满足于同进程内重复计算，规避"同进程内存缓存掩盖非确定性"的假绿）；(b) 序列化形态的结构检查确认输入不含时间戳、绝对路径、平台相关路径分隔符等非确定性/平台相关内容（以结构断言落地）；真实跨平台矩阵实测仍不作硬性要求，如实标注为验收边界之外。
- **SC-015**（FR-019 静态 import 边界 oracle）：测试直接读取采集面单一事实源模块的源文件内容，静态解析其顶层 import/require 声明，断言声明的模块说明符集合 ⊆ Node 内建模块集合（如 `node:path`/`node:fs` 等，或裸内建模块名），不含任何 `batch`/`panoramic`/`adapters`/`registry` 等现有生产层路径——该断言零依赖生产层导入即可执行，是 FR-019"零依赖叶子模块"约束的直接可执行验收，独立于运行时行为探针。
- **SC-016**（FR-004 bump 责任清单结构化覆盖验收）：测试导入 `BEHAVIOR_VERSION_BUMP_RESPONSIBILITIES`（或等价命名的结构化导出）常量数组，断言其覆盖 FR-004 枚举的六类条件（ignore dirs 剪枝规则变化 / `.gitignore` 规则解释变化 / 大小写匹配策略变化 / symlink 处理策略变化 / 单文件 1MB size guard 调整 / 采集失败降级策略变化）——每一类均能在数组中找到对应项，缺失任一类即测试失败；该断言确保 bump 责任清单不因日后编辑注释而与结构化导出脱节。
- **SC-017**（currentHead 解析失败回归 oracle）：构造非 git 仓库（或 mock `git rev-parse` 失败）场景，验证 `resolveSourceCommit` 返回 `null` 后，freshness 判定 100% 归为 `unknown-provenance`——无论图产物 fingerprint 字段是否存在/缺失/畸形，该短路结果均不改变（FR-009 步骤 (2) 的直接执行断言，防止指纹判定绕过此优先级）。
- **SC-018**（schemaVersion 1.0 双边界回归 oracle）：构造 schemaVersion 为 `1.0` 的旧图 fixture（无论是否含 fingerprint 字段），验证 `graph-quality` CLI 100% 判定为 `schema-too-old`，判定链路不进入 freshness/指纹比较分支——确认本需求未改变 `MIN_SUPPORTED_SCHEMA_VERSION` 双边界的既有行为（FIX-7），该断言是 Edge Case"schemaVersion 1.0 旧 fixture"描述的可执行落地。

## Out of Scope（显式排除）

- **Schema bump 方案（图自身 2.0→2.1）**：已在代码上下文摘要 §5 论证排除——会触发 `MIN_SUPPORTED_SCHEMA_VERSION` 双边界连锁（老工具拒新图 + 新工具拒老图），且强制全量重建不区分"producer 真变了"与"仅发版"，入库 fixture 全量再生代价大、精度差。本需求延续 F217 先例，指纹作纯可选新增字段。此排除同时是"兼容性边界"小节中"回滚场景不受保护"限制的直接后果——若未来需要保护该场景，需重新单独评估 schema bump 方案，不在本迭代内。
- **Expected-module-set 校验方案**：已在代码上下文摘要 §5 论证排除——只能检出"采集面扩展"类失效，检不出 F242 这类"module 集合不变、边集变"的行为变更；且需要额外镜像 gitignore/ignore-dirs 剪枝逻辑，构成新的镜像，与本需求的收敛目标背道而驰。
- **采集面单一事实源收敛的完整范围**（盘点表 #9-#10）：见 FR-014，本迭代收敛 #1-#3、#6 代码子集、#7-#8；#9 watch 触发面与 #10 import 解析层显式排除在本迭代之外（理由见 FR-014）。
- **自动触发图重建**（FR-015）、**指纹格式多版本兼容解析**（FR-016）：均按 YAGNI 原则移除。
- **Rename-follow / 全仓推断**：M10 议题，与本需求无关，不掺入。
