# 实现进度快照 — F276 卡 C

> 本文件**覆盖写入**（不是流水账），每完成一个 Phase 刷新一次。
> 恢复方只需读本文件即可知道「下一步动哪个文件、有哪些已知偏差」。

## 当前 Phase

**Phase 4 审查修补中 / 共 4 个 Phase（C1 → C2 → C3 → Final）**。
C1+C2 已提交 `5bb8526b`、C3 已提交 `7c7cb8ed`；当前在做 Phase 4a（spec-review）/ 4b（quality-review）
两份报告的修补，全部为注释 / 文档 / 测试覆盖 / 1 行消毒，**零判定语义改动**（本轮修补**未 commit / 未 add**）。

> 下方各 Phase 段落保留其完成当时的快照口径（"未 commit"等字样按写作时点理解），
> 提交状态以本节为准。

## 已完成任务 ID

`T001–T032`（全 32 条）。其中：
- `T006` C1 异构对抗审查已执行（2 个独立子代理 × 误伤面/绕过面两个切入角），结论见下「已知偏差」3、4。
- `T023` 实为 **no-op**（P-1 用例从未落地）。
- `T031` 变异实验 10 条全部实跑，另加计划外 M-13，日志见
  `specs/276-fix-compliance-p0a-residue/verification/mutation-log.md`。

## 下一步

`T033` C2 异构对抗审查（2 个独立子代理，切入角：误伤面 / 绕过面）→ 通过后 C1/C2 提交
（**提交顺序硬性 C1 → C2 → C3**；本次两 Phase 的改动混在同一工作树里，拆提交时按文件/hunk 分）
→ `T034–T040` Phase C3（删 `routeNonBlock` 死代码）。

## 验证事实（本次实跑）

| 项 | 结果 |
|---|---|
| `npm run test:plugins` | **1721 tests / 1719 pass / 0 fail / 2 skipped**（HEAD 基线 1688/1686/0/2，净 **+33**）|
| 逐文件计数核对（vs `git archive HEAD` 快照） | core +12、io +3、judge-cli +15、f270-real-corpus +3 = **+33** ✓ |
| schema enum | 27 → **28**（`node -e` 读 `properties.diagnostics.items.enum.length` 机械核对）|
| **E-c 承重对照组 A/B**（存储可用面） | HEAD vs 改动后**同窗口实跑**：退出码序列 `2,2,0` 相同、三次 stderr **sha256 逐条相同**、审计事件序列与 `diagnostics` 集合相同、终态记录条数相同 |
| **E-e A/B**（单级失败走回落面） | 同上逐字相同，且回落状态文件内容（剔 `updatedAt`）逐字相同 |
| 锚点污染核验（**整条 stderr**，不止 `buildFeedbackText`） | `SKILL_EXPANSION_REGEX` 0 命中 / `ARTIFACT_PATH_REGEX` 0 命中 / `FIX_DIR_NAME_REGEX` 行级 0 命中 |
| 变异实验 | M-1/M-2/M-3/M-4/M-6/M-7/M-8'/M-10/M-11/M-12 **逐条实跑**，各自点名的守护用例全部变红；M-11 只杀 E-m、M-8' 只杀 E-p、M-12 只杀 U-7（承重点唯一性实证）|

## 已知偏差

### 1. `tryWriteState` 被 `writeStateOrThrow` 取代（plan §4 C1 第 2 条要求「签名不变」）

原 `tryWriteState` 自己 `catch` 掉 fs 错误并返回 `boolean`，`saveBlockState` 在其外层包 try/catch
**捕获不到任何东西**——plan 描述的「在 `saveBlockState` 内两处 try/catch 收集 errno」在原结构下不可实现。
处置：私有原语改为抛出式 `writeStateOrThrow`（仍私有、非 export、原先仅 2 个调用点、全仓无其它引用），
`saveBlockState` 两处 try/catch 收集。R4-10 的实质诉求（**不外扩签名**）已满足；成功分支返回对象逐字不变
（U-4 第 3 条 + E-c/E-e 的 A/B 对拍双重钉住）。保留布尔版会变成零调用点死代码。

### 2. `T023`「删除 P-1」是 no-op

`f270-real-corpus.test.mjs` 里从来没有扫 `~/.claude/projects/**/*.jsonl` 的用例。
一手实证（324 份 jsonl / 29 条命中 / 形态 29/29 一致）已按计划写进 `core.test` 的 U-3 注释。

### 3. 🔴 **CRITICAL（来自 C1 绕过面对抗审查）：自注册 Stop hook 可投喂计数器，且 plan §8 ⑧ 的成本论据被质疑**

