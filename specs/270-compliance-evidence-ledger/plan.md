# F270 技术规划：依从性证据账本（Compliance Evidence Ledger）

> 门禁类改动第十轮（F224→F257 九轮史之后）。本 plan 只做技术落地，不重新发明 spec 已定裁决。
> Codex 审查暂停期，门禁类改动走异构对抗档位，commit 须标注「Codex 审查暂停，异构档位缺席」。
> **执行方式**：`[DEGRADED: inline-execution — plan — 委派子代理死亡（本会话第 5 次 API 错误，骨架已落、正文由主编排器 inline 填充）]`。

## 1. Summary

在 fix-compliance 门禁旁挂一条 **PostToolUse 实时证据账本**，让判定器在**委派证据**维度读账本而非只读异步滞后的 transcript；在途判定改用 harness 原生 `background_tasks`。五个已定技术裁决：

1. **锚点三分**（最高风险）：`detectFixSkillExpansion` 同趟产出三个量——isFix 存在性判定（修病根 iv）、窗口下界改用新增 `latestFixLineIndex`（最晚 *fix* 展开）、闸门三基线 `earliestFixLineIndex` 保持不变。
2. **解锁计时器** `nonBlockStopCount`：解耦「不计 `blockCount`」与「放行」，阈值 MUST ≥ `BLOCK_LIMIT`，耗尽判据挂不可擦 transcript 派生量。
3. **账本采集器**：bash 薄壳 + node，裁剪条目（不存 `tool_response` 全文），恒 `exit 0`，JSONL `O_APPEND`。
4. **D-1 方向 X**：账本只喂两个委派消费点；见证/执行记录/锚点全留 transcript。
5. **F264 分发耦合**：新 hook 双处登记（5→6 条）、新模块入 `JUDGE_FILE_SET`（四处断言同步）。

## 2. Technical Context

| 项 | 值 |
|---|---|
| 语言 | Node.js 20+（.mjs，判定器）+ Bash 5.x（hook 薄壳） |
| 运行时依赖 | **零 npm**（原则 X）——只用 `node:fs`/`node:crypto` 等内置 + bash |
| 测试框架 | **双栈**：判定器逻辑走 `node:test`（`npm run test:plugins`，基线 1585/0/2skip）+ TS 侧 `vitest run`（F264 断言面，SC-008 双基线） |
| 目标文件（改） | `fix-compliance-judge.mjs`、`lib/fix-compliance-core.mjs`、`lib/fix-compliance-io.mjs`、`hooks/hooks.json`、`lib/codex-hooks-schema.mjs`、`lib/judge-snapshot-core.mjs`、`contracts/fix-compliance-verdict-event.schema.json` |
| 目标文件（新增） | `hooks/post-tool-use-ledger.sh`（采集器薄壳）、`scripts/lib/ledger-writer.mjs`（写）、`scripts/lib/ledger-reader.mjs`（读+校验）、`scripts/lib/in-flight-verdict.mjs`（在途三态）；账本模块具体切分留 4a |
| 测试文件（新增/改） | `tests/fixtures/fix-compliance/real-*.jsonl`（真实录制）、各 `*.test.mjs` + `judge-snapshot-*.test.mjs`、`tests/unit/codex-hooks-*.test.ts` |
| 账本落盘 | `.specify/runs/<布局待 4a 定>`（gitignored 已验证） |

## 3. Constitution Check

| 原则 | 检查 | 结论 |
|---|---|---|
| **X 零运行时依赖** | 账本用 `node:fs.appendFileSync`（`O_APPEND` 原子，P-7 实测）、`node:crypto` 哈希；hook 是 bash+node；无 npm 包 | ✅ |
| **XIII 向后兼容** | 账本缺席→FR-009 回退 transcript，与变更前等价；`normalizeState` 新增 `nonBlockStopCount` 缺失→0（老状态文件不炸）；账本空**绝不恒阻断** | ✅ 组件级（SC-007 修订版口径） |
| **IV 诚实标注** | 在途三态 `undetermined`、`snapshot-stale` vs「无法交叉校验」分家、PENDING 计数、终态标触发计时器（SC-014） | ✅ |
| **IX hooks 只承载硬约束** | 账本采集 hook **只读 payload→追加一行→exit 0**，不做流程判断、不改工具行为（PostToolUse 在工具后触发，结构上无法回滚）；全部判定仍在 Stop 侧 | ✅ 属证据采集非编排决策 |
| **XI 质量门控不可绕过** | 病根 iii/iv 正是门控被自身机制绕过，本卡修复方向与原则一致；PENDING 不得成新逃逸口（FR-031） | ✅ |

