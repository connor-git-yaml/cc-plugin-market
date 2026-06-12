# 问题修复报告 — Feature 182 增量缓存正确性

> 模式: spec-driver-fix（诊断阶段 Opus 5-Why）
> 来源: M7 全期架构审查 wf_a084e2f1，对抗验证证伪失败坐实
> 前置依赖: F186 npm 重发 4.3.0 必须等本 feature 修完（外部用户拿到 F175 增量前的地基）

## 问题描述

F175 引入的 batch 增量再生成链存在 4 处正确性缺陷，导致"增量永久 cache miss / 多语言重复付费 / checkpoint 进度自相矛盾 / 中断 full 静默降级"。现有 3 个 baseline（本仓 / micrograd / nanoGPT）全单语言 + 全小写文件名，且测试 helper 逐字复刻读侧 hash 公式，故 verify 全期假绿，结构上测不出分叉。

---

## 5-Why 根因追溯

### 问题 1 🔴 — skeletonHash 读写公式分叉（永久 cache miss）

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 增量第二轮为何每轮重调 LLM？ | 读侧算出的 currentHash 与写侧落盘的 skeletonHash 不相等 → delta 判 skeleton-changed |
| Why 2 | 两个 hash 为何不相等？ | 写侧 `mergeSkeletons`（single-spec-orchestrator.ts:160）按上游 `scanFiles` 的 **code-unit 排序**（file-scanner.ts:367 `files.sort()`，analyzeFiles 保持输入序）join skeleton.hash；读侧 `computeSkeletonHash`（delta-regenerator.ts:259）按 `analyzed.filePath.localeCompare` 重排后 join——**两种排序算法不同** |
| Why 3 | 顺序/输入为何会不同？ | 双重口径分叉：(a) **排序算法**——code-unit 下 `'B' < 'a'`，localeCompare（ICU）下通常 `'a' < 'B'`，混合大小写文件名（React PascalCase 组件 + camelCase 工具混排）两序相反；(b) **文件集来源**——写侧对 `resolvedTarget` 目录重扫（scanFiles 取目录**全部语言**文件），读侧用 `group.files`（language-split 后为单语言子集）→ 混语言目录即使排序一致输入集也不同 |
| Why 4 | 为何设计成两套口径？ | F175 增量是在已存在的 `generateSpec`（写侧，目录重扫）之上**旁挂**读侧快照逻辑，没有抽出单一 hash 函数；两侧各自为政，localeCompare 还引入 ICU locale 依赖（跨机不可移植） |
| Why 5 | 为何未被现有测试捕获？ | 测试 helper `computeHashFor`（delta-regenerator-mode.test.ts:256）**逐字复刻读侧公式**（localeCompare 排序），从不与写侧真实落盘路径对账 → 结构性假绿；3 个 baseline 全小写文件名，localeCompare 与扫描序恰好一致，掩盖分叉 |

**Root Cause**: 增量 hash 缺少**单一权威实现**——写侧（目录重扫全语言文件 + code-unit 序 join）与读侧（group.files 单语言子集 + localeCompare 重排 join）是两套独立合成路径，混合大小写 / 混语言下必然分叉；测试复刻读侧而非对账写侧，使分叉对 CI 不可见。

**Root Cause Chain**: 每轮重调 LLM → 读写 hash 不等 → 文件集来源 + 排序算法双重不同 → 旁挂式增量未单源化 hash → 测试复刻读侧公式假绿。

---

### 问题 2 — 混语言目录 sourceTarget 碰撞（多语言每轮双倍重生成）

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 混语言目录增量为何每轮重生成两份 spec？ | 同目录 .py + .ts 被 language-split 成两个 ModuleGroup，`resolveSourceTarget`（regen-plan.ts:106）对两组返回**同一** `dirPath` |
| Why 2 | 同一 sourceTarget 为何导致重生成？ | `storedSpecByTarget` / `regenerateTargets` 以 sourceTarget 为 Map 键 → 两组键碰撞，后写覆盖前写；delta 快照与 stored spec 的 hash 口径错位 → 永远 miss |
| Why 3 | resolveSourceTarget 为何不含语言维度？ | 函数签名 `(group, conflictingDirPaths, isRoot)` 只看 `group.dirPath` / `group.files`，`ModuleGroup.language`（module-grouper.ts:25，语言感知分组才设）未参与 sourceTarget 计算 |
| Why 4 | 设计时为何漏掉语言维度？ | sourceTarget 口径在单语言假设下成型（dirPath 唯一映射模块）；language-split 是后续多语言能力，未回头修正 sourceTarget 唯一性契约 |
| Why 5 | 为何未被测试捕获？ | 3 个 baseline 全单语言，无混语言目录 E2E；language-split 路径无"同目录双语言增量第二轮"用例 |

