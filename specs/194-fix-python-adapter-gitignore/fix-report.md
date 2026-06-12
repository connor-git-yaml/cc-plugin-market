# 问题修复报告 — F194 python-adapter scanPyFiles 不遵循 .gitignore

## 问题描述

`src/adapters/python-adapter.ts:111` 的 `scanPyFiles` 只用硬编码 ignoreNames 集合（`defaultIgnoreDirs` + test/tests/dist/node_modules/.git + 点开头目录），不解析项目 `.gitignore`；而 TS 侧 `src/utils/file-scanner.ts` 的 `scanFiles` 走完整 ignore 规则（UNIVERSAL_IGNORE_DIRS + Registry 聚合 ignoreDirs + parseGitignore + extraIgnorePatterns + 符号链接跳过）。

**后果**：Python 项目中被 `.gitignore` 的 `.py` 文件（如 `generated/`、本地脚本）进入 module graph 与增量 skeletonHash 读侧口径（F175 起即如此）；F182 的 files 注入参数让写侧 spec 内容也包含这些文件。

**来源**：F182 Codex Phase 3 对抗审查 C1 项（定级 CRITICAL，判定属上游既有缺陷不在 F182 范围）。F182 审查明确：在注入处过滤会重新引入读写文件集分叉（恰是 F182 消灭的对象），正确修点是 scanPyFiles 单点接入与 file-scanner 一致的 ignore 规则。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | gitignored .py 为何进入 module graph / 增量 hash？ | `PythonLanguageAdapter.buildModuleGraph`（:246）与 `extractSymbolNodes`（:148）的文件来源是私有 `scanPyFiles`，它只按硬编码目录名 + 点前缀剪枝，从不读 `.gitignore` |
| Why 2 | scanPyFiles 为何不解析 .gitignore？ | F145（d9be1a2，Python AST→graph 桥接）引入时在 adapter 内自写轻量 walk（注释自述"复用 defaultIgnoreDirs 并叠加 Python 项目惯例"），未复用 file-scanner 已有的 gitignore 管线 |
| Why 3 | 为何没复用 file-scanner？ | `scanFiles` 的忽略语义与 Python graph 需要的不重合（UNIVERSAL_IGNORE_DIRS 不含 test/tests、不剪任意点前缀目录），且 gitignore 逻辑（`parseGitignore`/`globToRegex`）是模块私有未导出，复用门槛高 → 当时选择自写 |
| Why 4 | 口径分叉为何长期无感知？ | F175 增量上线前读写文件集无对账机制；本仓（TS 为主）没有 gitignored .ts 干扰样本，Python baseline（micrograd/nanoGPT）的 .gitignore 项恰被硬编码集覆盖（__pycache__/venv/env）或 working tree 中无实例，未暴露差异 |
| Why 5 | 为何测试未捕获？ | 测试盲区：Python adapter/graph 测试 fixture 均无 `.gitignore`；file-scanner 的 gitignore 测试只覆盖 scanFiles 路径；无"读写文件集一致性"合同测试。最终靠 F182 Codex 人工对抗审查发现 |

**Root Cause**: `scanPyFiles` 在 F145 引入时自写目录剪枝、未接入项目 `.gitignore` 规则，且读写文件集无一致性合同测试。
**Root Cause Chain**: gitignored .py 进 graph/hash/spec → scanPyFiles 不读 .gitignore → F145 自写 walk（file-scanner gitignore 逻辑私有不可复用）→ 读写口径无对账 + baseline 样本恰未暴露 → fixture 无 .gitignore 测试盲区
`[ROOT CAUSE REACHED at Why 3]`（Why 4/5 解释暴露路径与盲区）

## 调用链闭环（影响传播路径）

```
[路径 1] scanPyFiles（python-adapter:111，无 gitignore）
 ├→ buildModuleGraph（python-adapter:246）→ graph.modules 含 gitignored .py
 │    → batch-orchestrator:487 groupFilesToModules → group.files
 │       ├→ 读侧 delta-regenerator:252 computeSkeletonHash(projectRoot, group.files)  ← F175 增量判定口径
 │       └→ 写侧（F182 后）generateSpec files 注入 = group.files → spec 内容含 gitignored 文件
 └→ extractSymbolNodes（python-adapter:148，batch-orchestrator:1283）→ knowledge graph 第四路符号节点

[路径 2] walkPyFiles（batch-orchestrator:2213，无 gitignore，收 .py/.pyi）
 └→ collectPythonCodeSkeletons（:2118，F151 callSites）→ batch-orchestrator:1224 → UnifiedGraph / graph.json
     → graph_query / impact 等 MCP 图谱工具的内容口径

[路径 3] walkTsJsFiles（batch-orchestrator:2332，无 gitignore，收 .ts/.tsx/.js/.jsx 等）
 └→ collectTsJsCodeSkeletons（:2252，F152）→ batch-orchestrator:1225 → UnifiedGraph / graph.json（同上）
```

