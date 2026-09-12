# F280 verification report — panoramic-query 引擎缓存无失效判据 + 诚实返回面

日期：2026-09-12 　验证者：verify 子代理（独立于 implement）　审查档位：一般生产代码，主线程自审 + 1 独立子代理对抗复审（Codex 暂停期）

> **阅读提示（主线程，2026-09-12）**：本报告 §1–§N 为修补前的验证结论；对抗复审两轮后 `buildPanoramicQueryHonesty` / `getCachedGraphData` / `engine-cache` 均已重写，§1 第 4/5/9 行描述的实现已过期，以文末「附：对抗复审修补后 delta 验证」节为准。

## 0. 验证方法说明

所有结论均**亲自实跑**取得（命令 + 输出见各节）。实验统一在 `/private/tmp/claude-501/f280-verify/` 下进行（`repo-old` 为旧实现整仓副本，仅切回 4 个改动文件为 `HEAD` 版本并删除新增的 `engine-cache.ts`；`repro/ab-test.mjs` 为原病 A/B 复现脚本）。worktree 内**未产生任何未复原的改动**（变异检查后已用 `cp` 还原并重跑绿，`git status --short` 与验证前一致）。

## 1. Layer 1：fix-report 声称逐条对账

| # | fix-report 声称 | 判定 | 证据 |
|---|---|---|---|
| 1 | `src/panoramic/graph/engine-cache.ts` 新增共享 `loadEngineCached`/`clearEngineCache`，mtime+size 复合失效，NUL 分隔 key | ✅实证 | `tests/unit/panoramic/engine-cache.test.ts` 5/5 绿（复用 / size 变 / 同尺寸 mtime 变 / 不同 root 隔离 / 缺文件透传 loadFromFile 错误，见 §2） |
| 2 | graph.json 不存在时不由 stat 的 ENOENT 抢先，交给 `loadFromFile` 抛用户可读错误 | ✅实证 | `engine-cache.ts:32-38` `statSync` 失败时 `catch {}` 直接 `return GraphQueryEngine.loadFromFile(...)`；对应用例见 §2 第 5 例，断言 `/graph\.json|图谱|不存在|ENOENT/` 通过 |
| 3 | `panoramic/qa/index.ts` `getEngine` 改走共享缓存；`clearEngineCache` 改为别名导出，既有调用面不变 | ✅实证 | `git diff` 确认 `import { loadEngineCached, clearEngineCache } from '../graph/engine-cache.js'`；`export { clearEngineCache }`；`tests/panoramic/qa/index.test.ts` 14/14 绿（未改测试文件本身，证明调用面兼容） |
| 4 | `mcp/graph-tools.ts` 删除本地 Map，`getEngine` 改走共享缓存，`reloadGraph()` 转发 `clearEngineCache()`，`getCachedGraphData` 不变 | ✅实证 | `git diff` 确认本地 `CachedEngineEntry`/`engineCache` 已删除；`tests/unit/mcp/graph-tools-cache.test.ts` 6/6 绿（回归对照，语义不变） |
| 5 | `graph-honesty.ts` 新增 `buildPanoramicQueryHonesty`，复用 `getCachedGraphData`+`buildHonestyAnnotation`，图缺席返回 null | ✅实证 | `tests/unit/mcp/panoramic-query-honesty.test.ts` 2/2 绿；见 §2 |
| 6 | `server.ts` panoramic-query handler：仅 `natural-language` 挂 honesty，其余三种 operation 不读图不挂 | ✅实证 | `git diff` 确认 `operation === 'natural-language' ? buildPanoramicQueryHonesty(...) : null`；`tests/unit/mcp-server.test.ts` 19/19 绿（未见其余 operation payload 结构变化断言失败） |
| 7 | 红先行：改前两个新测试文件模块/函数不存在 → 红 | ✅实证 | §3 复现：`repo-old`（HEAD 版本 4 文件 + 无 `engine-cache.ts`）跑新测试 → `engine-cache.test.ts` 加载失败（Cannot find module），`panoramic-query-honesty.test.ts` 2/2 `is not a function` |
| 8 | 既有 `graph-tools-cache.test.ts`（4 例，实测 6 例）回归绿；`qa/index.test.ts`、`mcp-server.test.ts` 绿 | ✅实证（例数以实测为准，非 fix-report 的"4 例"字面值——实际文件含 6 个 it，均绿，不影响结论） | 见 §4 全量命令输出 |
| 9 | 不做：合并 getCachedGraphData 第二次 stat / 其余三种 operation 挂标注 / coverage 维度 | ✅实证 | `git diff` 确认 `getCachedGraphData` 内部仍保留独立 `statSync`（未与 `loadEngineCached` 内部 stat 合并）；`server.ts` 仅 1 处 `buildPanoramicQueryHonesty` 调用点，限定 `natural-language` 分支 |
| 10 | F193 FR-006（`graph-format-stale` 必须上抛而非静默 null）在共享缓存下仍成立 | ✅实证 | §5：`tests/unit/graph/graph-format-stale.test.ts` 7/7 绿（含 MCP 工具经 `getEngine`→`getCachedGraphData` 路径的 FR-006 用例） |