**Root Cause**: `resolveSourceTarget` 的唯一性契约建立在"一个 dirPath = 一个模块"的单语言假设上，language-split 打破该假设后未给 sourceTarget 补语言维度，导致同目录双语言两组键碰撞。

**边界澄清（Codex 对抗审查补充）**：
- 模块 **name** 已带语言后缀（module-grouper.ts:134 `${name}--${langId}`），spec 文件名不碰撞——只有 sourceTarget / Map 键碰撞；
- 若同目录两个语言组**均为单文件**，`conflictingDirPaths` 降级会让 sourceTarget 退化为文件路径而避开碰撞——但任一语言组含 ≥2 文件即回落 dirPath，碰撞成立（该降级不可依赖）；
- root 模块按文件级展开（delta-regenerator.ts:237 / batch-orchestrator.ts:862 已显式处理），不受此碰撞影响。

**附带**: language-split 首轮即未按语言限定分析（generateSpec 目录重扫拿到全部语言文件），双倍付费——属同根，统一在 sourceTarget 语言维度 + 文件集口径（files 注入）修复中收口。

---

### 问题 3 — checkpoint 失效重跑产生重复条目

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | resume 进度为何可超 totalModules？ | 已在 `completedModules` 的 module 被重新处理后，:907 / :950 `checkedState.completedModules.push(...)` **无条件追加**新条目，不剔旧条目 |
| Why 2 | 已完成 module 为何会被重新处理？ | checkpoint 判定（:758）`completedPaths.has(moduleName)` 命中后，若 `mustRegen=true`（本轮 delta 要求重生成该 target）则 **fall-through 不 return**，继续走生成 |
| Why 3 | fall-through 后为何不去重？ | push 逻辑假设"只在首次完成时调用"，未考虑 mustRegen 失效重跑会二次到达同一 push 点；失败路径同理 → completed / failed 双记 |
| Why 4 | 为何引入这种半幂等？ | F175 给 checkpoint 加了"增量失效重跑"语义（mustRegen），但 completedModules 仍沿用 F146 之前"append-only"写法，未配套 replace 语义 |
| Why 5 | 为何未被测试捕获？ | 无"checkpoint 命中 + mustRegen 失效重跑"的 resume 用例断言 completedModules 唯一性 |

**Root Cause**: F175 给 checkpoint 新增"失效重跑"（fall-through）语义，但 completedModules 落盘仍是 append-only，缺 replace（先剔旧条目再 push）语义 → 同一 module 双记。

---

### 问题 4 — forceRegenerate 死字段（中断 full 静默降级）

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 中断的 --full run 被增量 resume 后为何产出半新半旧混合产物？ | resume 时 `forceFullRegeneration`（:518）按**本轮** regenPlan 重算 = false（裸增量 resume），剩余模块走增量 skip，不再全量 |
| Why 2 | 为何不沿用首轮 full 意图？ | checkpoint state 里写了 `forceRegenerate: regenPlan.full`（:660），但**全仓零读取**（grep 仅 schema 定义 + 此处写入）→ 首轮 full 意图落盘了却从不消费 |
| Why 3 | 为何写了不读？ | 字段是 F175 占位/预留，runtime 实际只用本地重算的 `forceFullRegeneration`，持久化字段成 dead field |
| Why 4 | 为何报成功？ | 混合产物无完整性校验，每个模块各自成功即整体成功，无"首轮 full 未完成"信号 |
| Why 5 | 为何未被测试捕获？ | 无"full 中断 → 增量 resume"端到端用例断言降级信号 |

