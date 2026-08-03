# 问题修复报告

## 问题描述

重跑 collector-surface 同族深收敛批次（F249 no-op 收口 fd5ecef 的登记后续）。原批次三项在姊妹 F243（重编号 F249，68eb7e5）合入 master 前无可改对象；现 SSoT（`src/collector-surface.ts` + `src/panoramic/graph/collector-fingerprint.ts`）已落 master，按合并后形态重新诊断三项：

1. **ignore-oracle 分派语义化**：忽略集分派改为把整文件名交给 `surfaceMatchesFile` 按各管线 `matchSemantics` 判定，替代"先提取扩展名再逐 surface 比对"；
2. **producer matcher 收敛**：`generic-language-skeleton-collector.ts` 两处 + `file-scanner.ts` 一处 `path.extname().toLowerCase()` 改为消费 collector-surface 公共 matcher；
3. **类型谓词收紧**：`isValidCollectorFingerprint` 由 `value is CollectorFingerprint` 改 boolean 返回，强制调用方经 `parseCollectorFingerprint` 消费 snapshot，清理 guardrail 测试的 `as never`。

前提复核（2026-08-03 会话内实测）：F249 已在 master（当前 HEAD=68eb7e5，零落后）；并行会话 task_a1d4081f（generic collector 大小写预存缺口）**未落 master**（`generic-language-skeleton-collector.ts` 在 master 最近改动停在 F217 的 0f72d4a），第 2 项无撞车、无需缩范围。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 三处结构性失真为何在 F249 SSoT 落地后仍残留？ | F249 rebase 调和采取保守最小改动：ignore-oracle 只把镜像常量换成 SSoT 判定（`extractExtension` + `surfaceHasExtension`），未升级到 W-004 的 `surfaceMatchesFile` 合同；其注释甚至以"手上只有扩展名的分派型消费方"自我辩护——但 `ignoreDirsForPath(relativePath)` 手上明明有完整文件路径 |
| Why 2 | producer 侧三处 matcher 为何未收敛？ | F249 的 SSoT 设计把生产者实现定位为**记账对象**（如实镜像），改生产者实现被显式挡在 scope 外（实现审查 W-003 登记 follow-up）——避免同一 Feature 里既立事实源又改生产行为 |
| Why 3 | `isValidCollectorFingerprint` 为何保留类型谓词？ | FR-018 只要求布尔投影存在；W-005 反模式防线落在注释合同层（"MUST 用 parse 消费 snapshot"），类型层封堵牵连 `pinned-asset-loader` 迁移，当时未纳入 |
| Why 4 | 这些残留为何会系统性形成？ | SSoT 收敛类工程的固有分期：先立事实源 + 消费方数据收敛（F249），语义/实现单点化留给登记批次；该批次因撞号双胞与 premature 基座两度顺延（fd5ecef no-op 收口）至本次 |
| Why 5 | 为何无机制自动捕获？ | 行为探针（`collector-surface.test.ts`）只钉"面的内容"，不钉"消费方是否用对函数"；W-004/W-005 合同是注释级约定，类型系统未参与——第 3 项正是把 W-005 防线从注释层升级到类型层 |

**Root Cause**: SSoT 收敛工程的分期残留——F249 完成"立源 + 数据收敛"，语义单点化（W-004 matcher 合同、W-005 类型封堵）按设计留给本批次，非缺陷性遗漏。
**Root Cause Chain**: 三处失真残留 → F249 rebase 保守调和 → 生产者实现挡在 F249 scope 外 → 类型封堵牵连未纳入 → SSoT 分期工程 + 撞号/premature 两度顺延 → 注释级合同无自动守护。

## 影响范围扫描