结论：fix-report 全部 10 条声称均**实证**，无 ❌不符 / ⚠️无法验证项。

## 2. 红先行替代证明（旧实现副本上跑新测试）

```
$ cd /private/tmp/claude-501/f280-verify/repo-old   # HEAD 版本 4 改动文件 + 无 engine-cache.ts
$ npx vitest run tests/unit/panoramic/engine-cache.test.ts tests/unit/mcp/panoramic-query-honesty.test.ts
 FAIL  tests/unit/panoramic/engine-cache.test.ts
   Error: Cannot find module '../../../src/panoramic/graph/engine-cache.js'
 FAIL  tests/unit/mcp/panoramic-query-honesty.test.ts (2 tests | 2 failed)
   × 图缺席 → null … → (0 , buildPanoramicQueryHonesty) is not a function
   × 图存在 → freshness 三字段齐全 … → (0 , buildPanoramicQueryHonesty) is not a function
 Test Files  2 failed (2)   Tests  2 failed (2)
```

在当前（新）实现上重跑同样两个测试文件：

```
$ cd .claude/worktrees/f280-panoramic-query-cache
$ npx vitest run tests/unit/panoramic/engine-cache.test.ts tests/unit/mcp/panoramic-query-honesty.test.ts
 ✓ tests/unit/panoramic/engine-cache.test.ts (5 tests)
 ✓ tests/unit/mcp/panoramic-query-honesty.test.ts (2 tests)
 Test Files  2 passed   Tests  7 passed
```

红→绿闭环成立。

## 3. Layer 2：全量目标命令 + lint

```
$ npx vitest run tests/unit/panoramic/engine-cache.test.ts tests/unit/mcp/panoramic-query-honesty.test.ts \
    tests/unit/mcp/graph-tools-cache.test.ts tests/panoramic/qa/index.test.ts tests/unit/mcp-server.test.ts tests/unit/mcp/
 Test Files  20 passed (20)
      Tests  359 passed (359)

$ npm run lint     # tsc --noEmit
> tsc --noEmit
(零错误，零输出)
```

**工具链覆盖面如实说明**：`tsconfig.json` `"include": ["src/**/*.ts"]`，`"exclude"` 显式含 `"tests"`。故 `npm run lint`（tsc）对本次改动的 4 个 `src/` 文件 + 新增 `src/panoramic/graph/engine-cache.ts` **有类型检查覆盖**；对 2 个新增测试文件（`tests/unit/panoramic/engine-cache.test.ts`、`tests/unit/mcp/panoramic-query-honesty.test.ts`）**无类型检查覆盖**（仅 vitest/esbuild transform，不做类型检查）。这是仓库既有边界（`.claude/rules/tests.md` 未要求 tests 过 tsc），非本次改动新增缺口。

## 4. 原病复现 A/B（逐字节复制自 `git show HEAD` 的旧 `getEngine` 闭包逻辑）

由于 `panoramic/qa/index.ts` 的旧 `getEngine` 未导出（仅 `answerQuestion` 公开，且其后续步骤依赖 LLM/embedding 网络调用，不适合作为确定性验证载体），改用**逐字节复制** `git show HEAD:src/panoramic/qa/index.ts` 中 `getEngine` 函数体（含其闭包 `engineCache = new Map()`）到独立脚本，对比新实现 `loadEngineCached`：

```
$ node /private/tmp/claude-501/f280-verify/repro/ab-test.mjs
=== OLD 实现（F280 修复前，MCP 同进程重建图后的原病） ===
第一次加载 nodes: 1 [ 'a.ts' ]
第二次加载（图已重写为 3 节点）nodes: 1 [ 'a.ts' ]
同一 engine 实例？ true
原病复现： YES — 仍是旧图（1 节点），零失效判据坐实

=== NEW 实现（F280 修复后，共享 loadEngineCached） ===
第一次加载 nodes: 1 [ 'a.ts' ]
第二次加载（图已重写为 3 节点）nodes: 3 [ 'a.ts', 'b.ts', 'c.ts' ]
同一 engine 实例？ false
已修复： YES — 拿到新图（3 节点）
```