**Root Cause**: 首轮 `--full` 意图持久化到 checkpoint（forceRegenerate）但 runtime 从不读取，resume 按本轮 plan 重算后静默降级为增量，且无完整性信号。

**诊断阶段二选一论据见下方"修复策略 → 问题 4"。**

---

## 影响范围扫描

### 同源问题（需同步修复）
| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| src/core/single-spec-orchestrator.ts | :160 mergeSkeletons / :222 scanFiles 重扫 / :678 skeletonHash 写 | 写侧 hash 合成 + 目录重扫 | 改用共享 `computeModuleSkeletonHash`；generateSpec/prepareContext 加 `files` 注入参数替代目录重扫 |
| src/batch/delta-regenerator.ts | :259 computeSkeletonHash / :250 / :243 | 读侧 hash 合成 | 删本地 computeSkeletonHash，改调共享函数；collectCurrentSnapshots 传 group.language |
| src/batch/regen-plan.ts | :106 resolveSourceTarget | sourceTarget 计算 | 加 `group.language` 维度（`${dirPath}::${language}`），三处调用统一 |
| src/batch/batch-orchestrator.ts | :750 / :907 / :950 / :518 / :660 | checkpoint push + forceRegenerate | fall-through 时 replace 语义；forceRegenerate full-resume 语义或删字段 |

### 共享 hash 新模块
- 新增 `src/batch/skeleton-hash.ts`（或 `src/core/` 下）导出 `computeModuleSkeletonHash(projectRoot, files)`：项目相对 POSIX 路径 + 确定性 code-unit 比较器（`<` / `>` 逐字符，**非** localeCompare），写读两侧唯一来源。

### resolveSourceTarget 三处调用统一（加 group.language）
- regen-plan 自身导出 / delta-regenerator.ts:250 collectCurrentSnapshots / batch-orchestrator.ts:750 processOneModule

### 同步更新清单
- 测试: **删除** delta-regenerator-mode.test.ts:256 的 `computeHashFor` 私有复刻，改 import 共享函数；新增混合大小写 + 混语言 E2E（不得复刻实现公式合成 fixture）
- 文档: release note 标注"hash 公式变更一次性失效全部存量 skeletonHash → 触发一轮全量"
- 类型: ModuleGroup.language 已存在，无需新增

## 修复策略

### 问题 1（推荐方案 A）
抽 `computeModuleSkeletonHash(projectRoot, files)` 为唯一权威实现：(1) 文件集统一以传入 `files`（写侧由 group.files 注入，不再目录重扫）；(2) 路径归一化为项目相对 POSIX；(3) 排序用确定性 code-unit 比较器（逐 charCode），剔除 localeCompare 的 ICU locale 依赖。写侧 `prepareContext`/`generateSpec` 新增可选 `files` 参数：batch 路径注入 group.files，单文件 generate 不传时退回现有 scanFiles（保持 CLI 单文件行为）。

### 问题 2
`resolveSourceTarget` 读 `group.language`：**仅多语言拆分组**（同 dirPath 存在 ≥2 语言组，即 name 带 `--${langId}` 后缀的组）返回 `${dirPath}::${language}`，单语言目录维持纯 dirPath（最小化存量失效面）。三处调用统一（regen-plan / delta collectCurrentSnapshots / batch processOneModule）。

**🔴 关键实施边界（Codex 对抗审查发现，原报告遗漏）**：sourceTarget 当前**身兼两职**——既是 cache key 又被当**真实文件系统路径**消费：
- batch-orchestrator.ts:912 `targetPath = path.join(resolvedRoot, moduleSourceTarget)` → 传给 generateSpec 做 `fs.statSync`（single-spec-orchestrator.ts:214）——`::language` 后缀会让 statSync 直接抛错；
- spec-store.ts:127 orphan 判定 `path.join(projectRoot, storedSpec.sourceTarget)` + exists 检查——带后缀的 stored spec 会被误判 orphan。

