# 问题修复报告 — F232 CI 门禁六重失效（Node 20 glob + 缺 build + 缺知识图谱产物 + 三处主机相关测试假设）

## 问题描述

`.github/workflows/ci.yml` 的两个测试步骤 **长期全红**，导致仓库实际处于"无 CI 门禁"状态。
起初报告的是 mjs gate 在 Node 20 起不来，诊断中发现**这只是六个独立缺陷之一**（A/B/C 为 CI 配置面，D/E/F 为主机相关测试假设面，后三者由 codex 对抗审查分两轮在 A/B/C 闭合后追加）。

实证（`gh run view 30090377786`，master 最近一次 CI）：

| 步骤 | 结果 | 实际错误 |
|------|------|----------|
| Type Check (`npm run lint`) | success | — |
| **Test** (`npm test`) | **failure** | `dist-missing: dist/core/ast-analyzer.js` → 依赖 dist 的测试整片失败 |
| **Test Plugins (mjs gate)** | **failure** | `Could not find '/home/runner/.../tests/**/*.test.mjs'` → exit 1 |

master 近 8 次 push 的 CI **全部 failure**（2026-07-22 F219 起连红至今，含 F225/F226/F227/F228/F229/F230 与 M9 文档 commit）。

### 递进实证：修完前两链后干净环境仍有残留失败

链 A / 链 B 落地后，用 `git archive HEAD | tar -x` 导出干净树（仅已跟踪文件，等价 CI checkout）+ 软链 `node_modules` + Node 20 复现 CI，
发现**并非全绿**——`dist` 就位、mjs gate 恢复，但 vitest 仍剩 2 个测试文件失败：

| 干净环境阶段 | vitest 失败文件 | 失败形态 |
|---|---|---|
| 修复前（无 build） | 大片（43 个文件引用 dist） | `dist-missing: dist/core/ast-analyzer.js` / `DRIFT_GRAPH_UNAVAILABLE` |
| **加 build 后（仅链 A+B）** | **仍剩 2 个** | `tests/unit/graph-quality-core.test.ts`、`tests/integration/spec-drift-repo-check-regression.test.ts` → `expected false to be true` |
| 加 build + 建图后（链 A+B+C） | 0 | 上述 2 个文件 12/12 全绿 |

这一"加 build 后仍剩 2 个失败"的递进结果，是链 C 被识别出来的直接触发点——
说明 dist 缺失只解释了大部分失败，剩下 2 个另有独立成因。

### 递进实证之二：A/B/C 全绿后，真实 CI 日志里仍有三处失败

链 A/B/C 闭合、本地干净树 + Node 20 五步全绿之后，codex 对抗审查回到**真实 GitHub Actions 日志**
（run 30090377786）复核，发现还有三处失败——它们的共同特征是**只跟运行主机有关**，
本地无论怎么造干净树都复现不出：

| 残余失败 | 本机 macOS | Ubuntu runner | 与主机的哪一属性有关 |
|---|---|---|---|
| `tests/unit/feature-176-spike-and-gate.test.ts:144` | 绿 | **红** | **工作区路径形态**（runner 是 `/home/runner/work/...`，本身含 `/r`） |
| `tests/e2e/f220-decomposition-charter.e2e.test.ts` 快照 | 绿 | **红** | **CPU 架构**（arm64 vs x64 的 onnxruntime kernel 差异） |
| `tests/integration/watch-command.test.ts:149` | 绿 | **红** | **进程表内容**（`pgrep -f "spectra batch"` 查询运行主机全部进程的命令行） |

链 D / 链 E 由 codex 第一轮审查追加；链 F 由第二轮审查逐行解析该 run 的原始日志时发现——
日志里共 8 个失败文件，链 A–E 只覆盖 7 个，`watch-command.test.ts` 是第 8 个、始终未被归因。

这是本次 fix 的第二个方法论教训：**"本地复现 CI 环境"能覆盖产物与运行时版本差，覆盖不了主机路径、CPU 架构与进程表内容**。
链 D 可用"把仓库导出到含 `/r` 的路径"人工复现；链 F 可用"在主机上放一个命令行含 `spectra batch` 的诱饵进程"人工复现；
链 E 则只能靠真实 CI 日志给出的实测值 + 数值论证，本地无法自证。

### 两处事实口径更正（codex 指出，已实测复核）

| 此前记录 | 实测更正 | 复核方式 |
|---|---|---|
| mjs gate 失败退出码 **126** | **exit 1** | 干净树 + Node 20.20.2 直跑 `node --test "<glob>"` → 打印 `Could not find` 后 `$? = 1`。126 是经 `volta run` + npm 包装层后的码，非 runner 本身的码。**根因判断不受影响**（glob 展开仍是 Node 21+ 能力） |
| mjs gate 规模 **19 文件 / 919 用例** | **13 文件 / 807 用例** | `git ls-tree -r HEAD` 已跟踪 `*.test.mjs` = 13；干净树跑 `node scripts/run-plugin-tests.mjs` → `tests 807 / pass 807 / fail 0`。工作区看到的 19/919 混入了 F231 尚未提交的 6 个测试文件，**不是** master 历史事实，也不是 F232 的验收值 |

## 5-Why 根因追溯

本问题有**六条独立根因链**，须分别追溯。A/B/C 属 CI 配置面（干净树本地可复现），D/E/F 属主机相关测试假设面（本机 macOS 必绿、Ubuntu runner 必红，本地干净树也复现不出）。

### 链 A：mjs gate 在 Node 20 起不来（`Could not find` + exit 1）

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | mjs gate 为何失败？ | `node --test` 报 `Could not find '<repo>/plugins/spec-driver/tests/**/*.test.mjs'`——把 glob 模式当成了字面路径 |
| Why 2 | 为何被当字面路径？ | `node --test` 的 **glob 展开是 Node 21+ 才支持的能力**；Node 20 只接受具体文件或目录参数，不做 glob 解析 |
| Why 3 | 为何脚本会写 glob？ | 该写法由 `6ef0cee`（F201 Phase B）引入。当时本机 Node 版本支持 glob，本地跑通即认为可用 |
| Why 4 | 为何与 CI 不一致？ | CI 固定 `node-version: 20`（ci.yml L18），而本机是 Node 24。**glob 能力恰好横跨在这两个版本之间**——本地永远绿、CI 永远红 |
| Why 5 | 为何长期未被发现？ | 无人以 Node 20 在本地跑过 `test:plugins`；且 CI 红被长期容忍/未追查。F201 曾专门加"独立 mjs gate"步骤防止被短路跳过（ci.yml L30-36 注释），但该 gate 自身从落地起就没真正执行过任何用例 |