路径 2/3 由 Phase 1 Codex 对抗审查 CRITICAL 项暴露（路径 3 为复查时一并发现）：不进增量 hash 口径（那是 group.files ← module graph），但 gitignored 文件会进入知识图谱节点、callSites 与 import 边，污染 graph_query/impact 结果。三条路径同一根因模式（自写 walk 绕过 .gitignore），按"同源需同步修复"纳入同一修复。

master 现状（F182 未合入）：写侧 `single-spec-orchestrator:222` 走 `scanFiles`（带 gitignore）→ 读写文件集分叉 → Python 项目含 gitignored .py 时增量永久 cache miss。修复后：master 现状读写一致；F182 合入后（写读统一 group.files）同样一致。

## 影响范围扫描

### 同源问题（需同步修复）
| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| src/adapters/python-adapter.ts | L111-130 `scanPyFiles` | 自写 walk 无 gitignore | 接入共享 gitignore 过滤（叠加，保留硬编码集） |
| src/batch/batch-orchestrator.ts | L2213 `walkPyFiles` | 自写 walk 无 gitignore（收 .py/.pyi） | 同上（Codex Phase 1 审查 CRITICAL 项补入） |
| src/batch/batch-orchestrator.ts | L2332 `walkTsJsFiles` | 自写 walk 无 gitignore（TS/JS） | 同上（复查 CRITICAL 时一并发现，同根因） |