**处置**：在 regen-plan.ts 旁新增配对的 `sourceTargetToPath(sourceTarget)`（剥离 `::language` 后缀还原纯路径）作为唯一解析点；所有把 sourceTarget 当路径的消费点改走该 helper。batch-orchestrator 的 targetPath 推导在 files 注入参数落地后可直接用 group.dirPath/group.files（不再依赖 sourceTarget 反解）。旧 stored spec 的 sourceTarget 是纯路径格式——新格式只在多语言拆分组出现，旧 spec 在新键下查不到 → 判 missing-spec 走重生成（一次性失效，与 hash 公式变更同批，release note 合并标注）；spec-store orphan 判定剥后缀后旧/新格式均不误判。

> **⚠️ Phase 2 设计修订（已被 plan.md v2 取代本段处置方案）**：Phase 2 Codex 对抗审查 + 主编排器全仓消费面复核发现，sourceTarget 的路径消费面远不止 2 处——panoramic 的 cross-reference-index.ts:207（import specifier 路径前缀匹配）与 component-view-builder.ts:264（endsWith 路径匹配）都把 frontmatter sourceTarget 当路径做匹配，`::language` 后缀进 frontmatter 会让混语言模块的交叉引用静默蒸发。故最终方案**反转**：frontmatter `sourceTarget` 保持纯路径（generateSpec 由 targetPath 自行派生，天然纯净），新增 `buildSpecCacheKey(sourceTarget, group)` 派生 cache key（仅 `languageSplit` 组加 `::language` 后缀），key 只存在于 src/batch/ 内的 Map/Set 与新增 frontmatter 字段 `sourceTargetKey`（:925 装饰点写入、:1176 re-render 落盘、doc-graph-builder 解析）；`sourceTargetToPath` 整体废弃，spec-store / panoramic / 展示层零改动。多语言拆分判定改用 `ModuleGroup.languageSplit` 显式标记（替代 name 后缀嗅探，避免目录字面名 `x--python` 误判）。权威细节见 plan.md v2 修复面 3。

### 问题 3
checkpoint 命中 + mustRegen fall-through 路径，push 前先 `completedModules = completedModules.filter(e => e.path !== moduleName)`（replace 语义）；失败路径同理对 failedModules 去重，并保证 completed / failed 互斥（push completed 前从 failed 剔除，反之亦然）。

### 问题 4（诊断阶段二选一 → 推荐"实现 full-resume 语义"）
**论据**：
- 选项 A（删字段 + resume warn）：成本低，但放弃了"中断 full 可正确续跑"的能力，外部用户 `--full` 跑大项目中断后只能从头重跑（昂贵），体验差。
- 选项 B（实现 full-resume 语义，**推荐**）：读取 checkpoint.forceRegenerate，resume 时若为 true 则 `forceFullRegeneration ||= state.forceRegenerate`，剩余模块绕过增量 skip 继续全量。改动小（字段已落盘，只缺一处 OR 读取），且真正修复"半新半旧混合产物"——与 F186 npm 重发面向外部用户的可靠性目标一致。
- **决策**：采用 B。同时保留 resume 时一条 info 日志（"检测到首轮 full 未完成，剩余模块继续全量"）作为信号。字段不再是 dead field。

最终方案在 Phase 2 plan 阶段细化；Phase 1 已锁定 4 项均采用上述方向。

## Spec 影响
- 需要更新的 spec: 无既有 module spec 需改（本 feature 是 batch 增量链 bug 修复，不改产品对外契约）；release note / CHANGELOG 需标注 hash 公式 + sourceTarget 口径变更触发一轮全量。

## 范围评估
受影响源文件 4 个（+1 新共享模块 + spec-store 路径消费点 1 处）+ 测试，集中在 batch 增量 + core 单 spec 生成 + spec-store 3 个相邻模块，**未超** 10 文件 / 3 模块阈值上限 → 适合 fix 模式快速修复，无需升级 feature。

## Codex 对抗审查结论（Phase 1 诊断）

- 判定：4 条根因**全部 confirmed，零 refuted**（每条附文件:行号证据）。
- CRITICAL×4（即 4 项根因本身成立）；INFO×1（修复方向补充）。
- 审查修正 2 处，已折回本报告：
  1. 根因 1 措辞——写侧上游 scanFiles **有** code-unit 排序（file-scanner.ts:367），分叉本质是"排序算法不同（code-unit vs localeCompare）+ 文件集来源不同"，非"无排序"；
  2. 根因 2 实施边界——sourceTarget 身兼 cache key + 文件系统路径两职（batch-orchestrator.ts:912 / spec-store.ts:127），`::language` 后缀不能无配套地替换，需 `sourceTargetToPath` 解析点 + 旧格式兼容（已纳入修复策略问题 2）。