## 4. 架构设计

### 4a. 新增组件与职责边界

| 组件 | 文件 | 职责 | 边界（不做什么） |
|---|---|---|---|
| **账本采集器** | `hooks/post-tool-use-ledger.sh` + `lib/ledger-writer.mjs` | PostToolUse 触发 → 从 payload 抽裁剪字段 → `appendFileSync` 一行 JSONL → 恒 exit 0 | 不判定、不读回、不阻断；失败静默（写独立自诊断文件，不进 stdout/stderr） |
| **账本读取器** | `lib/ledger-reader.mjs` | Stop 侧读账本 → 逐行解析（坏行跳过计数）→ 去重（`tool_use_id`+全值哈希）→ 按 `latestFixLineIndex` 时间戳窗口过滤 → 输出委派条目集 | 只产出**委派证据**（D-1）；不碰见证/执行记录 |
| **在途三态判定** | `lib/in-flight-verdict.mjs` | 读 Stop payload `background_tasks` → 三态（in-flight/no-in-flight/undetermined）+ 诊断码 | 承重判据只用结构性事实（键存在/数组非空）；`type` 只进诊断文案 |
| **解锁计时器** | `lib/fix-compliance-io.mjs`（扩 `normalizeState`）+ judge 消费 | `nonBlockStopCount` 快路径落磁盘 + 不可擦 backstop 挂 transcript 派生量 | 见 4c |

**账本布局裁决（spec [NC]#2）**：按 `session_id` 分文件 `.specify/runs/.fix-compliance-ledger/<sanitizedSessionId>.jsonl`（复用 `sanitizeSessionId` io:280、与状态文件同目录族）。清理：合规早退时**不删**（账本是证据、留痕），由 `.specify/runs/` 整体的既有清理机制兜底 + 体积上限（FR-011）触发轮转。**理由**：状态文件删了是 fail-open（计数归零），账本删了是 fail-closed（回退 transcript），二者失效方向相反，故账本不随 `resetBlockState` 删。

### 4b. 锚点三分落地（裁决一，最高风险 — reverse-census §6）

**现状**（`core:576-600` `detectFixSkillExpansion`）：同趟产出两个量——
- `anchorLineIndex`（core:596）= 最晚一次**任意** `spec-driver-*` 展开的行号；
- `earliestFixLineIndex`（core:593）= 最早一次 **fix** 展开的行号。

**病根 iv 的真实机理**（reverse-census 揭示，比卡面深一层）：
- `isFix = anchor.mode === 'fix'`（judge:201）用最晚任意展开的 mode → 尾部 doc 展开即翻 false（跳过判定）；
- **更隐蔽**：即便修好 isFix，`anchorLineIndex` 仍是 5 个窗口的下界，尾部 doc 展开会把它推到 doc 行 → 5 个窗口把 fix 的委派/见证证据全切到窗外 → 大面积误阻断。

**改法（同趟产出三个量，各服务不同判据）**：

```
detectFixSkillExpansion 返回增补 latestFixLineIndex：
  遍历中 if (match[2] === 'fix') latestFixLineIndex = entry.lineIndex   // 最晚一次 fix
  （earliestFixLineIndex 保持：if (earliestFixLineIndex === null && match[2]==='fix') ...）
  anchorLineIndex 保持不动（最晚任意展开，core:1082 红字：改它牵动 F216/F227/F224 全链）
```