- **机制已由对抗审查用真 judge CLI 端到端跑通**：harness 写的回灌条目正文形如
  `Stop hook feedback:\n[<hook command>]: <hook stderr>`——**前缀由 harness 代写**、
  `<hook command>` 取自**注册方自选**的命令串。故被判方自注册一条 exit 2 的 Stop hook
  （token 藏在 command 串里即可，stderr 一个字都不用写）即可同时满足计数器谓词的全部四个条件；
  「审查 hook stderr 内容」这类补防对此**无效**。
- **该面属 plan §8 ⑧ 已登记残余**，plan 明确裁决「**按残余登记、不追加防线**」，故**本卡不修**。
- 🔴 **但其成本论据已被质疑且未澄清**：plan §8 ⑧ 写「成本 = 重启 + N 次 Stop 往返（hook 配置启动快照，
  会话中途不生效——**与 ① 补救口 ③ 同一事实**）」。对抗审查给出 CLI 二进制里的 settings 文件 watcher
  热重载代码路径 + 官方文档两条同向证据，指出 **hook 配置会被 watcher 热重载**；
  且 plan 把「hook 配置」与「hook 进程 env」当成同一事实，而**后者为真不蕴含前者为真**
  （env 确是进程启动快照，stderr 补救口 ③ 的措辞不受影响）。
  ⚠️ 审查方**未能实跑坐实**（本机 OAuth 过期，起不了 headless 会话）。
- **本卡处置**：不改判据（追加防线属 plan 明确否决的范围，且审查方提出的
  「label 必须逐字等于已知 hook command 集合」判据自身**未实现未测**）；
  改为把 `countStorageUnavailableBlockFeedback` / `routeStorageUnavailable` 两处**过度声称的注释**
  改写为如实口径（明写"挡不住 hook 回灌通道""成本论据未澄清，须回设计层裁决"）。
  **须由设计层裁决是否接受**，不得当作已澄清。

- ✅ **主编排器裁决（2026-09-03）：接受为残余，不追加防线，成本论据按下述口径改写**：
  反馈条目**只在某个 Stop hook 真正 exit 2 时**由 harness 写入（324 份语料 29/29 全来自 exit 2，0 条来自 exit 0）。
  因此被判方经自注册 hook 投喂的每一条反馈都**必然伴随一次自己被阻断的 Stop 往返**——
  热重载与否只改变「是否需要重启」这一**准备成本**，不改变「每条计数 = 一次往返」的**地板**；
  它能做的只是把往返**预付**到合规期（先被自己的 hook 拦 2 次，再弄坏存储），总往返数仍 ≥2，
  且 `latest` 基线下任何一次新的 fix 展开都会把预付作废。
  真正能把地板压到 1 的只有「harness 对同周期多个阻断 hook 拆成多条条目」这条**无样本**未知（绕过面 INFO ④），
  保持移交 handoff。plan §8 ⑧ 与两处注释按此口径同步（去掉「启动快照」作为成本依据，改为「每条 = 一次往返」）。

### 4. WARNING 级处置（C1 两路对抗审查）