**Root Cause A**：`test:plugins` 依赖 `node --test` 的 glob 展开，而该能力在 CI 固定的 Node 20 上不存在；本机 Node 24 与 CI Node 20 的能力差恰好覆盖此特性，使本地验证无法暴露该缺陷。

### 链 B：Test 步骤因 dist 缺失而失败

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | vitest 为何失败？ | 报错 `DRIFT_GRAPH_UNAVAILABLE` / `dist-missing: dist/core/ast-analyzer.js`——测试运行时找不到编译产物 |
| Why 2 | 为何找不到 dist？ | CI 从未执行 `npm run build`（ci.yml 只有 Checkout / Setup Node / npm ci / lint / test） |
| Why 3 | lint 不是已经跑 tsc 了吗？ | `lint = tsc --noEmit`——**只做类型检查、刻意不产出任何文件**，dist 目录始终不存在 |
| Why 4 | 为何测试会依赖 dist？ | 全仓 **43 个测试文件**引用 dist 产物（e2e/integration 走真实 CLI 与编译后的 AST analyzer，这是有意的端到端设计） |
| Why 5 | 为何长期未被发现？ | 本地开发者的 `dist/` 由日常 `npm run build` 长期存在，本地 vitest 因而全绿；CI 是干净 checkout，缺失即暴露——但 CI 红未被追查 |

**Root Cause B**：CI 缺少 build 步骤，而 43 个测试文件依赖编译产物；`lint` 的 `--noEmit` 使其无法顺带充当 build。

### 链 C：测试硬依赖被 gitignore 的知识图谱产物

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 补齐 build 后 CI 为何还剩 2 个测试红？ | `tests/unit/graph-quality-core.test.ts`、`tests/integration/spec-drift-repo-check-regression.test.ts` 报 `expected false to be true`——一个存在性断言失败 |
| Why 2 | 断言的是什么存在？ | `graph-quality-core.test.ts:218` 等处硬断言 `specs/_meta/graph.json` 存在（图质量指标与 spec-drift 回归校验都以这份知识图谱为输入） |
| Why 3 | 干净 checkout 为何没有这个文件？ | `.gitignore:74` 忽略了整个 `specs/_meta/`——该目录是**构建产物**（`spectra batch` 生成，4.5MB），有意不入库 |
| Why 4 | 那本地为何一直绿？ | 本地开发者跑过 `spectra batch` / `batch --mode graph-only`，`specs/_meta/graph.json` 长期躺在工作区里；测试读到就绿，从未暴露"缺图"路径 |
| Why 5 | 为何长期未被发现？ | 与链 A/B 同源——CI 从落地起就没有生成这份产物的步骤，而 CI 红被长期容忍。且链 B（dist 缺失）的大片失败**掩盖**了这 2 个失败，只有把 build 补齐后它们才浮出水面 |

**Root Cause C**：测试硬依赖 `specs/_meta/graph.json` 这一被 gitignore 的构建产物，而 CI 没有任何步骤生成它；
本地因长期残留副本而始终绿，形成与链 B 同构（但成因独立）的"本地有产物 / CI 干净必无"能力差。

### 链 D：F176 用例的 `/r` 断言在 GitHub runner 路径下必然失败

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 真实 CI 里 `feature-176-spike-and-gate.test.ts` 为何红？ | `tests/unit/feature-176-spike-and-gate.test.ts:144` 的 `expect(runCombDir('t','c')).not.toContain('/r')` 失败——实际值是 `/home/runner/work/cc-plugin-market/cc-plugin-market/tests/baseline/...` |
| Why 2 | 这个值哪里不对？ | 值完全正确。`runCombDir` 本就返回**绝对路径**，而 GitHub runner 的工作区就是 `/home/runner/work/...`，**路径前缀里天然含 `/r`**（`/runner`）→ 断言必然失败 |
| Why 3 | 那断言原本想表达什么？ | 用例名说得很清楚：**"combo 根不含 repeatIndex"**——即 `runCombDir` 不应带 `r1` / `r2` 这类 repeat 段（对比 `runFixturePath(t,c,1)` 才带 `/r1`）。这是个关于**路径尾部结构**的断言 |
| Why 4 | 为何写成了整串搜 `/r`？ | 用了一个**远比意图宽**的近似：把"不含 `/r<数字>` 段"降格成"整串不含 `/r`"。在写用例的机器上（`/Users/...`）这个近似恰好成立，于是被当成等价写法 |
| Why 5 | 为何长期未被发现？ | 与链 A/B/C 同源——CI 从未真正跑绿过，没人看这条失败；且本机 macOS 路径 `/Users/...` 与常见 Linux 开发路径都不含 `/r`，**只有 GitHub runner 这一种路径形态会触发**，本地干净树复现也照样绿 |

**Root Cause D**：断言用"整串搜 `/r`"这一**过宽的近似**表达"路径尾部不含 repeatIndex 段"的意图；
该近似的成立与否取决于**仓库被放在哪个绝对路径下**，而 GitHub runner 的 `/home/runner/...` 恰好使其必然失败。
缺陷在断言写法，不在被测的 `swe-bench-verified-paths.mjs`（其实现完全正确）。

### 链 E：F220 快照钉死了跨 CPU 架构不可复现的浮点数

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 真实 CI 里 F220 charter 快照为何红？ | 快照第 1479 行钉死 `"confidenceScore": 0.780570518226505`，Ubuntu CI 实际得 `0.7805705225965378`——差 **4.37e-9**，落在第 9 位有效数字 |
| Why 2 | 这个字段是怎么算出来的？ | `src/panoramic/anchoring/edge-builder.ts:116` 的 `confidenceScore: pair.similarity`，值来自 `similarity.ts::cosineSimilarity` 对两个 384 维 embedding 的余弦相似度 |
| Why 3 | 是我们的累加顺序不确定吗？ | **不是**。`cosineSimilarity` 全程是固定顺序的 IEEE-754 double 加乘除 + `Math.sqrt`，这些在 ECMAScript 里都是**精确规定**的运算（`Math.sqrt` 不属于规范允许实现自由近似的那批超越函数）→ 给定相同输入，任何合规引擎都必须给出**逐比特相同**的结果 |
| Why 4 | 那差异从哪来？ | 只能来自**输入本身**：embedding 由 `@huggingface/transformers` 的 all-MiniLM-L6-v2 经 onnxruntime 推理产出，不同 CPU 架构走不同 SIMD / BLAS kernel（融合乘加、向量宽度、归约顺序都不同），float32 输出存在末位差异。float32 相对精度约 1.2e-7，传播到余弦上正是 1e-8 量级——与实测 4.37e-9 吻合 |
| Why 5 | 为何长期未被发现？ | 本机始终是 macOS-arm64，同一架构上完全可复现（本地 12/12 长期全绿）；而 CI 从未跑绿过，这条红从未被看见。更根本地：**快照冻结的对象里混进了一个我们无权决定其比特位的第三方数值**，这一点在设计 charter 时没有被识别 |