### 同源问题（需同步修复，登记范围内）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `src/panoramic/graph/quality/ignore-oracle.ts` | L136-143 | `extractExtension` + `surfaceHasExtension` 四连分派（提取式） | 改 `surfaceMatchesFile(surface, relativePath)` 四连；删 `extractExtension`/`surfaceHasExtension` import；注释按 W-004 合同重写 |
| `src/batch/generic-language-skeleton-collector.ts` | L48（resolveAdapterForFile） | `path.extname(filePath).toLowerCase()` + `adapter.extensions.has` | per-adapter 构造 `CollectorPipelineSurface`（case-insensitive）+ `surfaceMatchesFile` |
| `src/batch/generic-language-skeleton-collector.ts` | L86（walkFiles） | `path.extname(entry.name).toLowerCase()` + 并集 `extensions.has` | 并集 surface + `surfaceMatchesFile` |
| `src/utils/file-scanner.ts` | L298-299（walkDir） | `path.extname(entry.name).toLowerCase()` + `supportedExtensions.has` | 判定行改 `surfaceMatchesFile`；`ext` 变量**保留**（L308/L315/L322 languageStats/unsupported 统计仍需） |
| `src/panoramic/graph/collector-fingerprint.ts` | L331 | `value is CollectorFingerprint` 类型谓词 | 改 `boolean` 返回；注释同步 |
| `tests/helpers/pinned-asset-loader.ts` | L101 | **唯一依赖谓词收窄的调用方**（`if (!isValid...) throw` 后拿原对象当 `CollectorFingerprint` 返回） | 迁 `parseCollectorFingerprint`，返回 parse 出的 snapshot（还额外获得"外部 JSON 防御性拷贝"收益） |
| `tests/unit/guardrail/collector-fingerprint-guardrail.test.ts` | L142 | `fingerprintsEqual(pinnedFingerprint as never, ...)` | 经 `parseCollectorFingerprint` 拿 snapshot 断言非 null 后传入，删 `as never` |

### 派生清理（同源修复的自然完成）

| 文件 | 判定 | 依据 |
|------|------|------|
| `src/panoramic/graph/collector-extname.ts` + `collector-extname.test.ts` | **删除** | `source-commit.ts` 已于 F249 完全迁移 `surfaceMatchesFile`（L68，注释明言"连 `extractExtension` 也不需要 import"）；第 1 项迁移后 `extractExtension` 零生产消费方（全仓 grep 确认仅 ignore-oracle import + 自身测试）。F248"禁止替换为 `path.extname`"合同保护的行为（纯点 `.ts` 命中 TSJS 面）由 `surfaceMatchesFile` 的 case-sensitive `endsWith` 分支继续保证——本次是"消灭提取步骤"（source-commit 注释已合法化的演化路径），不是被禁止的"替换提取实现"。语义差异表知识已在 `collector-surface.ts` 的 `ExtensionMatchSemantics`/`surfaceMatchesFile` 注释中完整承接 |
| `src/panoramic/graph/source-commit.ts` L61-64 注释 | 小幅措辞 | 提及 collector-extname.ts 的历史叙述在文件删除后需改为"（已随 F252 退役）"级别的措辞，历史事实不变 |
| `src/collector-surface.ts` L161 注释 | 同步 | `surfaceHasExtension` 的适用例"如 ignore-oracle.ts 按扩展名选忽略目录集合"在迁移后失效，需换例或改述（该函数迁移后**零生产消费方**，但它是 SSoT 公共 API 面的合法组成 + 指纹/测试消费，保留函数本体） |

### 类似模式（已评估，范围外不动）

| 文件 | 位置 | 评估结果 |
|------|------|----------|
| `src/adapters/ts-js-adapter.ts` | L77 | [安全] 用途是"按扩展名选 tree-sitter 语言（.js/.jsx→javascript）"，非采集面匹配判定，属"通用路径处理直接用 path.extname"的合法用法 |
| `src/panoramic/cache/cache-key-builder.ts` | L88 | [安全-记录] 数据已引用 SSoT（`...TSJS_SKELETON_WALK_SURFACE.extensions` + 缓存专属 `.json/.md/...`），匹配语义是缓存失效启发式（比采集面宽、多算 dirty 无害），非采集面判定 |
| `src/adapters/language-adapter-registry.ts` | L87 | [类似-范围外] registry.getAdapter 按 ext 分派 adapter，与 resolveAdapterForFile 同族；但 registry 是跨语言通用分派器（含非采集场景消费方），收敛需单独评估声明面归一化，属 task_a1d4081f（大小写缺口）同域——**不动，避免撞车** |
| tree-sitter/watcher/parser-registry/content-hasher/api-surface/openapi/config-reference/directory-graph/debt-scanner/image-extractor/artifact-classifier 等 | 各处 | [安全] 均为通用文件类型判断（展示/降级/产物分类），非图采集面判定 |