| 编号 | 内容 | 处置 |
|---|---|---|
| 误伤面 W-1 | 形态实证注释称「六个版本 29/29 一致」属实，但语料里还有更新的 **2.1.255+** 且**零命中样本**——谓词形态在当前实际在跑的 harness 版本上从未被观测 | ✅ **已修**：注释补上覆盖面缺口（主线程独立复扫核实：324 份 / 29 条 / 形态全一致 / 版本集完全对上）|
| 误伤面 W-2 | 反馈计数不随存储恢复复位 ⟹ 同段内付满 2 次后对本分支持有可复用免检权 | ✅ **已登记**（`routeStorageUnavailable` JSDoc 残余 2）。这与 plan §8 ⑨「同段内 reset 不对称」同一面、plan 已裁决接受；审查方的 0 往返 PoC 用**手写 transcript 条目**构造，属已接受的 ⑤ 下界 |
| 误伤面 I-1 | 冻结的错误对象让 `Object.defineProperty` 抛 TypeError ⟹ `path/stage/code` 三字段一起变 `null`，把唯一要产出的诊断信息静默销毁（生产不可达）| ✅ **已修**：`markWriteStage` 包 try/catch，失败时按原对象返回、只丢 `stage`（实跑核验：冻结错误下仍拿到 `{path:'/frozen/path',stage:null,code:'EFROZEN'}`）|
| 绕过面 W-1 | `err.path` 零消毒 → 单行渲染里一个换行就能长出伪造行（实测可冒充 `GATE_DEGRADED_PREFIX_LINE`）| ✅ **已修**：新增 `renderPathSegment` 把 C0/DEL 折成可见转义形；新增回归钉 **E-q**，并用变异 **M-13** 实证其守护力。可达性如实登记：该段当前只来自 `projectRoot` 与启动快照 env |
| 绕过面 W-2 | 基线守卫放行负数（显式传 `-1` ⟹ 窗口张到全 transcript），建议收成 `Number.isInteger(x) && x >= 0` | ❌ **不改，登记**：plan §5 P-2（R6-4）**明确要求**「数字基线（含 `-1`）⟹ 计其后全部条目」是纯函数合同的另一半，并写死 `-1` 来钉它；收紧会与 P-2 直接冲突。生产侧 `latestFixLineIndex` 只可能是 `null` 或 `≥0`，负数不可达。防"照抄 `-1`"由 U-7 注释 + M-12 变异守住 |
| 绕过面 INFO ④ | 多个 hook 同周期 exit 2 时 harness **拆成多条** entry（二进制代码读出，本机 909 份语料**零样本**无法实测）。若属实，被判方多注册一个 hook 即可让每回合产 2 条 ⟹ 上界再对折 | ❌ **登记移交**（plan §8 ⑧ 已把「是否合并」列为无样本未知并移交 handoff；本轮把"读代码得到的倾向性证据"一并交出，仍**不是实测**）|
| 误伤面 I-3（旁观） | 删掉 `fix-compliance-core.mjs` 里 **`detectFixSkillExpansion`** 的 `role !== 'user'` 判据，全套 671 用例仍全绿 | ❌ **超出本卡范围，登记**：这是**既有代码**的守护缺口（不是本卡引入），建议另开卡 |
| 误伤面（旁观） | 写失败会把状态文件留在 **0 字节**（非原子覆写），`loadBlockState` 容错跳过不炸但 blockCount 被静默归零 | ❌ **改动前后一致、非本 diff 引入**，登记——恰好撞在本分支主题（atomic-write-defects）上 |

### 6. C2 审查修补引入的 4 处对 plan 明文条款的偏离（4a spec-review W-2 要求登记；依据 `verification/implementation-adversarial-c1c2.md`）

- ① `routeBlock` 第 5 参改为**有默认值** + 非有限数归 0（plan §4 C2 第 2 条/T028 写「无默认值」）——IW-1：`main` 顶层 `catch { return 0 }` 会把 TypeError 兜成放行，"无默认值＝忘传即炸"方向反了；改后忘传 ⟹ 阻断（fail-closed）。
- ② io `errors[]` 新增 `blocker` 字段、stderr ① 的删除对象改由「挡路对象」指定（plan R7-7 写「只允许指向上行 `@` 后那一个文件」）——IW-2/IM-1：`ENOTDIR` 下 `err.path` 是不存在的目标，唯一正确动作恰被禁止；`blocker` 零判定消费。
- ③ `renderPathSegment` 消毒集扩至 C1/LS/PS/零宽/双向控制/BOM + 512 截断（plan 只要求 C0）——IL-1。
- ④ 计划外用例 E-r / E-s(a,b,c) / E-q′（各钉 ①②③）。

### 6.1 4a / 4b 审查修补（本轮，共 11 项；依据 `verification/spec-review-report.md` 与 `verification/quality-review-report.md`）

零判定语义改动，逐项：① 4a-W1 两处成本论据 JSDoc 改为已落裁决口径（每条反馈 = 一次自我阻断往返）；
② 4a-W5 stderr ② 的 `projectRoot` 过 `renderPathSegment`；③ 4b-W1 `buildStorageUnavailableFeedback` /
`renderPathSegment` 两段 JSDoc 归位到各自函数紧前 + `PATH_SEGMENT_RENDER_LIMIT` 单列 why；
④ 4a-INFO6 / 4b-W2 两处类型补 `blocker:string|null`；⑤ 4a-INFO7 `routeStorageUnavailable` 补 FR-046 认领点
（并标注 plan 与 F270 spec 的点号不同源）；⑥ 4b-INFO6 `renderPathSegment` 改先截原串再转义（E-q′ 断言同步为
512+2×5=522 + 无残片钉）；⑦ 4b-W5 `findPathBlocker` 导出并补 6 条直调探针（含正向对照）；
⑧ 4b-W4 mutation-log 表头精确口径 + M-5/M-9 撤回行；⑨ 4b-INFO7 fixture README 补 ①③ 正文构造/旧稿标注；
⑩ 本节与顶部 Phase 段刷新。