原病（"MCP 同进程重建图后 panoramic-query 永远拿旧图"）在旧实现上**如实复现**，在新实现上**如实解除**。

## 5. F193 FR-006 回归确认

```
$ npx vitest run tests/unit/graph/graph-format-stale.test.ts
 ✓ tests/unit/graph/graph-format-stale.test.ts (7 tests)
```

含 `impact 在旧绝对格式图上 → error code=graph-format-stale`（经 MCP 工具 `getEngine`→`getCachedGraphData` 完整路径），确认共享缓存接入后 `GraphQueryEngine.loadFromFile` 抛出的 `graph-format-stale` 错误仍未被 `loadEngineCached` 或 `getCachedGraphData` 的 `catch` 静默吞掉、仍按 FR-006 契约上抛。

## 6. 变异检查（mutation testing）

对 `src/panoramic/graph/engine-cache.ts` 的失效判据做定向变异（`hit.mtimeMs === mtimeMs && hit.sizeBytes === sizeBytes` → 恒 `hit !== undefined`，即恒命中忽略 mtime/size），跑 `engine-cache.test.ts` + `graph-tools-cache.test.ts`：

```
$ npx vitest run tests/unit/panoramic/engine-cache.test.ts tests/unit/mcp/graph-tools-cache.test.ts
 FAIL tests/unit/mcp/graph-tools-cache.test.ts > stale: size 变化触发 reload
 FAIL tests/unit/panoramic/engine-cache.test.ts > graph.json 内容重写（size 变）→ 重新加载
 FAIL tests/unit/panoramic/engine-cache.test.ts > size 不变但 mtime 变（同尺寸重写）→ 重新加载
 Test Files  2 failed (2)   Tests  4 failed | 7 passed (11)
```

4 个失效相关用例全部转红，确认测试对失效判据有真实承重（非"零执行副本"假测试）。已用 `cp` 还原原文件，重跑确认恢复绿：

```
$ npx vitest run tests/unit/panoramic/engine-cache.test.ts tests/unit/mcp/graph-tools-cache.test.ts
 Test Files  2 passed (2)   Tests  11 passed (11)
```

`git diff --stat src/panoramic/graph/engine-cache.ts` 还原后为空（字节级恢复，无残留改动）。

## Layer 1.5：验证铁律合规

**状态：COMPLIANT**

- 缺失验证类型：无（构建/测试/Lint 均已亲自执行并附命令+输出）
- 检测到的推测性表述：无（implement 侧 fix-report 未见 "should pass" 类未经验证的完成声明；本报告全部结论均附实跑命令与输出片段）

## 7. 残余风险（如实登记）

- `graph-tools-cache.test.ts` 实际 6 例（fix-report 写"4 例"），例数口径不影响回归结论，但登记以防后续误读。
- 变异检查仅针对 `mtimeMs`/`sizeBytes` 双字段判据的"恒命中"方向；未逐一测试"恒 miss"方向（该方向失败模式为性能退化而非正确性缺陷，且会被 `e1 === e2` 类断言以外部方式暴露，风险等级低，未纳入本次变异范围）。
- `answerQuestion` 完整 pipeline（含 LLM/embedding 调用）未被本次 A/B 复现直接驱动（该路径需真实网络凭据，超出确定性验证范围）；缓存失效本身已在 `loadEngineCached`/`getCachedGraphData` 层完整覆盖，`qa/index.ts`、`graph-tools.ts` 均已确认改走共享入口（§1 第 3/4 条），故该风险主要是"未走到底"而非"底层判据不可信"。
- Codex 对抗审查处于暂停期（配额耗尽），本次审查档位为"主线程自审 + 1 独立子代理对抗复审"（一般生产代码类别，非门禁/判定器类，按 CLAUDE.local.md 约定不要求异构对抗常设档位）。

## 总体结论：✅ READY FOR REVIEW（PASS）