### 同步更新清单

- 调用方：`ignoreDirsForPath` 无外部调用方（模块私有）；`walkDir` 签名改动仅涉两处站内调用（L295 递归 + L382 scanFiles）；`resolveAdapterForFile` 仅主函数一处调用
- 测试：新增 ignore-oracle 纯点文件分派测试（行为变化钉住）；guardrail `as never` 清理；`collector-extname.test.ts` 随模块删除；其余现有测试守护行为保真
- 文档：无独立文档需更新（注释层同步见上表）

## 修复策略

### 方案 A（推荐）：三项一次收敛 + 派生死代码清理

1. **第 1 项**（行为微变，向生产者真实行为对齐）：`ignoreDirsForPath` 四个 `surfaceHasExtension(surface, ext)` → `surfaceMatchesFile(surface, relativePath)`。**行为变化点（有意收敛，测试钉住）**：case-insensitive 族纯点文件（basename `.go`/`.java`/`.JAVA` 等）从"误分派语言忽略集"改为 union 兜底——generic collector 的 `path.extname` 本就不采集纯点文件（`path.extname('.go')===''`），误分派是 W-004 型形态失真；case-sensitive 族（TSJS/PY）在"extractExtension+精确 has"与"endsWith"间**严格等价**（对每个扩展 e：提取子串 === e ⟺ endsWith(e)），零行为变化。
2. **第 2 项**（零行为变化的结构收敛）：三处 matcher 改为"调用方构造 `CollectorPipelineSurface`（数据来自 adapter/registry 聚合，`matchSemantics: 'case-insensitive'` 显式化既有事实）+ `surfaceMatchesFile` 判定"。`surfaceMatchesFile` case-insensitive 分支与三处现状**逐字等价**（`extensions.has(path.extname(x).toLowerCase())`）；大小写预存缺口（adapter 声明大写时失配）**原样保留**——那是 task_a1d4081f 的领域，本次不修不碰，收敛后其未来修复点更集中。
3. **第 3 项**（类型层封堵）：签名改 boolean；`pinned-asset-loader` 迁 parse（唯一收窄依赖方）；guardrail 测试 parse 后传 snapshot 删 `as never`。生产代码零调用（grep 确认仅 barrel re-export），全部测试断言均为布尔用法不受影响。
4. **派生清理**：删除 `collector-extname.ts` + 其测试（零消费方死代码；仓规"删除死代码"+零基思维）；同步 source-commit/collector-surface 注释。

### 方案 B（备选）：仅做第 1、3 项，producer 侧等 task_a1d4081f

被否：任务明确三项一起；且第 2 项收敛后 task_a1d4081f 的语义修复点从三处散点集中为 SSoT 单点，先收敛反而降低撞车面。

## Spec 影响

- 需要更新的 spec：**无需更新**。F249 的 `specs/249-graph-collector-fingerprint/` 如实记录了当时的 scope 裁决（W-003/W-004/W-005 follow-up 登记），本批次落地即闭环，历史文档不改写；本批次制品自有 `specs/252-fix-surface-convergence-batch/`。

## BEHAVIOR_VERSION 裁决（对抗复审 W3 处置）

`BEHAVIOR_VERSION`（`src/panoramic/graph/collector-fingerprint.ts` L82，当前 = 1）的 bump 责任范围由同文件的 `BEHAVIOR_VERSION_BUMP_RESPONSIBILITIES` 六条款权威定义。本批次触及其中两条，逐条裁决如下；其余四条（`gitignore-interpretation` / `symlink-handling` / `file-size-guard` / `collection-failure-degradation`）本批次零触及，不展开。

### 条款 `ignore-dirs-pruning`

> "增删被跳过的目录名、或改变剪枝时机（如从『进入后过滤』改为『遍历前剪枝』），都会改变被采集的文件集合"