⑪（主编排器追加）`findPathBlocker` 的「是否目录」判定由 `lstatSync` 改为 **`statSync`（跟随软链）**：
本轮探针挖出的反向盲区**在生产可达**——`.specify/runs` 是软链、或 `SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP`
指到 `/tmp/x`，而失败发生在更深一级（如 EACCES）时，第一个存在节点就是那个软链目录，`lstat` 判"非目录"
⟹ stderr 会说「删除挡路对象 `/tmp`」，是**会误导模型删掉正常目录**的动作行。改后：软链→目录 ⟹ null
（退回原措辞）；软链→文件 ⟹ 仍返回该软链自身路径；悬空软链仍由 `existsSync=false` 走 null（保守方向不变）。
这是本轮**唯一的行为改动，落在 stderr 文案面（`blocker` 零判定消费），判定语义仍零改动**。
留痕用例改为两条正向断言（软链→目录 ⟹ null；软链→文件 ⟹ 该软链），io JSDoc 的反向盲区登记改为已修。

另实测 `fs.existsSync` 对含 NUL 的路径**并不抛**，其 `catch` 属纵深冗余（用例注释已如实登记）。

🔴 修补后 A/B 复核（对 `7c7cb8ed`，同窗口）：存储可用面 4 轮 Stop 退出码 `2,2,0,0` + stderr sha256
`c5874941…` / `1d55be12…` 全等（`diff` exit 0）；存储不可用面 2 轮 stderr（归一化 projectRoot 后）
sha256 `e0b06cbe…` 全等 —— `renderPathSegment` 对正常 projectRoot 是恒等映射，符合预期。

### 5. 其它偏差

- **E-n 未加 root skip 守卫**（plan §5 E-n 写「同样带 root skip 守卫」）。理由：E-n 用的是**文件占位**
  而非 `chmod`，root 下同样成立，加 skip 只会在 root CI 上白丢一条误伤面覆盖。改为**更强的正向前置证明**——
  同一 env 下另跑一次不合规裁决，断言必须 exit 2 + token 首行（证明存储确实坏了）。
  E-j 用的是 `chmod 0o500`，root skip 守卫**照 plan 加了**。
- `[E2E_DEFERRED]`：**无**。全部验收走 worktree 源码直调（`node plugins/spec-driver/scripts/fix-compliance-judge.mjs`），
  不依赖本机 hook 表现（本机 `judge:doctor` 为 drift，Stop hook 跑的是已安装快照）。

## C3（T034–T039，纯删死代码；零行为改动）

**当前 Phase**：Phase C3 / 共 4（C1 · C2 · C3 · Final）
**已完成任务 ID**：T001–T032（C1+C2，已提交 `5bb8526b`）+ T034–T039
**下一步**：T040（C3 异构对抗审查，2 个切入角：误伤面 `nonBlockStopCount` 带回逻辑 / 绕过面 `routeBlock` 行为面）
→ 由主编排器派发；随后 Phase Final 的 T041–T043。

### 删除清单（源码，`fix-compliance-judge.mjs`）

| 对象 | 原行号 | 说明 |
|---|---|---|
| `NON_BLOCK_LIMIT` 及其 19 行 JSDoc | 67–84 | 含 delta-2「阈值 ≥ BLOCK_LIMIT」不变量段 |
| `NON_BLOCK_ENTRY_LIMIT` 及其 17 行 JSDoc | 86–102 | 不可擦 backstop 阈值 420 |
| `routeNonBlock` 及其 27 行 JSDoc | 918–1006 | 解锁计时器路由，生产零接线 |

净减 **127 行**。删除后 `recordWorkflowRun` / `loadBlockState` / `saveBlockState` /
`appendAuditEvent` / `buildAuditEvent` / `PREFIX_WARN` 六个符号在本文件均仍有其他消费点，无孤儿 import。

### 删除的用例名（5 条 + 1 个 suite）

- `🔴 delta-2 定时雷：NON_BLOCK_LIMIT ≥ BLOCK_LIMIT（阈值不变量）`
- suite `routeNonBlock 单元（零接线期合同）` 整块（4 条）：
  - `未耗尽：exit 0 + 计数 +1 + 审计 + loud stderr（不留最安静通道）`
  - `🔴 快路径耗尽 → 终态可见（recordWorkflowRun paused + 触发标注）`
  - `🔴 对抗 C-2 回归钉：backstop 比常量不存锚——擦库后仍触发（不可擦为真）`
  - `主路径被占位 → tmpdir 二级降级仍计数成功（不误触 storage-unavailable）`
    ← 即 T037 点名的那条：其注释「tmpdir 不可注入故不在 CLI 级强造两级全失败」已被
    `SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP` 自证不成立，随本 suite 一并消失，**不需单独处置**（T037 被 T035 吸收）。