**Root Cause E**：把一个由第三方 ML runtime 产出、跨 CPU 架构不可复现的浮点数，**以全精度**写进了以字节稳定为前提的冻结快照。
它同时也是产物缺陷：`specs/_meta/graph.json` 里这个字段本身就无法跨机器复现，快照只是第一个撞上它的消费者。

### 链 F：watch 集成测试的结论取决于运行主机的进程表

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 真实 CI 里 `tests/integration/watch-command.test.ts` 为何红？ | 第 149 行的 `vi.waitFor` 耗尽 5s 预算后失败：`AssertionError: expected "spy" to be called with arguments` —— `runBatch` 始终没被调用 |
| Why 2 | 为何 `runBatch` 没被调用？ | 从 `capturedOnChange(...)` 到 `runBatch(...)` 的整条路径**全同步**（`handleChange` → `executeBatchLoop` → `runBatch` 之间没有任何 await 阻断），本机实测该用例耗时 82ms、其中 50ms 还是测试自己的固定 sleep。既然同步，就不存在"慢到 5s 还没调用"这种情形——只可能是走了某个**提前返回分支** |
| Why 3 | 哪个分支？ | `handleChange` 的第一道闸门 `isExternalBatchRunning()`。它返回 true 时把变更塞进等待队列后直接 return，`runBatch` 永不执行 |
| Why 4 | 它凭什么返回 true？ | 实现是 `execSync('pgrep -f "spectra batch"')`——查询**运行主机上所有进程的命令行**。只要主机任意进程的 cmdline 含 `spectra batch` 子串就返回 true。这是一条被测模块对*外部世界*的真实依赖，而该用例其余部分（runBatch / 认证门控 / 项目配置 / FileWatcher.start）**全部被 mock 过**，唯独漏了它 |
| Why 5 | 为何长期未被发现？ | 与链 A–E 同源：CI 从未跑绿过。本机 macOS 开发时进程表里从来没有匹配项，于是这条分支永远走 false，测试恒绿；主机进程表是**测试完全无法控制**的外部状态，属于"本地跑绿"最难自省的一类假设 |

**Root Cause F**：一个本应完全 mock 隔离的集成测试，保留了一条对**运行主机进程表**的真实查询（`pgrep`）；
该查询命中时被测代码走提前返回分支，使断言目标永不发生，测试以"超时"的形态失败——
**表象是超时，本质是环境相关的确定性失败**，调大超时只会让它慢若干秒再红。

**Root Cause Chain（合并）**：CI 全红 → 六条独立链 →
(A) glob 能力跨 Node 20/24 分界 + (B) CI 无 build 而测试依赖 dist + (C) CI 无建图而测试依赖 `specs/_meta/graph.json`
+ (D) 断言用过宽近似、其成立与否取决于仓库所在绝对路径 + (E) 快照钉死了第三方 ML runtime 产出的全精度浮点
+ (F) 集成测试保留了对主机进程表的真实查询 →
共同的元根因：**"本机能跑绿"被当成了"任何环境都能跑绿"**。
A/B/C 是这条元根因在**环境产物与运行时版本**维度的三个实例（本地有 dist / 有图 / Node 24）；
D/E/F 是它在**主机属性**维度的三个实例（工作区路径形态 / CPU 架构 / 进程表内容）——后者连"本地造干净树"都覆盖不到，
因为干净树复现只还原了*仓库内容*，没有也无法还原*运行主机*。

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `package.json` | `scripts.test:plugins` | `node --test "<双星 glob>"` | 改为不依赖 runner glob 的文件枚举方式（链 A） |
| `.github/workflows/ci.yml` | 步骤序列 | lint 后直接 test，无 build | 在 Test 之前插入 build 步骤（链 B） |
| `.github/workflows/ci.yml` | 步骤序列 | 无任何生成 `specs/_meta/graph.json` 的步骤 | 在 Build 之后、Test 之前插入 `Build Knowledge Graph` 步骤（链 C） |
| `tests/unit/feature-176-spike-and-gate.test.ts` | L142-145 | 对**绝对路径**整串搜 `/r` 表达"无 repeatIndex 段" | 断言收窄到 `path.relative(VERIFIED_ROOT, combDir)` 的相对段等式 + repeatIndex 正则，并补正向对照（链 D） |
| `src/panoramic/anchoring/edge-builder.ts` | L116 | 把 embedding 余弦相似度**原样全精度**写入图谱产物 | 出口处量化到 4 位小数（链 E），并补单测锁定量化契约与"去重仍用原始值"行为 |
| `tests/integration/watch-command.test.ts` | L145-159 | 其余依赖全 mock，唯独漏掉 `isExternalBatchRunning()` 对**主机进程表**的真实 `pgrep` 查询 | mock `node:child_process.execSync` 把该外部查询钉成"无外部 batch"；`vi.waitFor` 超时同时放宽到 20s 作为负载余量（链 F） |