| 判据 | 事实 | 结论 |
|------|------|------|
| 是否增删目录名 | `GRAPH_COLLECTOR_IGNORE_DIRS` / `TSJS_IGNORE_DIRS` / `PY_IGNORE_DIRS` / `GENERIC_UNIVERSAL_IGNORE_DIRS` 四个集合字面量本批次零改动；`javaIgnoreDirs()` / `goIgnoreDirs()` 仍取各 adapter 的 `defaultIgnoreDirs` ∪ 通用集合，adapter 侧未动 | 否 |
| 是否改变剪枝时机 | `createIgnoreOracle` 的 gitignore-first + 目录段 `some` 判定顺序未动；`walkFiles` 的 dotdir 跳过 → adapterIgnoreDirs 跳过 → `isIgnored` 跳过三级顺序未动 | 否 |
| 分派值是否变化 | 变化面**已完全枚举为两类**（见 `ignore-oracle.ts::ignoreDirsForPath` 注释）：① 纯 dotfile basename、② 尾随分隔符路径。两类均在语言专属集合 ⇄ union 兜底之间双向移动 | 是，但见下行 |
| 被采集文件集合是否变化 | 两类形态在全部消费方不可达：generic collector `walkFiles` 中，目录项被 `entry.name.startsWith('.')` 前置跳过、文件项被 `surfaceMatchesFile` 扩展面挡下，**均在调用 `isIgnored` 之前 return**；relativePath 由 `path.relative(path.join(...))` 构造且 `entry.name` 不含分隔符，结构上不产出尾随分隔符。图质量门 `legacy-ignored-check.ts` 的输入是图节点 id 的 filePart，由上述采集器产出，同样不含这两类形态 | 否 |

**裁决：不 bump。** 条款守护的是"被采集的文件集合"，该集合在本批次前后逐文件相同；分派值的两类分歧是不可达路径上的内部差异，不构成让既有图作废的语义变化。两类分歧已由 `ignore-oracle.test.ts` 的 5 条用例双向钉住（`vendor/.go` / `.gradle/.java` 判 false，`tmp/.java` 判 true，`vendor/f.go/` 判 true，`vendor/foo.go` 判 true），未来任一侧漂移会变红。

### 条款 `case-matching-strategy`

> "某条管线从大小写敏感改为不敏感（或反向）。扩展名集合本身的增删由 extensionSurface 自动反映，但匹配语义的实现口径变化需在此声明"

| 判据 | 事实 | 结论 |
|------|------|------|
| 六条管线的 `matchSemantics` 是否翻转 | `ALL_PRODUCER_SURFACES` 六条 surface 的 `matchSemantics` 声明本批次零改动（`src/collector-surface.ts` 的 diff 仅涉注释） | 否 |
| 三处 producer matcher 收敛是否等价 | 三处原实现均为 `extensions.has(path.extname(x).toLowerCase())`；`surfaceMatchesFile` 的 case-insensitive 分支实现是 `surface.extensions.has(path.extname(filePathOrName).toLowerCase())` —— **逐字等价**。`resolveAdapterForFile` 由"循环外算一次 ext"改为"逐 adapter 调用"，仅多算 extname，判定结果恒同 | 是（等价） |
| `file-scanner.ts` 统计口径是否漂移 | 判定行改 `surfaceMatchesFile`，`ext` 变量保留供 `languageStats` / `unsupported` 分组（L308/L315/L322）；两个口径当前同解 | 否 |
| ignore-oracle 分派是否属"管线匹配语义" | ignore-oracle 是分派器/质量门而非采集管线；它改为按各管线自身 `matchSemantics` 求值，方向是**向生产者真实行为收敛**，不是任一管线自身语义翻转 | 否 |

**裁决：不 bump。**

### 总裁决

**`BEHAVIOR_VERSION` 维持 1**，不因本批次 bump。两条相关条款均不满足触发判据：无目录名增删、无剪枝时机变化、无管线大小写语义翻转、被采集文件集合逐文件不变。

## 对抗复审处置记录（内部复审代 Codex，配额 08-08 恢复）

Codex 周配额耗尽，本轮以内部对抗复审替代（同"找漏洞、假设改动有问题、尝试证伪"视角）。结论汇总：**0 CRITICAL / 3 WARNING / 6 INFO**。

### WARNING（本轮全部处置）