### 类似模式（已逐一评估）
| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| src/adapters/{go,java,ts-js}-adapter.ts | — | 无自扫描（已验证无 readdirSync） | [安全] go/java 无 buildModuleGraph 自扫描；ts-js 委托 buildModuleGraphForProject |
| src/knowledge-graph/module-derivation.ts | :324 buildModuleGraphForProject | 走 scanFiles（带 gitignore） | [安全] |
| src/core/single-spec-orchestrator.ts | :222 | 走 scanFiles（带 gitignore） | [安全] |
| src/core/single-spec-orchestrator.ts | :1054 scanTestFiles | 自写 walk 无 gitignore | [安全-不扩面] 仅统计测试文件数供 spec 文本描述，不进 graph/hash 口径；登记为后续候选 |
| src/panoramic/**（readdirSync 多处） | — | monorepo 包发现/文档管线/缓存目录读取 | [安全] 非源文件集口径 |

### 保留现状的既有口径差异（本 fix 不动，登记候选）
- `walkPyFiles` 收 `.pyi` 而 `scanPyFiles` 只收 `.py`；三处 walk 的硬编码忽略集各不相同（`ignoreNames` / `PY_SKELETON_IGNORE_DIRS` / `TSJS_SKELETON_IGNORE_DIRS`）——本 fix 只叠加 .gitignore 层，不统一扩展名与硬编码集（避免行为变更扩面）

### 同步更新清单
- 调用方：`extractSymbolNodes` / `buildModuleGraph` 无签名变化（内部修，零 API 变更）
- 测试：新增带 `.gitignore` 的 Python 项目 fixture 单测（gitignored .py 不进扫描结果/module graph）
- 文档：`specs/193-.../release-note.md`（hash 口径变化 → 升级后 Python 项目首轮全量重生成属预期）
- 类型定义：无

## 修复策略

### 方案 A（推荐）：file-scanner 导出 gitignore 过滤工厂，三处 walk 叠加接入
- `src/utils/file-scanner.ts` 将现有 `parseGitignore`（含 `globToRegex`）封装导出为 `createGitignoreFilter(projectRoot): (relativePath: string) => boolean`（单一事实源；scanFiles 内部同步改用该工厂，行为零变化）
- 三处自写 walk（`scanPyFiles` / `walkPyFiles` / `walkTsJsFiles`）各自在 walk 中对目录与文件均查询该过滤器（目录命中即剪枝、文件命中即跳过），相对路径基准 = 各自的 resolvedRoot（与 file-scanner `path.relative(baseDir, fullPath)` 同口径）
- **对齐层级的准确表述**（Codex Phase 1 审查 W1 修正）：本方案对齐的是 **.gitignore 规则这一层**（单一事实源），**不是** file-scanner 的完整 ignore 目录集（UNIVERSAL_IGNORE_DIRS / Registry 聚合集）。三处 walk **保留**各自现有硬编码集与点前缀剪枝语义——故意不做完整集对齐，因为：(1) 完整集与各 walk 现有语义互有宽窄（如 UNIVERSAL 不含 test/tests、含 specs/examples），对齐即引入与 gitignore 无关的行为变更；(2) 叠加式接入保证文件集**单调收紧**（只少不多），无放宽回归面
- gitignore negation（`!pattern`）边界：目录剪枝可能使"被 ignore 目录下又被 `!` 重新包含的文件"不可达——此行为与 file-scanner `walkDir`（:271 对目录同样 `isIgnored` 即 continue）完全一致，且与 git 自身语义一致（git 不会 un-ignore 已排除目录内的文件，除非父目录被重新包含）。非新增偏差

### 方案 B（备选，否决）：scanPyFiles 整体替换为 scanFiles({ extensions: ['.py'] })
- 否决理由：UNIVERSAL_IGNORE_DIRS 不含 test/tests、不剪任意点前缀目录（.tox/.eggs 靠 defaultIgnoreDirs 聚合，但任意 .foo 不剪）→ 会把 tests/ 等目录的 .py 放进 graph，行为放宽 = 新回归面；返回值相对/绝对路径口径也需适配，改动面更大；且对 batch 层两条 walk（含 callSites 专用逻辑）替换成本更高

## 已知影响（写入 release note）
- 修复改变 Python 项目（含 gitignored .py 的）module graph 与 skeletonHash → 升级后首轮触发全量重生成，属预期行为
- UnifiedGraph（graph.json）口径同步收紧：gitignored 的 .py/.pyi 与 TS/JS 文件不再进入知识图谱节点 / callSites / import 边（graph_query / impact 结果变化）
- micrograd / nanoGPT baseline 预判零差异（git check-ignore 口径已实测两项目零命中：micrograd .gitignore 仅 .ipynb_checkpoints/.aider*；nanoGPT 的 __pycache__/env/venv 本就在硬编码集且 working tree 无实例）→ baseline fixture 预期无需重采集
- **验证方法补强**（Codex Phase 1 审查 W2）：git check-ignore 口径不足以代表我们 parseGitignore 简化 glob 的口径——verify 阶段以 **fix 前后实测文件集 diff** 为最终证据（before-*.json 已存档），覆盖 micrograd / nanoGPT（Python 路径）+ self-dogfood 本仓（walkTsJsFiles 路径），并显式列出 diff（预期空，非空即逐项解释）；parseGitignore 与 git 语义的既有偏差属 file-scanner 既有行为，本 fix 的一致性目标是"与 file-scanner 对齐"而非"与 git 完全对齐"

## 附带评估项（F182 fix-report 残留边界）
repo 根部同名异语言文件（根目录 helper.ts + helper.py）per-file spec 命名碰撞："随 scanPyFiles 独立 fix 一并评估"。
**评估结论**：该项依赖 F182 的 `outputFileName` 机制（仅存在于 182 分支 a56346c），本 fix 基于 master（3925df5）无法触及；且与 ignore 规则缺陷无共享根因。**留待 F182 合入 master 后另议**（保持登记状态）。

## Spec 影响
- 需要更新的 spec：无需更新（`specs/products/spectra/current-spec.md` 未规定 Python 文件发现的 gitignore 行为细节；行为变化通过 release-note 披露）

## 缺陷实证复现（诊断阶段，fix 前）

合成项目 `/tmp/f193-repro`（`.gitignore` 含 `generated/` 目录模式 + `local_*.py` 通配模式）经 `buildModuleGraph` + `extractSymbolNodes` 实测：

```json
"moduleSources": ["generated/auto_stub.py", "local_scratch.py", "pkg/core.py"]  // 应只有 pkg/core.py
```

两类 gitignore 模式（目录/通配）均未被过滤，与诊断一致。fix 后预期 moduleCount 3 → 1。

fix 前 baseline 口径已捕获（`verification/before-micrograd.json` moduleCount=4、`verification/before-nanoGPT.json`），捕获脚本 `verification/capture-py-graph.mjs`。

## 验证要求（来自任务输入 + 审查补强）
1. `npx vitest run` 全绿 + `npm run build` + `npm run repo:check`
2. micrograd/nanoGPT baseline 免 LLM 回归：对比 fix 前后 module graph / 符号提取文件集（预期零差异，diff 显式列出）
3. self-dogfood 本仓：collectTsJsCodeSkeletons / collectPythonCodeSkeletons 文件集 before/after 对比（walkTsJsFiles 路径回归）
4. 新增单测：带 .gitignore 的项目 fixture，覆盖三条 walk 路径（目录模式 + 通配模式 + negation 不放宽）

## Codex 对抗审查结论（Phase 1 诊断）

- 判定：1 CRITICAL / 2 WARNING / 1 INFO / 3 攻击未果（5-Why 主链、方案 B 否决理由、Spec 无需更新均未被证伪）
- **C1（已修订）**：影响范围遗漏 batch 层独立 Python 收集路径 `walkPyFiles`（batch-orchestrator:2213，collectPythonCodeSkeletons → UnifiedGraph）→ 已纳入同源修复点；复查时一并发现 TS/JS 对称路径 `walkTsJsFiles`（:2332）同病，一并纳入（共 3 处 walk）
- **W1（已修订）**："与 file-scanner 口径一致"措辞不准确 → 已改为"对齐 .gitignore 规则层（单一事实源），保留各 walk 硬编码集，单调收紧"
- **W2（已修订）**：micrograd/nanoGPT 零差异预判的验证方法不足 → 已补强为 fix 前后实测文件集 diff 为最终证据，并补 self-dogfood TS 路径对比
- **I1**：scanTestFiles 不进 graph/hash 的判断未被证伪（维持 [安全-不扩面]）

## Codex 对抗审查结论（Phase 2 规划）

- 判定：0 CRITICAL / 4 WARNING / 1 INFO / 4 攻击未果（walk 签名破坏、POSIX sep 偏差、parseGitignore negation 语义、性能 blocker 均证伪失败）
- **W1（已修订 plan）**：createGitignoreFilter 相对路径基准契约未写清（scanFiles 存在 scanRoot≠projectRoot 基准错位既有怪癖）→ JSDoc 与 plan 补"输入必须相对 projectRoot、由调用方保证基准一致"契约；三处新接入扫描根 = gitignore 根，无错位
- **W2（已修订 plan+tasks）**：batch gitignore 用例的负向断言可被"全解析失败 → 空 Map"假绿 → 所有用例改为正负断言配对（keep 文件存在 + ignored 文件不存在），collect* 测试不 mock adapter、写真实可解析源文件
- **W3（已修订 plan+tasks）**：单独 `!important.py` 是 no-op 无法验证 negation → 改为 `local_*.py` + `!local_important.py` 最后匹配优先写法（参照 file-scanner.test.ts:76-82），并补"已剪枝目录内 negation 不放宽"子用例
- **W4（已修订 tasks）**：T003/T004 标 [P] 但改同一对文件 → 撤销 [P]，改串行（推荐合为一次编辑）
- **I1（已修订 tasks）**：全量 vitest 会再生 specs/src.spec.md（self-dogfood 污染）→ T005 增加步骤 2.5：git status 检查 + 自动再生产物恢复 + 显式路径 git add

## Codex 对抗审查结论（Phase 3 实现）

- 判定：0 CRITICAL / 2 WARNING / 4 INFO / 8 攻击未果（scanFiles 行为漂移、单调收紧破坏、根目录空串、目录无尾斜杠匹配、symlink 行为、CRLF/BOM/注释 gitignore、相对 projectRoot 基准错位、新测试 fix 前假绿——全部证伪失败，是实现正确性的反向证据）
- **W1（确认不修，登记候选）**：globToRegex 生成 `/` 分隔正则而 walk 喂 raw path.relative，Windows 上反斜杠路径匹配不上——属 file-scanner 存量缺陷（walkDir 同样如此），非本 fix 新增；叠加接入后影响面扩大但为**安全降级**（匹配不上 → isGitignored=false → 文件保留 = fix 前行为，不会错杀）。修 sep 归一化触碰所有 scanFiles 调用方，超出 fix 范围 → 已写入 release-note 已知限制，登记后续候选
- **W2（已修，同批返工）**：batch 的 generated/ 用例杀不死"删掉目录剪枝、只留文件过滤"变异体 → 新增 T-PY-GITIGNORE-03 / T-TSJS-GITIGNORE-03（`generated/` + `!generated/keep.*` → keep 仍被剪），锁定目录剪枝分支；重跑 3 个测试文件 67 passed
- **I1（commit 清单提示）**：tests/unit/batch-orchestrator-gitignore.test.ts 是 untracked 新文件，commit 用显式路径 add 时须列入
- **I2/I3/I4**：batch 测试不依赖 Registry 初始化判断正确、03a/03b 与 parseGitignore 最后匹配优先一致、性能无新瓶颈
- Codex sandbox 无法跑 vitest（只读限制），运行时验证由主线完成：全量 4251 passed + 针对性 67 passed