### 类似模式（需评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| `package.json` `scripts.test` | `vitest run && npm run test:plugins` | 串联短路 | **安全**：ci.yml 已用 `if: always()` 的独立 mjs gate 步骤规避短路（F201 Phase B 设计），链 A 修好后该设计即真正生效 |
| 其余 npm scripts | — | 是否还有 runner-glob 依赖 | 需 grep 复核：仅 `test:plugins` 一处使用双星 glob |
| 本地 `npm test` | — | 同样调用 test:plugins | Node 24 本地不受影响（glob 可用）；修复后两版本均可用，不产生本地回归 |
| 其余 gitignored 产物 | `.gitignore` 全表 | 是否还有测试硬依赖的忽略产物 | 干净树复现已覆盖：补齐 build + 建图后 vitest 零失败，说明当前无第四类同源缺口 |
| 全仓其余 `.not.toContain('/…')` 断言 | 6 处（grep 复核） | 是否还有"断言成立与否取决于仓库自身绝对路径"的同型缺陷 | **链 D 是孤例**。其余 5 处分别是：对**合成**路径字面量的断言（`/secret/path.ts`、`/Users/dev/wt-a`）、对命令名的内容断言（`/spec-driver:…`）、文件名不含 `/` 的断言，以及 `agent-context-sanitize` 的 `not.toContain('/Users/' \| '/home/')`——最后一条虽然提到 `/home/`，但它断言的是**脱敏后输出不得泄漏绝对路径**，这正是被测不变量本身（输入全为 mock），不随仓库位置而变 |
| 全仓其余快照 / fixture | `tests/**/*.snap`、`tests/fixtures/**` | 是否还钉死了其它长精度浮点 | 全部 `.snap` 中位数超过 8 位的浮点**修复后计数为 0**；`confidenceScore": 0.<4 位以上>` 全仓也仅命中链 E 这 1 处。其余 confidenceScore 全是 `CONFIDENCE_SCORES` 常量（0.65 / 0.95），无跨平台风险 |
| `edgeOpacity` / `community-detector` / `direction-audit` | 各自读 `confidenceScore` | 量化到 4 位是否影响下游判定 | **默认路径影响可忽略**：分别用于视觉透明度（连续映射无阈值）、社区权重（实为透传不参与 Louvain 计算）与方向审计分档（`>= 0.9` / `>= 0.6`，档距 0.1–0.3 远粗于 1e-4）；且既有 anchoring 单测用的 0.85 / 0.90 / 0.8 / 0.82 在 4 位量化下**逐比特不变** |
| `query-helpers.ts:643` `>= minConfidence` | 用户传入阈值过滤边 | 量化是否改变边的归属 | **非绝对零影响**：该阈值是任意用户输入，量化可能让边在阈值邻域改变归属（如 `0.64996 → 0.65`，`minConfidence = 0.65` 时由排除变为包含）。anchoring 默认阈值 0.75 与量化格点不冲突，**默认路径影响可忽略；自定义精细阈值附近可能改变边界归属** |
| 全仓其余测试对**主机全局状态**的真实查询 | `grep -rn "pgrep" src tests scripts` | 是否还有同链 F 的"漏 mock 的外部世界依赖" | **链 F 是孤例**：全仓 `pgrep` 仅 `src/cli/commands/watch.ts` 一处使用，消费它的测试也只有 `tests/integration/watch-command.test.ts` 一个 |

### 同步更新清单

- 调用方：`npm test`（内部调 test:plugins）、CI 的独立 mjs gate 步骤——均随脚本修复自动受益，无需各自改动
- 测试（链 A/B/C）：改的是构建/CI 配置本身，其"测试"即为**在干净树 + Node 20 下完整复现 CI 步骤序列**（lint → build → 建图 → vitest → mjs gate）并确认逐步 exit 0，
  外加在 Node 20 与 Node 24 双版本实跑全部 mjs 用例
- 测试（链 D）：改的就是测试本身，故其"测试"是**变异测试**——临时引入它本该抓住的回归，确认新断言仍然红
- 测试（链 E）：改的是产品代码，故**必须在同一提交内补单测**（仓库硬约束）——
  在 `tests/panoramic/anchoring/edge-builder.test.ts` 新增量化契约与"去重仍用原始值"守护共 4 个用例，
  并对二者各跑一次变异测试；外加 `tests/e2e/f220-decomposition-charter.e2e.test.ts`（端到端产物）+ 全量 vitest
- 测试（链 F）：改的就是测试本身，故其"测试"是**忠实复现装置**——
  在主机上放一个命令行含 `spectra batch` 的诱饵进程，确认修复前红、修复后绿
- 文档：无需更新 spec（详见文末「Spec 影响」）

## 修复策略

### 方案 A（推荐）：脚本内用 Node 枚举文件列表 + CI 补 build 与建图步骤

**链 A**：把 `test:plugins` 改为不依赖任何 shell 或 runner 的 glob 展开——用一个极小的 Node 脚本递归枚举
`plugins/spec-driver/tests` 下的 `.test.mjs` 文件，再把文件列表交给 `node --test`。

已实测（本机 Node 24.14.0 与 volta Node 20.20.2 各跑一次）：

| 方式 | Node 20 | Node 24 |
|------|---------|---------|
| 现状双星 glob | exit 1（Could not find） | exit 0 |
| 目录参数 `node --test <dir>` | exit 0 | **exit 1**（Node 24 拒绝把目录当 test spec） |
| **Node 枚举文件列表** | **exit 0 · 全量 pass** | **exit 0** |

目录参数方式被排除——它把问题从"Node 20 红"翻转成"Node 24 红"（与记忆中 F218 的 `node v24 --test 目录假失败` 同源），
不能两头兼顾。Node 枚举是唯一双版本均通过的方案，且未来新增子目录测试也不会漏（递归枚举）。

**链 B**：在 ci.yml 的 Type Check 与 Test 之间插入 `npm run build` 步骤，使 dist 产物在测试前就位。

**链 C**：在 ci.yml 的 Build 与 Test 之间插入 `Build Knowledge Graph` 步骤，命令为
`node dist/cli/index.js batch --mode graph-only`，使 `specs/_meta/graph.json` 在测试前就位。

步骤位置有硬约束：必须在 `Build` **之后**（该命令依赖 `dist/cli/index.js`，即链 B 的产物），且在 `Test` **之前**。
用 `node dist/cli/index.js` 而非 npm script 是刻意选择——见下方"是否加 npm script"。

已实测（干净树 `git archive HEAD | tar -x` + 软链 node_modules + Node 20）：

| 指标 | 实测值 |
|------|--------|
| 退出码 | 0 |
| 耗时 | 约 5s |
| LLM 调用 / 认证需求 | 零 / 零（graph-only 为纯 AST 路径） |
| 产物 | `specs/_meta/graph.json`，4.5MB，6079 节点 / 8050 边 |
| 图就位后重跑那 2 个测试文件 | 12/12 全绿 |