| 量 | 值 | 消费点 | 本卡动作 |
|---|---|---|---|
| **A. isFix** | `earliestFixLineIndex !== null`（存在性） | judge:201 | 🔴 改判据（原 `anchor.mode==='fix'` → 存在性） |
| **B. 窗口下界** | **新增 `latestFixLineIndex`** | judge:239/376/401/417/470 五处 | 🔴 5 个消费点入参从 `anchor.anchorLineIndex` 切到 `anchor.latestFixLineIndex` |
| **C. 闸门三基线** | `earliestFixLineIndex` | judge:237→core:1101 | ✅ 不动（FR-025 撤销即"别动这个"） |
| （保留）`anchorLineIndex` | 最晚任意展开 | 若无其他消费则可能变孤儿 | ⚠️ tasks 须核：切换后 `anchorLineIndex` 是否还有消费者；若无，评估删除 vs 保留（保留更安全，避免牵动注释链） |

🔴 **TDD 红先行（病根 iv 真正验收点，比"isFix 不翻转"深）**：
- 语料：`fix 展开 → Write specs/NNN-fix/fix-report.md → Agent(implement) → Agent(verify) → 尾部 spec-driver-doc 展开`。
- 断言：改前 `extractDelegationsAfter` 窗口从 doc 行起 → 委派证据为空 → 误判缺失（红）；改后窗口从最晚 fix 展开起 → 委派证据命中 → 合规（绿）。
- 配套：isFix 存在性——`只有 doc 展开无 fix` → isFix=false（非 fix 会话，不误伤）；`fix 后接 doc` → isFix=true。

### 4c. 解锁计时器双写 + 不可擦 backstop（裁决二 — spec FR-046 + delta-2）

**问题**：`nonBlockStopCount` 若只存 `.specify/runs/.fix-compliance-state/`（可擦），被判方 `rm -rf` 即清零 → 永不耗尽 → 会话 brick 在 exit2 循环（delta-2 揪出，违反 F208）。

**双写设计**（与闸门三为 `inFlightDeferCount` 兜底同构，`judge:79-84`）：

| 层 | 载体 | 作用 | 可擦性 |
|---|---|---|---|
| 快路径 | `normalizeState` 新增 `nonBlockStopCount` 字段（io:297/308 旁） | 精确计数、跨 Stop 累积 | 可擦（rm 即 0） |
| **backstop（承重）** | transcript 派生的单调量——`nonBlockStop` 类裁决**首次**发生后，用「该点之后的 assistant entry 数」作不可擦下界（复用 `countAssistantEntriesSince*` 家族） | 擦库后仍能判「已经推迟够久 → 该终态放行」 | **不可擦** |

**判据**：`shouldTerminalRelease = (nonBlockStopCount >= NON_BLOCK_LIMIT) || (assistantEntriesSinceFirstNonBlock >= NON_BLOCK_ENTRY_LIMIT)`。以 backstop 为准——擦库使快路径归零，backstop 仍触发放行。

**常量**（plan 定值，implement 可微调）：
- `NON_BLOCK_LIMIT = BLOCK_LIMIT = 2`（spec 硬化 MUST ≥ BLOCK_LIMIT；取等号，不给额外放行额度）。
- `NON_BLOCK_ENTRY_LIMIT`：backstop 阈值，建议复用闸门三量级（~420）——它是「会话已异常长」的兜底，不是精确计数。

**save 失败 fail-closed**（沿用 :547/:773）：`nonBlockStopCount` 的 save 若 `ok:false`，按「已达上限」处理（走终态放行而非无限阻断），与现有存储不可用语义一致——写不进≠给额外阻断额度。

**三计时器归一后的 `normalizeState` 全字段**（io:297，本卡后）：`sessionId` / `blockCount` / `degradedRecorded` / `inFlightDeferCount` / **`nonBlockStopCount`（新）** / **`firstNonBlockEntryBaseline`（新，backstop 锚）**。三处 `saveBlockState`（judge:541/609/769）的「原样带回」名单同步加这两个新字段——**漏带即被整体覆写清零**（io:349-352 覆写语义，reverse-census §6 强调）。

### 4d. 数据流链路图