- Layer 1（Spec-Code 对齐）：10/10 fix-report 声称实证，0 未实现，0 部分实现
- Layer 1.5（验证铁律）：COMPLIANT
- Layer 2（原生工具链）：build 隐含于 `npm run lint`（tsc --noEmit）零错误；测试 20 文件 / 359 用例全绿；lint 覆盖 src 改动面，tests 目录如实标注未覆盖
- 原病 A/B：已复现且已解除
- 变异检查：判据承重确认
- F193 FR-006：回归确认无损

## 附：对抗复审修补后 delta 验证（2026-09-12）

验证者：独立 verify 子代理（第二轮，独立于 implement 与两轮对抗复审）。对象：fix-report §2 / §3 / §7 在两轮对抗复审修补（C-1 / W-1 / W-2 / W-A / W-B / I-*）之后的声称。上面各节是修补前的结论，本节只追加、不改动。**默认先找假绿 / over-claim**，所有结论均亲跑取得，命令与关键输出随附。

### 0. 方法说明

- 工作树：`.claude/worktrees/f280-panoramic-query-cache`（`280-panoramic-query-cache-freshness`，HEAD `00684522`，改动未 commit）。工作树内只跑只读命令 + Layer 2 门禁；**未做任何 git 写操作**；验证前后 `git status --short` 逐行一致（7 M + 5 ??），`git diff HEAD --stat` 仍为 `7 files changed, 113 insertions(+), 107 deletions(-)`。
- 副本目录：`scratchpad/verify-f280-delta/`
  - `head/`：`git -C <worktree> archive HEAD | tar -x` 得到的 **HEAD 版**（无未提交改动、无 `engine-cache.ts`，已确认 `test -f … engine-cache.ts → no`），`node_modules` 软链到主仓，拷入 wiring 测试文件。用于红先行替代证明。
  - `work/`：`rsync -a --exclude .git --exclude node_modules --exclude dist` 的**当前改动态副本**，10 个改动/新增文件逐一 `diff -q` 与工作树字节一致。所有变异只在此副本做，每组变异后 `cp` 自工作树还原并 `diff -q` 复核，最后基线重跑 18/18 绿。
- 副本内 vitest 加 `SPECTRA_TEST_SKIP_DIST_BUILD=1`（三个目标测试文件直接 import `src/`，不消费 dist）；工作树内 Layer 2 门禁**不加**该开关，global-setup 实际判定 `dist/ 已是最新（输入指纹匹配），跳过 npm run build`。

### 1. Layer 1：fix-report 修补后声称逐条对账

#### 1.1 §2 五条修复点

| # | 声称 | 判定 | 证据 |
|---|---|---|---|
| §2.1 | 新增 `engine-cache.ts`：`loadEngineCached` 每次 stat、mtime+size 复合失效、NUL key；缺文件交给 `loadFromFile` 抛错 | ✅实证 | 文件存在（`?? src/panoramic/graph/engine-cache.ts`）；`engine-cache.test.ts` **7/7** 绿；stat 先于 load（L63→L80）；`tryStat` 失败不抛、交 `loadFromFile`（L64-68）；缺文件用例钉 `/无法读取图谱文件[\s\S]*请先运行/`（测试 L118），与 `graph-query.ts` L322-324 文案一致 |
| §2.2 | `qa/index.ts` `getEngine` 改走共享缓存；`clearEngineCache` 别名导出 | ✅实证 | diff：`import { loadEngineCached, clearEngineCache, toGraphEvidence, type CachedEngine } from '../graph/engine-cache.js'`；`export { clearEngineCache }`（L53）；`getEngine` 返回 `CachedEngine`（L45-50）；`tests/panoramic/qa/index.test.ts` 绿（Layer 2 在列） |
| §2.3 | `graph-tools.ts` 删本地 Map，`getEngine` 走共享缓存，`reloadGraph` 转发，`getCachedGraphData` 改为 `existsSync` 前置后直接 `toGraphEvidence(loadEngineCached(...))`、**不再另行 stat** | ✅实证，**但与 plan.md 冲突（见 §6 残余 2）** | diff：`CachedEngineEntry`/`engineCache` 删除；`import { existsSync } from 'node:fs'`（`statSync` import 已删）；`reloadGraph(){ clearEngineCache(); }`；`getCachedGraphData` 体内无 `statSync`。⚠️ `plan.md` 末行「不做：合并 getCachedGraphData 的二次 stat」与本条相反；上文既有报告 §1 第 4 行「getCachedGraphData 不变」、第 9 行「仍保留独立 statSync」描述的是修补前状态，**对当前代码已失效** |
| §2.4 | `graphEvidence` 随三条成功 return 带回、加载失败路径不带；`honestyInputs` 不进 `data`；`buildPanoramicQueryHonesty` 只用传入 inputs、不自己加载图；lib 不再 import graph-tools；`HonestyAnnotationParams.graph: LoadedGraphEvidence` | ✅实证 | `qa/index.ts` L140 / L193 / L256 三处 `graphEvidence,`，L108-114 graph-insufficient 回退无；`query.ts` L82-85 `honestyInputs` 在 `data` 同级而非其内；`graph-honesty.ts` L846-859 只读 `inputs.graph`；`grep -n "graph-tools" src/mcp/lib/*.ts` 无 import 命中（仅 tool-response.ts 一行注释）；L23-24 两处均 `import type`；L262 `graph: LoadedGraphEvidence` |
| §2.5 | `server.ts` 仅 `natural-language` 挂 honesty，合并进 payload；描述 Output 补 `honesty` | ✅实证 | `server.ts` L380-387；L342 `Output: { answer, citations, tokenUsage, honesty }`；`description-output-drift.test.ts` TRUTH 含 `'honesty'`，该测试在 Layer 2 绿 |