**为何选"CI 建图"而非"让测试在缺图时优雅 skip"**（用户拍板方向）：
让测试 `skip` 表面上也能让 CI 变绿，但代价是**图质量校验从此在 CI 上不再执行**——
`graph-quality-core` 覆盖 F217 落地的六项图质量指标（duplicate / orphan / dangling 等），
`spec-drift-repo-check-regression` 覆盖 F219 的 drift 回归门；二者恰恰是"防止图谱悄悄劣化"的守门人。
把它们改成缺图即 skip，等于在干净环境（也就是唯一真正的 CI 环境）里**永久关闭**这两道门，
把"门禁失效"从显性红转成隐性绿——比现状更危险。
既然 graph-only 是纯 AST、零 LLM、零认证、约 5s 的廉价路径，就没有理由用调弱门禁来换绿。

**是否顺带加一个 npm script（如 `graph:build`）**：**不加**。
该命令目前只有 CI 一个消费点，加 script 等于为单点调用引入一层间接（YAGNI），
而且会让 ci.yml 里"这一步依赖 dist 产物、必须排在 Build 之后"这一关键顺序约束被 script 名字掩盖。
直接写 `node dist/cli/index.js batch --mode graph-only` 让依赖关系在 workflow 里一眼可见。
若将来出现第二个消费点（如本地 pre-push 钩子），再抽 script 不迟。

**为何三条一起修**：只修链 A，CI 的 Test 步骤仍会因 dist 缺失而红，mjs gate 虽能跑但整体 CI 依旧不绿；
只修 A+B，干净树实测仍剩 2 个测试红（见上方递进实证表）。
"恢复 CI 门禁"这一目标要求三条链全部闭合，任一条留着 CI 就仍是红的。
三者同属"CI 配置缺陷致门禁失效"，合并修复才构成完整闭环。

### 链 D 修复：把断言收窄到 repeatIndex 段，并补正向对照

原断言：

```ts
expect(runCombDir('t', 'c')).not.toContain('/r');   // 过宽：整串搜 /r
```

改为：

```ts
const combDir = runCombDir('t', 'c');
expect(combDir).toContain(`${VERIFIED_ROOT_REL}/tasks/t/c`);
// 只看 VERIFIED_ROOT 之后的相对段，用 path.relative 而非字符串截断
const relFromRoot = path.relative(VERIFIED_ROOT, combDir);
expect(relFromRoot).toBe(path.join('tasks', 't', 'c'));
expect(relFromRoot).not.toMatch(/(?:^|[\\/])r\d+(?:[\\/]|$)/);
// 正向对照：combo 根恰是 r<N> 层的父目录
expect(runFixturePath('t', 'c', 1)).toBe(path.join(combDir, 'r1', 'full.json'));
```

三点改动分别对应链 D 的问题：
1. **取 `VERIFIED_ROOT` 之后的相对段** —— 把仓库所在的绝对路径前缀排除在断言视野外，
   断言从此只描述"我们自己生成的那段路径结构"，与仓库被放在哪里无关；