```
[工具调用完成]
   │  PostToolUse hook（阻塞，~25-35ms）
   ▼
post-tool-use-ledger.sh → ledger-writer.mjs
   │  抽裁剪字段 {tool_use_id, tool_name, subagent_type全值, prompt_id, session_id, hookTs}
   │  appendFileSync 一行 JSONL（O_APPEND 原子）→ 恒 exit 0
   ▼
.specify/runs/.fix-compliance-ledger/<session>.jsonl   ← 主线程+子代理并发追加（P-5 交错）

               ┄┄┄ 会话结束 ┄┄┄
[Stop]
   │  stop-fix-compliance-check.sh → fix-compliance-judge.mjs --mode hook
   ▼
detectFixSkillExpansion(transcript)  → {isFix存在性, latestFixLineIndex, earliestFixLineIndex, anchorLineIndex}
   │
   ├─ transcript：锚点、F257见证、F216执行记录（D-1：不迁账本）
   ├─ ledger-reader：委派证据（去重+latestFix窗口过滤）→ extractDelegationsAfter/InFlight 的账本来源
   │     └─ 与 transcript 交叉（FR-008 方向性：尾部缺证方向账本优先；矛盾则取严）
   ├─ in-flight-verdict(background_tasks)：三态 → 闸门二（保留合取）
   └─ judgeCompliance → verdict
        │
        ├─ compliant → resetBlockState + 落审计（FR-024/045：曾fix即落，堵合规早退黑洞）→ exit 0
        ├─ 真实不合规 → blockCount++ → 达 BLOCK_LIMIT → releaseDegraded（终态可见）
        └─ 陈旧/undetermined/重入/无进展 → nonBlockStopCount++（不计blockCount）
              └─ 达 NON_BLOCK_LIMIT 或 backstop → 终态放行（标触发计时器，SC-014）
```

## 5. 实现分阶段（Phase 顺序，供 tasks 分解）

**排序原则**：先做**不碰判定器**的独立件（可单测、零回归风险），再做判定器核心（风险从低到高），账本接入放在锚点稳固之后，分发登记最后（避免中途 hook 数变动干扰）。每 Phase 结束跑门禁类**异构对抗**（≥2 切入角），红先行测试先写。

| Phase | 内容 | TDD 红先行关键测试 | 风险 | 是否碰判定器 |
|---|---|---|---|---|
| **P1 账本采集器** | `ledger-writer.mjs` + `post-tool-use-ledger.sh` + 裁剪逻辑；恒 exit0；O_APPEND 并发 | ① 8 进程并发 append 零撕裂（SC-006）；② 失败注入恒 exit0 无 blocking-error（SC-005）；③ 裁剪后不含 tool_response 全文；④ 活性自检（FR-043） | 低（独立，不碰判定器） | 否 |
| **P2 锚点三分** | `detectFixSkillExpansion` 增 `latestFixLineIndex`；isFix 改存在性；5 消费点切窗口下界 | 🔴 **fix→委派→尾部doc 语料委派证据仍在窗内**（4b，病根 iv 真验收）；isFix 存在性三态；闸门三基线 earliestFix **不变**回归钉 | **最高**（判定器核心，牵 5 窗口） | 是 |
| **P3 在途三态 + 解锁计时器** | `in-flight-verdict.mjs`；`normalizeState` 加 2 字段；`nonBlockStopCount` 双写+backstop；三处 save 带回 | 三态不坍缩（SC-002）；`nonBlockStop 阈值≥BLOCK_LIMIT`；擦库不 brick（backstop，SC-015）；换桶有界（SC-015）；终态标计时器（SC-014） | 高（三计时器组合） | 是 |
| **P4 账本接入委派判定** | `ledger-reader.mjs`；委派两消费点从 transcript 改账本主源；FR-008 方向性交叉；FR-047 部分缺席回退 | 账本缺席回退等价（SC-007）；委派下界下降登记项的守卫；去重语义（FR-048）；部分缺席→回退 transcript | 高（改判据主输入） | 是 |
| **P5 分发登记 + 清单同步** | `hooks.json` 加 handler；`codex-hooks-schema` 双处登记（5→6）；`JUDGE_FILE_SET`+4 断言；verdict-event schema enum | 恒 6 条不重复（SC-010，`--codex-home` 隔离跑）；4 处 length 断言同步；TS 侧 vitest 绿（SC-008） | 中（清单机械但漏一处即红） | 否（judge 逻辑不变） |
| **P6 真实 fixture 录制 + 验收** | 脱敏 101 份真实 payload（`.specify/runs/f270-raw-payloads/`）→ `real-*.jsonl`；主验收语料跑关键 acceptance；judge:doctor + 性能锚点 | 必答④四组 acceptance 跑真实语料（SC-009）；SC-011 性能阈值；judge:doctor 说明生效时点（G-8） | 中 | 否 |