#### 1.2 §3 红先行声称

| 声称 | 判定 | 证据 |
|---|---|---|
| `engine-cache.test.ts`「5 例」 | ⚠️**计数漂移**（实际 7 例，多出「条目元数据 = 那次 stat」与「不可 stat 却可 load」两例，均为 delta 修补新增）；红先行本身成立（HEAD 副本无该模块，既有报告 §2 已实证 Cannot find module） | `grep -c "^  it(" → 7` |
| `panoramic-query-honesty.test.ts`「5 例」 | ✅ 实际 5 例 | `grep -c → 5` |
| wiring「handler 级 5 例 … 修补前 4 红 + 1 绿（缓存收敛本体）… 修补后 5/5 绿」 | ⚠️**计数漂移**（实际 **6** 例：delta 复审 W-B 补了 rag-only 一例，现 6/6 绿）；「修补前」是**未入 git 的中间态**，无法从历史直接复现，改用两种方式核验（下） | `grep -c → 6`；工作副本基线 `6 tests` 绿 |
| ↳ 核验 A：**纯 HEAD 版**跑 wiring（原病端到端复现） | HEAD 上 **5 红 / 1 绿**，绿的是 C-1（HEAD 无 honesty，其断言天然成立）；**「缓存收敛本体」在 HEAD 上为红**：第二问仍答 `LLM-OK` 而非 `图谱为空`——原病经真实 handler→query→qa→engine 链路复现（比上文 §4 的闭包拷贝 A/B 更强） | `head$ SPECTRA_TEST_SKIP_DIST_BUILD=1 npx vitest run tests/unit/mcp/panoramic-query-honesty-wiring.test.ts` → `Tests 5 failed \| 1 passed (6)`；本体用例 `expected '[注意：本答案无引用…]\n\nLLM-OK' to contain '图谱为空'` @L169 |
| ↳ 核验 B：**M1+M2 叠加**近似「修补前」形态（resultsEmpty 硬编码 false + honesty 自己二次加载） | **5 红 / 1 绿**，绿的正是「缓存收敛本体」，红 = C-1 / W-2×3 / W-1；扣除 W-B（当时不存在）即 4 红 1 绿，与 fix-report 声称**一致** | 见 §3 变异表 M1+M2 行 |
| 既有 `graph-tools-cache.test.ts` / `qa/index.test.ts` / `mcp-server.test.ts` 绿 | ✅实证 | Layer 2 在列（`graph-tools-cache` 6 例、`mcp-server.test.ts` 在 34 文件清单内）；另单跑 `graph-format-stale.test.ts 7 + graph-tools-cache.test.ts 6 = 13 passed` |

#### 1.3 §7 两轮处置表——每一「修」字项是否落地