外层 describe 名去掉尾巴「+ 解锁计时器单元」（`F270 P3 · 重入语义（…不改路由，仅诊断登记）`）。

### 保留 / 改写（E-h 意图完整保留）

- `p3-carry`（`F270 P3 · saveBlockState 带回合同`）**保留**，只换造数手段：
  `await import('../scripts/lib/fix-compliance-io.mjs')` 取 `saveBlockState`，直接写
  `{blockCount:0, degradedRecorded:false, inFlightDeferCount:0, nonBlockStopCount:1}`，
  删对 `routeNonBlock` 的动态 import。用例意图「`routeBlock` 整体覆写不得抹平 `nonBlockStopCount`」
  与其后两段断言（routeBlock 写入后带回 / 在途推迟写入后带回）**逐字未动**。
- `nonBlockStopCount` 字段与 `normalizeState` / `saveBlockState` 两处归一化**全部保留**。
- 注释按 R5-10 改写（`io.mjs` 两处 + `judge.mjs` runHook 历史叙述去掉已删函数名）：
  「当前只有原样带回方、没有递增方；带回逻辑属**不可删面**（合同钉 `p3-carry`）；递增方留给卡 B；
  🔴 该字段**不可单独作为任何放行预算**，除非卡 B 同时定义其不可伪造性——状态文件在被判方写域。」
- schema 三个 `nonblock-*` enum 条目**保留不删**（plan §4 C3 裁决：删了卡 B 要加回造成合同 churn）。
  已在 `properties.diagnostics` 加 `description` 显式登记「已登记但零产出」这一残余，
  并写明**刻意不加**「enum ⊆ 已产出码」的全局反向守卫（那属卡 A 的 canonical 表范围，加了立即自伤）。
  `enum.length` 仍为 **28**（C2 的换算式不受影响）。

### grep 结果

```
$ grep -rn 'routeNonBlock|NON_BLOCK_LIMIT|NON_BLOCK_ENTRY_LIMIT' plugins/ scripts/ src/
（零命中，hits=0）
```
`specs/` 与 `docs/` 下的历史记录按 plan 退出判据不计，未改动。

### 零行为改动的实证（存储可用路径逐字节不变）

复用 C2 的 A/B 对拍脚本，同窗口跑 A=`git archive 5bb8526b`（C1+C2 提交）vs B=当前 worktree，
各 4 轮 Stop：

- 退出码序列：`2,2,0,0`（两侧相同）
- stderr sha256：前两轮 `c5874941…`、后两轮 `1d55be12…`（两侧相同）
- 审计事件（剔时间戳）5 条、`blockCount`/`degraded`/`diagnostics` 全等
- 状态文件（剔 `updatedAt`）：`{"blockCount":2,"degradedRecorded":true,"inFlightDeferCount":0,"nonBlockStopCount":0}` 全等
- `diff` 退出码 0 ⟹ **逐字节相同**

### 验证结果

- 命令：`npm run test:plugins` · 退出码 **0** · 输出：`tests 1721 / suites 301 / pass 1719 / fail 0 / skipped 2`
  （C2 基线 `1726 / 1724 / 0 / 2` ⟹ **恰好 −5**，与上文删除的 5 条用例逐条对应，无额外用例消失）
- 命令：`node --test plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs` · 退出码 **0**
  · 输出：`tests 227 / suites 42 / pass 225 / fail 0 / skipped 2`；其中 `🔴 解锁计时器计数不被后续
  routeBlock 写入抹平`（=E-h `p3-carry`）✔ 通过
- 命令：`node --check plugins/spec-driver/scripts/fix-compliance-judge.mjs` · 退出码 **0**

### 已知偏差

- **T037 无独立产出**：其点名的 describe 落在 T035 删除范围内，被吸收；已在上文如实登记，不算跳过。
- **Codex 审查暂停，异构档位缺席**：本 Phase 属门禁/判定器面，commit 须按 CLAUDE.local.md 标注该口径；
  T040 的异构对抗审查尚未执行（本子代理范围外）。
- `[E2E_DEFERRED]`：**无**。