**Phase 间门禁**：P2 完成后**必须**单独跑一轮异构对抗（锚点是九轮史反复被攻破处）；P3/P4 各跑一轮（计时器组合面 + 账本采信面）。

## 6. 风险与回归防护（五量反向普查表）

| 量 | 本卡是否动 | 动作 | 守卫测试 |
|---|---|---|---|
| `anchorLineIndex` | **间接**（5 窗口下界切到 `latestFixLineIndex`） | 新增平行量，5 消费点切换 | fix→尾部doc 委派不丢（P2 红先行）；`anchorLineIndex` 若变孤儿的处置记录 |
| `blockCount` | 是 | 新增 `nonBlockStopCount` 分列，`blockCount` 语义**不变** | `blockCount` 仅真实不合规累积；`releaseDegraded` 仍 BLOCK_LIMIT 触发（回归钉） |
| `verificationReport` | 否（判据不变） | — | 见证侧只查 fix-report.md 不被误改（core:903-911 守卫，防复活红队链） |
| `executionRecords` | 否（D-1 不迁账本） | — | F216 no-op 证据门链路零改动断言（G-3） |
| `saveBlockState().ok` | 是（新计时器共用） | 新字段 save 失败沿用 fail-closed | 存储不可用→按已达上限，新计时器不给额外放行 |

**其他回归护栏**（spec G-1..G-10）：F208 三档 / F211 清零 / F216 门 / F231 光杆 / F227 守卫 / F236 生效时点（judge:doctor）/ F264 双登记——tasks 各配守卫或"零改动"断言。

## 7. Complexity Tracking

| 维度 | 值 |
|---|---|
| 总体 | **MEDIUM-HIGH** |
| 最高风险项 | **P2 锚点三分**——牵 5 个窗口消费点，是九轮史反复被攻破的判据面，且"改一行 isFix"的表象下藏着"窗口下界推移致误阻断"的深层坑 |
| 次高 | P3 三计时器组合（blockCount/inFlightDefer/nonBlockStop 无共享上界，换桶面） + P4 账本采信（可写载体作主源的方向性交叉） |
| 缓解 | 分阶段 + 每判定器 Phase 独立异构对抗 + 五量守卫 + 真实语料主验收；P1/P5/P6 不碰判定器可先行降低总风险面 |

## 8. spec 与代码现状矛盾记录

1. **`anchorLineIndex` 孤儿风险**（reverse-census §6 表末）：5 消费点全切到 `latestFixLineIndex` 后，`anchorLineIndex` 可能无消费者。tasks 须实证核查全仓引用；若确成孤儿，裁决删除 vs 保留（倾向保留——core:1082 的注释链依赖它命名，删除牵动文档）。**非阻塞，P2 收尾时定。**
2. **AskUserQuestion 是否触发 PostToolUse 未实测**（本会话样本随 scratchpad 清空丢失）：A-4 的 `AskUserQuestion` 权威信号增强的承重前提。**主方案（指纹去重）不依赖它**，故非阻塞；若 implement 期要用该增强，P3 前补测一次即可。
3. **`npx vitest run` 当前基线值未取**（SC-008 要求）：本阶段未跑全量 vitest。P5（碰 TS 断言面）前须实跑一次取基线数，作"零新增失败"的对照。**非阻塞，P5 前取。**