| 项 | 处置声称 | 落地判定 | 证据（diff 位置 / 变异验证） |
|---|---|---|---|
| C-1 | honesty 只绑定 QA 带回的图、不二次加载；handler 级回归钉住 isError/code/fallbackMode | ✅ | `graph-honesty.ts` L846-859 无加载调用；wiring C-1 用例 L107-117；**M2 变异该用例转红 @L112** |
| W-1 | `graphEvidence` 取自产出答案的 engine 条目；LLM mock 内重写图仍 `recordedSourceCommit === 'A'` | ✅ | wiring W-1 L150-160；helper L64-71；**M2 变异两者转红 @L159 / @L70** |
| W-2 | `resultsEmpty = citations.length === 0` 由 caller 传参；两种零引用形态覆盖 | ✅ | `query.ts` L84；wiring L119-138；**M1 变异三例转红 @L128/137/147** |
| I-2 | graph-tools.ts 头注释清理 | ✅ | diff：旧「Feature 155 T-002 升级…Map<projectRoot, Engine>」段已替换为「共享 engine-cache…」 |
| I-3 | 描述 Output + drift TRUTH 补 `honesty` | ✅ | `server.ts` L342；drift 测试 L150 |
| W-A | NaN 身份 → 每次唯一负数；测试钉「负且唯一 + 模板键不等」 | ✅ | `engine-cache.ts` L52 / L71 `-(++unidentifiedLoadSequence)`；测试 L93-112；**M4 / M4b / M4c 三向变异均转红**（§3） |
| W-B | wiring 补 rag-only 用例 | ✅ | wiring L140-148；**M3b 删 rag-only 路径 `graphEvidence` → 恰好只此一例转红 @L146**（守护确有牙、且无其他用例冗余覆盖） |
| I-1（delta） | 注释改口「零引用」而非「零图证据」 | ✅ | `query.ts` L25-28 |
| I-3（delta） | 缺文件用例钉 loadFromFile 特有文案 | ✅ | 测试 L117-118 正则含 `请先运行`（statSync 原生 ENOENT 消息不含该词） |
| I-2 / I-4 / I-5（delta） | 登记不做 | ✅如实 | 代码中无对应改动；I-5 残余由 §5 探针实证仍在（见残余 3） |

### 2. Layer 2：门禁

```
$ npx tsc --noEmit -p tsconfig.json          → exit=0（零输出）
$ npm run lint                                → exit=0（tsc --noEmit）
$ npx vitest run tests/unit/mcp tests/unit/panoramic tests/panoramic/qa tests/integration/mcp-honesty-envelope.test.ts
[global-setup] dist/ 已是最新（输入指纹匹配），跳过 npm run build
 Test Files  34 passed (34)
      Tests  612 passed (612)
   Duration  1.42s                             → exit=0
$ npx vitest run tests/unit/graph/graph-format-stale.test.ts tests/unit/mcp/graph-tools-cache.test.ts
 Test Files  2 passed (2)   Tests  13 passed (13)   （F193 FR-006 在合并 stat 后的 getCachedGraphData 上仍上抛）
```

34 个文件清单已核对，含 `mcp-server.test.ts`、`mcp-graph-honesty.test.ts`、`description-output-drift.test.ts`、`graph-tools-cache.test.ts`、`panoramic-query-natural-language.test.ts`、`qa/index.test.ts`、`mcp-honesty-envelope.test.ts` 与三个新增文件。工具链边界与上文 §3 相同：`tsconfig.json` exclude `tests`，三个新增测试文件不过 tsc（仓库既有边界）。

### 3. 变异抽查（全部在 `work/` 副本，逐组 `cp` 还原 + `diff -q` 复核）

| # | 变异 | 结果 | 被哪个用例 / 断言抓住 |
|---|---|---|---|
| M1 | `query.ts` `resultsEmpty: citations.length === 0` → `false` | 🔴 3 failed / 8 passed (11) | wiring W-2 三例：canned 零结果 @L128、LLM 无引用 @L137、rag-only @L147（`resolutionOmitted` 缺席）。helper 级 5 例不受影响（它直接传 resultsEmpty） |
| M2 | `graph-honesty.ts` 加 `import { getCachedGraphData } from '../graph-tools.js'`，`buildPanoramicQueryHonesty` 改为 `const graph = getCachedGraphData(projectRoot)` 二次加载、忽略 `inputs.graph` | 🔴 3 failed / 8 passed | wiring C-1 @L112（stale 图二次加载上抛 → withTelemetry 兜底成 `internal-error`，`isError` 翻转）、W-1 @L159（读到图 B）、helper「不重新读盘」@L70（读到 `BBBBBB`）。注：helper「图缺席 → null」用例在 M2 下仍绿（`/nowhere` 走 existsSync=false），该用例不守 C-1 |
| M3b | `qa/index.ts` 删 rag-only return 的 `graphEvidence,`（其余两处保留，`grep -c` 由 2 → 1 确认） | 🔴 **恰 1** failed / 10 passed | 仅 wiring rag-only（W-B）@L146 `honesty?.freshness` undefined。实证 delta 复审补的守护单独承重（删前「184/184 仍绿」的盲区已闭合） |
| M4 | `engine-cache.ts` `const identity = -(++unidentifiedLoadSequence)` → `Number.NaN` | 🔴 1 failed / 6 passed | 「不可 stat 却可 load」@L102（`Number.isFinite(mtimeMs) && < 0`）——**先于**模板键断言触发 |
| M4b | 身份改常量 `-1`（能过「有限且负」） | 🔴 1 failed | 同用例 @L105（`e2.mtimeMs not.toBe e1.mtimeMs`，彼此不等） |
| M4c | NaN + 测试副本删 L102-105，隔离模板键断言 | 🔴 1 failed | 模板键断言（原 L107，删后 L103）：`"NaN::NaN"` 与 `"NaN::NaN"` 相等 → `not.toBe` 失败。**证明该断言单独有牙**，不是靠前面四行陪跑 |
| M1+M2 | 叠加，近似「修补前」 | 🔴 5 failed / 1 passed | 见 §1.2 核验 B |
| 还原后 | 三文件基线 | ✅ 18/18 passed；10 文件 `diff -q` 全 same | — |