- 另确认：conflictingDirPaths 单文件降级可避碰撞但不可依赖；root 模块文件级展开已有保护。

## Codex 对抗审查结论（Phase 2 规划）

- 判定：3 CRITICAL / 3 WARNING / 3 INFO，**全部接受并落入 plan.md v2 + tasks.md v2**：
  - C1 双重 AST 分析（generateSpec 改调 wrapper 会对同一文件集二跑 analyzeFiles）→ 拆纯函数 combineSkeletonHashes + wrapper 两层，写侧复用已有 skeletons；
  - C2 :518 时序（checkpoint :629 才加载，OR 提前必然读 undefined）→ 两变量改 let，OR 注入点移到加载 + full 清空块之后（约 :648）；
  - C3 sourceTarget 角色未分离 + panoramic 消费点遗漏 → 方案反转为"frontmatter 纯路径 + buildSpecCacheKey + sourceTargetKey 持久化"（见上方修订注记）。注：C3 的"outputPath 非法路径"证据不精确（spec 文件路径由 moduleName 派生而非 sourceTarget），但 panoramic 匹配断裂的核心风险经主线程独立 grep 证实成立；
  - W1 name 嗅探误判 → ModuleGroup.languageSplit 显式标记；W2 E2E mock generateSpec 复现假绿结构 → 只 mock LLM 边界（独立新测试文件）；W3 skeleton-hash 放 batch 致 core 反向依赖 → 移至 src/core/；
  - I1 并发丢写降级（JS 同步段不被 pLimit 交错，仅作 helper 加固）；I2 旧数据失效提示 → release note 说明，不加检测逻辑；I3 并入 C3。

## Codex 对抗审查结论（Phase 3 实现）

- 判定：1 CRITICAL / 3 WARNING / 6 refuted（refuted 项含 sortKey base 对齐、root 口径、stale-alias、full-resume 死循环、YAML 往返、版本递增——攻击未果即实现正确性的反向证据）。
- **已修（同批返工，vitest 4250 全绿复验）**：
  - W4（升级为必修）：目录级 languageSplit 组 spec 文件名碰撞——generateSpec 按 basename 命名导致同目录两语言组写同一 `<dir>.spec.md` 互相覆盖，cache key 修了但存储层只能保一组 → 另一组每轮 miss，M8-SC-001 在目录级不成立。修法：GenerateSpecOptions.outputFileName，batch 对 split 组传 `${moduleName}.spec.md`（root per-file 与非 split 模块零变化）；新增 E2E 场景 C（service.ts+extra.ts+worker.py 目录级真实碰撞，第二轮零重生成）。该修复同时顺带消除了非 root 路径下同名异语言文件（helper.ts+helper.py）的 spec 文件名碰撞。
  - W3：sourceTargetKey 原依赖 doc-graph re-render 二次落盘（晚于 checkpoint save，崩溃窗口内下轮多余重生）→ 改经 generateSpec options 透传 generateFrontmatter，首写即入盘，并删除 post-mutation 块。
- **确认不修（已写入 plan.md v2.1）**：
  - C1：scanPyFiles 不解析 .gitignore 属 python-adapter 既有缺陷（F175 起 module graph 与读侧 hash 即含这些文件）；在注入处过滤会重新引入读写文件集分叉（恰是本 fix 消灭的对象），单点修 scanPyFiles 留独立 fix（已登记后续候选）。
  - W2：delta propagation fallback（resolveSpecForSource 返回纯路径键）仅在文件不属任何当前 module group 时可达，正常 batch 不触发，留观察。
- 残留已知边界：root 模块按文件展开路径下，repo 根部同名异语言文件（如根目录 helper.ts+helper.py）的 per-file spec 命名仍可能碰撞——极窄边缘，随 scanPyFiles 独立 fix 一并评估。