| ID | 发现 | 处置 |
|----|------|------|
| W1 | 第二类分歧遗漏：`path.extname('f.go/') === '.go'`（剥尾随分隔符）而旧 `extractExtension('f.go/') === '.go/'`（不剥），构成独立于纯 dotfile 的第二类行为变化面；差分实测 flip：`vendor/f.go/` OLD=false→NEW=true、`tmp/f.go/` OLD=true→NEW=false。`ignore-oracle.ts` 原注释把行为合同写窄为"唯一变化点=纯 dotfile" | **已修**：`ignoreDirsForPath` 注释块的行为合同段重写，扩正为完整两类分歧 + 不可达论证 + "新增消费方 MUST 重新评估"约束；补测试 `vendor/f.go/ → ignored` |
| W2 | 第一类分歧的方向遗漏：纯 dotfile 不止 true→false 单向——目录段在 union 内但不在该语言专属集内时**反向** flip，如 `tmp/.java` OLD=false→NEW=true（同理 `dist/.go` / `venv/.java` / `target/.go`），语义为质量门收紧方向 | **已修**：注释按"目录段落在哪个集合决定翻转方向"重述为双向；补测试 `tmp/.java → ignored` |
| W3 | fix-report 全程未评估 `BEHAVIOR_VERSION` bump 条款（`ignore-dirs-pruning` / `case-matching-strategy`），裁决停留在隐式判断，未制品化 | **已修**：新增上节《BEHAVIOR_VERSION 裁决》，逐条款过判据表并给出总裁决（不 bump，维持 1） |

W1/W2 的 flip 方向与不可达性均已在本轮**实跑验算**（新实现直跑 + 旧实现内联复刻对拍，10 条路径逐一对比），非纸面推断。两类分歧的分派移动方向互为镜像：纯 dotfile 是"专属集合 → union 兜底"，尾随分隔符是"union 兜底 → 专属集合"。

### INFO（逐条裁决，均记录不改码）

| ID | 发现 | 处置与理由 |
|----|------|-----------|
| I1 | `surfaceHasExtension` 保留而 `collector-extname.ts` 删除，去留标准不对称（两者当下都是零生产消费方） | **接受不对称**。前者是 SSoT 语义 API 的两个投影之一（与 `surfaceMatchesFile` 成对表达"扩展名维度"与"文件维度"），且被 `collector-surface.test.ts` 的两族真值表测试锚定；后者是"提取步骤内化进事实源"后的孤立残留，无 API 面地位。判据是"是否属公共语义面"，非"当前是否有消费方" |
| I2 | 三处新增的内联 `matchSemantics: 'case-insensitive'` 字面量构成第二份手写镜像（若某 adapter 未来改大小写语义，三处需手工同步） | **接受**。三处由 `collector-surface.test.ts` 的行为探针双向守护（面内命中 / 面外不命中）；把 `matchSemantics` 上提到 adapter 声明属 `task_a1d4081f`（大小写域）范围，本批次不扩面 |
| I3 | ad-hoc 构造的 surface（三处内联 + `resolveAdapterForFile` 逐 adapter）未校验 `extensions` 的"一律小写声明"不变量——adapter 若声明大写扩展名，case-insensitive 分支会静默失配 | **记录待统一处理**。与 `task_a1d4081f`（generic collector 大小写预存缺口）同域且该会话已在并行修，本批次不动以避免撞车；预存行为原样保留（见修复策略第 2 项） |
| I4 | `package.json` 的 `main` 指向不存在的文件 | **记录不动**。预存问题，与本批次零关联 |
| I5 | `file-scanner.ts` 的判定口径（`surfaceMatchesFile`）与统计口径（保留的 `ext` 变量）可独立漂移 | **接受**。两口径当前同解，注释已在保留 `ext` 的行上说明其用途边界；强行合并会牵动 `languageStats` 分组键的语义 |
| I6 | verification 报告声称的"全仓 grep"实际取证面仅 `src/` + `tests/` | **结论不变**。复审已补扫 `plugins/` `scripts/` `contracts/` `.github/` 四处，`extractExtension` / `collector-extname` 零匹配，原结论（零消费方死代码）成立 |