### 4. W-A 复核（读码 + 变异）

- `src/knowledge-graph/query-helpers.ts` L499-508 `buildAdjKey` = `` `${graphPath}::${mtimeMs}::${sizeBytes}::${linksLength}::${relations}::${direction}` ``——字符串模板键。NaN 会把两份不同图撞成同一 `…::NaN::NaN::…`；改为每次唯一负数（-1, -2, …）后同 graphPath 的两次未识别加载键必不同。消费链：`agent-context-tools.ts` L223/L271、L611/L691 由 `getCachedGraphData` 的 `LoadedGraphEvidence.mtimeMs/sizeBytes` → `bfsTraverse(graphMtimeMs, graphSizeBytes)` → `getReverseAdjacency`（L609）；另一消费方 `graph-honesty.ts` L373 按 `===` 比对，负数唯一同样恒 miss（宁可重算）。
- `unidentifiedLoadSequence` 分支可达条件（`engine-cache.ts` L63-75）：`tryStat` 返回 null **且** `loadFromFile` 成功 **且** `late = tryStat` 再次 null——三者同时满足才到 L71；`late` 非 null 时走 `register` 入缓存。生产两条入口：graph-tools 侧 `existsSync` 前置（存在但 stat 失败而 read 成功，实际只剩测试替身）；qa 侧无前置，stat 失败通常等价 read 失败 → `loadFromFile` 抛 → `graph-insufficient` 回退。结论：该分支生产不可达，与 fix-report「潜伏，非生产可达」表述一致。
- 碰撞面补充：未识别条目**不入** `engineCache`；`sizeBytes` 取负数，真实 `stat.size ≥ 0`，故与任何真实条目在三处消费方上均不可能相等。无残余碰撞。

### 5. 序列化面复核

探针测试（副本内临时文件，跑完即删，不入工作树）用与 wiring 相同的 mock 走真实 handler，打印键集并断言序列化文本不含 `honestyInputs` / `graphEvidence` / `graphData` / `engine` / `rawGraph`：

```
[PROBE ok]    payload keys = ["answer","citations","tokenUsage","durationMs","honesty"]
[PROBE ok]    honesty keys = ["freshness","resolutionOmitted"]        text length = 395
[PROBE ok]    query result keys = ["ok","data","honestyInputs"]       query data keys = ["answer","citations","tokenUsage","durationMs","fallbackMode"]
[PROBE stale] isError = undefined   payload keys = ["answer","citations","tokenUsage","durationMs","fallbackMode"]   （无 honesty）
 Tests  2 passed (2)
```

- MCP：`server.ts` L385-388 只 `JSON.stringify(payload)`，payload = `{...result.data, honesty}` 或 `result.data`，`honestyInputs` 不在其中 ✓。
- CLI：`src/cli/commands/panoramic.ts` L41 / L46 只 `JSON.stringify(result.data, …)` ✓（CLI 帮助文案本就只列三种非 NL 操作，与本卡无关）。
- `answerQuestion` 在 `src/` 内唯一调用方是 `query.ts` L67；`QnAAnswer.graphEvidence` 只被 `query.ts` L83 消费，未进 `data` ✓。
- 如实登记：`honestyInputs` 是 query 返回对象上的**可枚举**属性（探针 `["ok","data","honestyInputs"]`），其 `graph.graphData` 是整图引用——任何未来对整个 result 做 `JSON.stringify` 的消费方会把整图打出去。这正是 fix-report delta I-5 登记项，当前两处消费方都只序列化 `data`，风险未被行使。