2. **用 `path.relative` 而非 `indexOf` + `slice`** —— 后者在路径中 `VERIFIED_ROOT_REL` 子串出现多次时
   只截到第一次就会误判（反例 `/x/tests/baseline/swe-bench-verified/r9/nested/tests/baseline/swe-bench-verified/tasks/t/c`），
   且 `VERIFIED_ROOT_REL` 以 `/` 分隔而 `path.join` 在 Windows 上返回 `\`；`path.relative` 两个问题都不存在（codex 第二轮指出）；
3. **相对段等式 + repeatIndex 正则 + 正向对照** —— 精确表达"不含 repeatIndex 段"，并用 `runFixturePath` 的等式
   把"combo 根是 `r<N>` 的父目录"这层关系钉死。

**为何这不是"把红的测试改绿"**：修改后的断言**更精确地表达了当前 `r<N>` 合同**。
用变异测试验证：临时让 `runCombDir` 返回 `.../tasks/t/c/r1`（即真的带上 repeatIndex），
新断言照样红（相对段等式与 repeatIndex 正则同时失败），恢复后重新全绿。

**诚实的边界（不再声称"原断言能抓的一条不漏"）**：新旧断言的覆盖面是**相交而非包含**关系。
codex 给出反例：路径 `.../tasks/t/c/repeat1` —— 旧的 `.not.toContain('/r')` 能抓，
新的 `/r\d+/` 正则放过（`repeat1` 不是 `r<数字>` 形态）。但相对段等式 `toBe('tasks/t/c')` 会抓住它，
所以合起来仍然收严；真正被放弃的只是"整串搜 `/r`"那部分**误报来源**本身。

**为何不改产品代码**：`swe-bench-verified-paths.mjs` 的 `runCombDir` 实现完全正确，
缺陷 100% 在断言写法里。改产品代码去迎合一个写错的断言是本末倒置。

**忠实复现装置**（本机 macOS 即可复现 CI 的失败，无需 Linux）：
把仓库导出到一个**路径含 `/r`** 的位置——`<tmp>/home/runner/work/cc-plugin-market/cc-plugin-market`——
即完整还原 runner 的路径形态。实测：修复前 `1 failed | 18 passed`（报错正是 `expected '…' not to contain '/r'`），
修复后 `19 passed`。

### 链 E 修复：在产出侧把 confidenceScore 量化到 4 位小数

改 `src/panoramic/anchoring/edge-builder.ts`，在 `buildSemanticEdges` 的**返回出口**做量化：

```ts
const CONFIDENCE_SCORE_DECIMALS = 4;
function quantizeConfidenceScore(score: number): number {
  const factor = 10 ** CONFIDENCE_SCORE_DECIMALS;
  return Math.round(score * factor) / factor;
}
// 去重比较仍用原始相似度，只量化最终写出的数值
return [...dedupeMap.values()].map((edge) => ({
  ...edge,
  confidenceScore: quantizeConfidenceScore(edge.confidenceScore),
}));
```

**为何选产出侧（方案 a）而非只改断言容差（方案 b）**：

1. 这个字段**本身**就是不可复现的产物。`specs/_meta/graph.json` 是要跨机器 diff、要做 baseline 对比、
   要被 drift / graph-quality 消费的长期产物；只把快照断言放宽，等于承认"产物在不同机器上就是不一样"，
   把问题从"CI 红"降级成"沉默的不可复现"。F220 快照只是**第一个**撞上它的消费者，不会是最后一个。
2. 修改点极窄且可穷举：这是**当前 anchoring / embedding 路径上**唯一一处写入非常量 confidenceScore
   （该路径其余 relation 都取 `CONFIDENCE_SCORES` 常量 0.65 / 0.95），影响面已在上方"类似模式"表逐个消费方核过。
   **更正此前的"全图唯一写入点"表述**（codex 第二轮指出为事实错误）：`src/panoramic/graph/graph-builder.ts:218`
   还有另一条持久化入口 `relationship.confidenceScore ?? CONFIDENCE_SCORES[confidence]`，
   而 `ArchitectureIRRelationship.confidenceScore?: number` 允许调用方提供任意值并直写进 `GraphEdge`。
   当前所有内置 producer 都未赋该字段，故**实际产物**里的非常量值仍然只由本模块产生——
   但"唯一"是当前 producer 集合的性质，不是类型系统保证的不变量。
3. 量化放在**出口**而非构造处，是为了让去重比较（`edge.confidenceScore > existing.confidenceScore`）
   继续用原始相似度——避免量化制造并列、改变"选中哪条边"进而改变 `evidenceText`。
   本次改动对**边的选择**零影响，只影响写出的数值。

**为何取 4 位而不是直觉上的 6 位**（这是本链最容易做错的一步）：
量化能消除差异，前提是**量化步长远大于噪声**；若真值恰好落在量化中点附近，再小的扰动也会翻面。
对本次这个具体的值做实测：

| 保留位数 | macOS 值 → | Ubuntu 值 → | 是否同值 | 到量化中点距离 | 相对平台差(4.37e-9)的余量 |
|---|---|---|---|---|---|
| 8 位 | 0.78057052 | 0.78057052 | 是 | 3.23e-9 | **0.7×**（已在噪声内，纯属侥幸） |
| 6 位 | 0.780571 | 0.780571 | 是 | 1.82e-8 | **4.2×**（临界，换个 transformers 版本就可能翻面） |
| 5 位 | 0.78057 | 0.78057 | 是 | 4.48e-6 | 1026× |
| **4 位** | **0.7806** | **0.7806** | **是** | **2.05e-5** | **4695×** |
| 3 位 | 0.781 | 0.781 | 是 | 7.05e-5 | 16137× |

6 位小数**表面上也能让这次通过**，但余量只有 4.2 倍——本质上是又赌了一次。取 4 位有近 4700 倍余量，
且比 float32 embedding 的理论噪声底（约 1e-8）高出 3 个数量级。

**上表的 4695× 是单点观测，不可推广**（codex 第二轮指出）：它只对 F220 当前这一条被观测到的语义边成立。
当前图里语义边总共只有 1 条，样本量根本不足以支撑"所有语义边余量都这么大"这一推论；
换一份文档 / 一次重新 embedding，新值完全可能落在中点附近。可推广的只有下一段的"残余风险面"量化。

**为何这能显著降低跨平台差异（而不只是"本机绿了"）**：论证分三步，且不依赖"本机跑绿"这一观测。

1. **差异的唯一来源在 embedding 张量，不在我们的计算。**
   `cosineSimilarity` 全程是固定顺序的 IEEE-754 double 加 / 乘 / 除加一次 `Math.sqrt`；
   这些运算在 ECMAScript 中都是精确规定的（`Math.sqrt` 不在规范允许实现自由近似的超越函数名单里），
   因此**给定相同输入，任何合规引擎必然给出逐比特相同的结果**。差异只能来自 onnxruntime 产出的 float32 张量。
2. **量化后的序列化字节是整数 k 的纯函数。**
   `Math.round(x * 1e4) / 1e4` 得到的是"最接近 k/10⁴ 的那个 double"；
   而 `Number::toString` 在 ECMAScript 中是规范强制的最短往返表示。
   于是 `.snap` / `graph.json` 里写出的字符串完全由整数 k 决定，前提是两平台的 x 落进同一格。
3. **对这条边，k 在两个平台上相同。**
   由上表：两平台真值都落在同一 4 位量化格内，距离最近的量化中点 2.05e-5（单点观测，见上）。

**诚实的边界（量化后的残余风险面）**：这是"把失败面从 100% 压到可忽略"，**不是"消除"**，更不是数学意义上的零。
以观测到的平台差 Δ ≈ 4.37e-9 计，每个量化中点两侧各 Δ 宽度内的值都可能翻面，即单个中点的可翻面区间宽约
`2Δ ≈ 8.74e-9`；`[0, 1]` 区间内共 10⁴ 个中点，合计约 `8.74e-5`——**约 0.0087% 的值域仍不可复现**。
换句话说，一个均匀随机的新相似度值仍有约 1e-4 的概率落在翻面区。
彻底消灭这一类风险需要固定 embedding runtime 的数值行为（例如钉住 kernel / 关闭 SIMD），
代价远大于收益，不在本次范围。

**快照如何更新**：`.snap` 是 F220 的**冻结守护资产**（文件头明确"严禁 `vitest -u`"），
故采用**外科式定点替换**——只改 1 处字面量 `0.780570518226505` → `0.7806`，
其余 2000+ 行逐字不动；快照 key 集合由场景10a 守护自动复核。这与 F223 的处置方式同构。

**必须同提交补单测**：链 E 触碰产品代码，按仓库硬约束（"新增功能或修复 bug 时，对应的单元测试必须在同一个提交中包含"），
`quantizeConfidenceScore` 不能只由一个 e2e 快照值间接覆盖。在 `tests/panoramic/anchoring/edge-builder.test.ts`
新增 4 个用例，全部经由公开入口 `buildSemanticEdges` 断言（不为测试扩大导出面）：

| 新增用例 | 锁定的契约 |
|---|---|
| 两个真实平台观测值收敛到同一字面量 0.7806 | 链 E 的核心契约（含序列化字符串一致性） |
| 边界值与 4 位格点值逐比特不变（0 / 1 / 0.15 / 0.85 / 0.90 / 0.8 / 0.82） | 量化对既有取值无损 |
| 量化中点两侧舍入方向明确（half-up） | 边界行为确定、跨平台一致 |
| **去重仍按原始相似度比较——量化不得提前到去重之前** | 防止未来有人把量化挪到去重之前（最关键的一条） |

最后一条是行为守护而非数值断言：构造两条三元组相同、原始相似度不同（0.800041 < 0.800049）
但量化后同为 0.8 的候选边，且**低分在前**；只有"用原始值比较"才会让后到的高分覆盖先到的低分，
故断言最终选中边的 `evidenceSource` / `evidenceText` 来自原始值更高的那条。

### 链 F 修复：把 watch 集成测试对主机进程表的真实查询隔离掉

**修法不是调大超时**。这一点必须写清楚，因为失败表象（`vi.waitFor` 5s 超时）极易被误判成"CI 慢"：
从 `capturedOnChange(...)` 到 `runBatch(...)` 的整条路径全同步，本机实测该用例总耗时 82ms
（其中 50ms 还是测试自己写死的 sleep）。既然是同步路径，`runBatch` 要么在 waitFor 第一次轮询前就已被调用，
要么**永远不会**被调用——不存在"再等一会儿就好"的中间态。所以超时值多大都救不回来。

真正的修法是把 `isExternalBatchRunning()` 的外部依赖钉死：

```ts
const childProcessMocks = vi.hoisted(() => ({
  execSync: vi.fn(() => { throw new Error('Command failed: pgrep -f "spectra batch"'); }),
}));
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  execSync: childProcessMocks.execSync,
}));
```

抛错正是真实 `pgrep` 无匹配时的行为（非 0 退出 → `execSync` 抛 → watch.ts 的 `catch` 判为 false），
所以这不是编造一种不存在的状态，而是把该用例本来就默认成立、却从未被固定住的前提显式化。
同时新增一条 `expect(childProcessMocks.execSync).toHaveBeenCalled()`，
保证将来有人删掉这个 mock 时不会又悄悄退回"看主机进程表脸色"。

`vi.waitFor` 的超时仍从 5s 放宽到 20s，作为纯粹的 CI 负载余量——但它**不是**链 F 的修复手段，
代码注释里已明确标注，避免下一个读者把因果关系记反。

**为何不改产品代码**：`isExternalBatchRunning()` 用 `pgrep` 探测外部 batch 是 FR-010 的既定设计，
在生产里是正确行为；缺陷 100% 在"集成测试把其余依赖全 mock 了，唯独漏了这一个"。

**忠实复现装置**（本机 macOS 即可复现 CI 的失败）：在主机上放一个命令行含 `spectra batch` 的诱饵进程
（`node -e 'setTimeout(()=>{},120000)' "spectra batch" &`），即完整还原 runner 上该分支被触发的条件。

### 方案 B（备选）：把 CI 的 Node 版本升到 22+

只需改 ci.yml 一行即可让现状 glob 生效。
**不推荐**：(1) 只碰链 A，完全不解决链 B 与链 C（dist 缺失、graph.json 缺失都与 Node 版本无关，CI 依旧红）；
(2) `package.json` 的 `engines` 声明 Node ≥20，
CI 应当验证声明所支持的**最低**版本，升版会让 Node 20 兼容性彻底失去 CI 覆盖，与声明脱节；
(3) 治标——脚本对 runner glob 的隐式依赖仍在，下次有人用 Node 20 本地跑依然失败。

## 验证结果（全部为实跑输出，非推测）

### 链 D — 忠实复现装置（路径含 `/r`）前后对比

装置：把仓库导出到 `<tmp>/home/runner/work/cc-plugin-market/cc-plugin-market`，完整还原 GitHub runner 的路径形态。

| 阶段 | 命令 | 结果 |
|---|---|---|
| 修复前 | `npx vitest run tests/unit/feature-176-spike-and-gate.test.ts` | **1 failed \| 18 passed**，报错 `expected '/private/tmp/…/home/runner/…' not to contain '/r'` |
| 修复后 | 同上 | **19 passed** |
| 变异测试（让 `runCombDir` 返回 `.../t/c/r1`） | 同上 | **1 failed \| 18 passed**，报错 `expected '…' not to match /\/r\d+(?:\/\|$)/` → 证明守护强度未削弱 |
| 变异撤销后 | 同上 | **19 passed** |

### 链 E — 量化前后的数值行为

直接对 `dist/panoramic/anchoring/edge-builder.js` 喂入两个平台**各自的实测原始值**：

```
macOS-arm64 实测   输入 0.780570518226505  → 写出 0.7806
Ubuntu-x64 实测    输入 0.7805705225965378 → 写出 0.7806
```

两个平台的原始值**收敛到同一个序列化字面量**——这是链 E 唯一能在本机取得的直接证据
（跨平台本身无法在单一架构上自证，故补了上文的三步数值论证）。

配套测试：
- `npx vitest run tests/e2e/f220-decomposition-charter.e2e.test.ts` → **12 passed**（修复前也是 12 passed，本机本就绿）
- `npx vitest run tests/panoramic/anchoring/edge-builder.test.ts` → **16 passed**（原 12 + 新增 4）
- `npx vitest run tests/panoramic/anchoring/` → **54 passed**（既有 0.85 / 0.90 / 0.8 / 0.82 在 4 位量化下不变）

### 链 E — 新增单测的变异测试（证明测试有守护力）

| 变异 | 手法 | 结果 |
|---|---|---|
| M1 让 `quantizeConfidenceScore` 直接 `return score` | 等价于"没量化" | **3 failed \| 13 passed**：平台契约用例报 `expected 0.780570518226505 to be 0.7806`、中点用例报 `expected 0.1234499999 to be 0.1234`、去重守护用例报 `expected 0.800041 to be 0.8` |
| M2 把量化挪到**构造处**（出口改为原样返回） | 数值结果不变，只改变量化发生的时机 | **1 failed \| 15 passed**：只有去重守护用例red，报 `expected 'docs/design.md:10-20' to be 'docs/design.md:30-40'`——正是"选中的边翻面"这一真实回归 |
| 两次变异撤销后 | `cp` 还原备份 | `diff` 与备份**字节级一致**；`npx vitest run tests/panoramic/anchoring/edge-builder.test.ts` → **16 passed** |

M2 尤为关键：它证明"去重仍用原始值"这条不变量**只被新增的那一个用例守护**，
其余 15 个用例（含 e2e 快照）对该回归全部无感——若不补这条守护，未来把量化前移不会被任何门禁拦住。

### 链 F — 忠实复现装置（主机存在含 `spectra batch` 的进程）前后对比

装置：`node -e 'setTimeout(()=>{},120000)' "spectra batch" &`，使 `pgrep -f "spectra batch"` 在本机命中。

| 阶段 | 主机诱饵进程 | 结果 |
|---|---|---|
| 修复前 | 无 | 7 passed（本机本就绿，这正是长期未被发现的原因） |
| 修复前 | **有** | **1 failed \| 6 passed**，用例耗时 **5091ms**，报错 `vi.waitFor.timeout tests/integration/watch-command.test.ts:149:28 → AssertionError: expected "spy" to be called with arguments` —— 与真实 CI 日志同形 |
| 修复后 | 无 | **7 passed** |
| 修复后 | **有** | **7 passed** —— 结论不再随主机进程表变化 |

第二行是本链最重要的证据：它把"CI 上那条红"在本机**完整复现**了出来，
从而把"预存负载 flaky、不在本 fix 范围"这一此前的判断证伪。

### 全量门禁（本 worktree，Node 24）

| 命令 | 退出码 | 关键输出 |
|---|---|---|
| `npm run build` | **0** | tsc 零错误 + postbuild 盖章成功 |
| `npx vitest run` | **0** | `Test Files 483 passed \| 4 skipped (487)` / `Tests 5769 passed \| 18 skipped \| 21 todo` |
| `npm run test:plugins` | **0** | `tests 919 / pass 919 / fail 0`（工作区口径，含 F231 的 6 个文件） |
| `npm run repo:check` | **0** | 全族 pass；唯一 warning 是 `graph-quality:freshness`（图产物 sourceCommit 落后于 HEAD，属预存 stale，非本次引入） |

### 干净树 + Node 20 端到端（按 ci.yml 步骤序列，装置同时位于 `/home/runner/...` 路径）

`git archive HEAD | tar -x` 导出（仅已跟踪文件，等价 CI checkout）+ 拷入本次 7 处改动 + 删除 F231 的 `judge:doctor` 行 + 软链 `node_modules`，Node **v20.20.2**：

| 步骤 | 命令 | 退出码 | 关键输出 |
|---|---|---|---|
| 1 Type Check | `npm run lint` | **0** | — |
| 2 Build | `npm run build` | **0** | — |
| 3 Build Knowledge Graph | `node dist/cli/index.js batch --mode graph-only` | **0** | `specs/_meta/graph.json` 4.5MB |
| 4 Test | `npx vitest run` | **0** | `483 passed \| 4 skipped` / `5768 passed \| 19 skipped`；`dist-missing` 计数 **0**、`DRIFT_GRAPH_UNAVAILABLE` 计数 **0**；`feature-176-spike-and-gate.test.ts (19 tests) ✓` |
| 5 Test Plugins | `npm run test:plugins` | **0** | `枚举到 13 个测试文件` / `tests 807 / pass 807 / fail 0` |

干净树比 worktree 多出的 1 个 skip 已定位：`tests/integration/codex-plugin-marketplace.test.ts` 的
`describe.skipIf(!MARKETPLACE_TRACKED_IN_HEAD)`——干净树无 `.git` 故收集期 skip；
真实 CI 的 `actions/checkout` 会产出 `.git`，该用例在 worktree 中 4/4 实跑通过。属装置差异，非改动引入。

## 已知残余（**不声称"CI 将全绿"**）

闭合 A–F 六条链后，**真实 CI run 30090377786 日志里的 8 个失败文件已全部归因并覆盖**。
但下列残余项本地无法消除或无法自证，须在 push 后以**真实 CI 运行**复核：

| 残余项 | 性质 | 依据 | 处置 |
|---|---|---|---|
| 链 E 的跨平台结论 | **本地不可自证** | 单一 CPU 架构上跑再多次也复现不出架构差 | 必须由真实 Ubuntu CI 的 F220 快照步骤复核 |
| 链 E 的量化余量 | **概率性而非零** | 残余可翻面值域约 8.74e-5（约 0.0087%），即新值约 1e-4 的翻面概率；4695× 只是单点观测 | 若将来再次出现同类快照红，优先复核是否落在量化中点附近，而非直接加大容差 |
| `watch-command.test.ts` 第 1 个用例的 `expect(elapsed).toBeLessThan(2000)` | **未改动的墙钟断言** | 它断的是 FR-013"启动 2 秒内就绪"这一产品要求，走真实 chokidar；放宽它等于削弱产品断言，故本次**刻意不动** | 真实 CI 该用例在 run 30090377786 中未失败；若未来在高负载 runner 上翻红，应作为独立的"墙钟型 FR 断言"治理项，与链 F 分开处理 |
| `graph-quality:freshness` warn | 预存 | 图产物 sourceCommit 落后 HEAD | 重新建图即消，与本 fix 无关 |
| F220 e2e 依赖下载 all-MiniLM-L6-v2 | 预存网络依赖 | `runAnchorIntegration` 外层有 try/catch，模型不可用时语义边整体缺失 → 快照会以**另一种形态**失败 | 真实 CI 日志显示模型下载成功（否则不会有该浮点值），暂不处理；若未来 CI 出现该类红，属独立的"e2e 网络依赖"治理项 |

**准确表述**：本 fix 使 CI 的六条已知失败链全部闭合，并在本地以"干净树 + Node 20 + `/home/runner` 路径 + 诱饵进程"
复现到可复现的最大程度；**"真实 CI 全绿"必须以推送后的实际 GitHub Actions 运行为准**，本地任何绿都不构成该结论的证明。

## Spec 影响

- 需要更新的 spec：**无需更新**。
- 链 A/B/C 限于 CI workflow 与 npm script 配置，不触及产品行为面。
- 链 D / 链 F 只改测试（断言写法 / 依赖隔离），不触及被测实现；链 F 保留了 FR-010 的 `pgrep` 探测设计不动。
- 链 E 触及产品代码（`edge-builder.ts` 出口量化），但改的是**同一语义值的表示精度**而非语义本身：
  `confidenceScore` 的定义（embedding 余弦相似度作为 INFERRED 置信度）与取值范围（[0,1]）均未变，
  默认路径下游消费方的判定粒度（0.05–0.1 量级）远粗于 1e-4 的量化步长
  （`query-helpers` 的用户自定义 `minConfidence` 是唯一可能在阈值邻域改变边界归属的消费点，见上）。
  既有 spec / 合同无一处约束该字段的小数位数，故无需更新。