### 6. tasks.md 对账

| 任务 | 判定 | 备注 |
|---|---|---|
| T001 红先行 7 例（改前红） | PASS | 「7 例」为初版口径；现三文件共 7 + 5 + 6 = 18 例（计数漂移，见残余 1）。HEAD 副本 wiring 5 红 1 绿、既有报告 §2 的两文件模块缺失红均成立 |
| T002 engine-cache.ts 共享缓存 | PASS | §1.1 §2.1；M4 系列变异承重 |
| T003 qa/index.ts 接入 + 别名导出 | PASS | §1.1 §2.2 |
| T004 graph-tools.ts 接入 + reloadGraph 转发 | PASS（附 plan 漂移） | §1.1 §2.3：实现比 plan 多做了「合并二次 stat」，plan.md「不做」行须改口 |
| T005 buildPanoramicQueryHonesty + server.ts 挂接 | PASS | §1.1 §2.4-2.5；M1 / M2 / M3b 承重 |
| T006 目标测试全绿 + tsc 零错误 | PASS | §2：34 文件 612 例 + tsc/lint 双零 |
| T007 独立子代理对抗复审 | **已完成** | fix-report §7 两轮（首轮 1C/2W/3I，delta 0C/2W/3I），全部「修」字项落地实证（§1.3） |
| T008 verify 子代理 verification-report.md | **本节** | — |
| T009 全量门禁 | 未到 | 本节只跑目标集合 + tsc/lint；`npx vitest run` 全量 / `npm run build` / `repo:check` / `release:check` 未跑 |
| T010 rebase master → ff push → 删分支 | 未到 | 事实：`master`（`7615c82a` F282）已领先本分支 1 个 commit（`git log HEAD..master`），交付前必须 rebase 重验 |

### 7. 总结论：✅ PASS（修补后 delta 声称全部实证，0 项不符）

- Layer 1：§2 五条 5/5 实证；§3 红先行成立（HEAD 端到端复现原病 + M1+M2 重建「修补前」与声称一致）；§7 两轮 11 个处置项逐一落地，其中 8 个「修」字项各有 ≥1 条变异证明守护承重。
- Layer 2：tsc / lint 双零；目标集合 34 文件 612 例全绿；F193 FR-006 回归无损。
- 变异：7 组全部转红、逐组还原复核；M3b 证明 delta 新增守护单独承重、M4c 证明模板键断言单独承重。
- 序列化面：MCP / CLI 两条出口均只序列化 `data`（+ honesty），探针实证不含 `graphData`。

残余风险（如实登记，均不构成阻塞）：

1. **计数漂移**：fix-report §3「engine-cache 5 例」「wiring 5 例 / 5/5 绿」与 tasks T001「7 例」均为修补前口径，实际 7 / 6 / 18；建议 commit 前改口，避免后续按字面核对时误判为缺测试。
2. **plan ↔ 实现漂移**：`plan.md`「不做：合并 getCachedGraphData 的二次 stat」被实现推翻（合并是 W-1 的修法，已经过 delta 对抗复审 0C），上文既有报告 §1 第 4 / 5 / 9 行对应描述已过期。建议在 plan.md 该行加一句「（对抗复审 W-1 后改为合并，见 fix-report §2.3）」，否则 plan 与代码互相矛盾。
3. **I-5**：`honestyInputs` 可枚举、持整图引用；当前两处消费方只序列化 `data`，风险未行使；`enumerable:false` 候选已登记 M11。
4. **I-2 / I-4**：stat→load 顺序与 `getCachedGraphData` 单步两条竞态不变量无测试；NL 守卫（server.ts `operation === 'natural-language'`）与 helper 内 `inputs === undefined` 双重编码——均已登记不在本卡扩面。
5. 同 mtimeMs + 同 size 重写不可见（I-1，收敛前后口径一致，非本卡引入）；`honestyCache` 无界（F266 既有）。
6. 三个新增测试文件不过 tsc（仓库既有 `exclude: tests` 边界）。
7. 审查档位：一般生产代码（非门禁 / 判定器类），主线程自审 + 独立子代理两轮对抗 + 本 verify；Codex 暂停期，不要求异构常设档位。
8. T009 全量门禁与 T010 rebase（master 已领先 1 commit）尚未执行，不在本节范围。
