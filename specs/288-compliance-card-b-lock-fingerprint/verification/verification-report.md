# F288 卡 B verification 报告

verify 子代理独立核验，默认先找假绿 / over-claim。工作目录：`.claude/worktrees/f288-compliance-card-b`（HEAD `8e06f838`）。全程未 `git stash` / `checkout` / `add -A` / commit / push；变异一律 `cp` 备份 → 改写 → 亲跑 → `cp` 还原 → `diff` 确认；`specs/src.spec.md` 未被触及。开工前按要求 `until` 轮询等待 `f288-gate.done`，30 秒后出现，随即在全开放权限下执行全部读写/变异步骤（未触发 25 分钟超时分支）。

## ① 亲跑结果表

| 套件 | 命令 | 次数 | 结果 |
|---|---|---|---|
| card-b（新套件） | `node --test .../fix-compliance-card-b-lock-fingerprint.test.mjs` | 3 次独立重跑 | 每次均 **25/25 pass，0 fail**（tests=25, suites=6，逐次耗时 2823/2838/2837ms，无 flake） |
| judge-cli | 单独跑 | 1 次 | tests=227, **pass=225, fail=0, skip=2** |
| card-a | 单独跑 | 1 次 | tests=20, **pass=20, fail=0** |
| core | 单独跑 | 1 次 | tests=604, **pass=604, fail=0** |
| io | 单独跑 | 1 次 | tests=75, **pass=75, fail=0** |
| 四者合并一次调用 | judge-cli+card-a+core+io | 1 次 | tests=926, **pass=924, fail=0, skip=2** |
| `npm run test:plugins`（全量） | 后台跑 | 1 次 | tests=1914, **pass=1912, fail=0, skip=2** |

结论：亲跑零失败，与 fix-report 声称的"零失败"方向一致；但**数字本身与 fix-report 记录有偏差**，见 ⑤-W4/W5。

## ② 变异表

方法：每处变异 = `cp` 原文件到 scratchpad 备份 → `Edit` 精确改写 → 跑 `fix-compliance-card-b-lock-fingerprint.test.mjs`（部分辅以 judge-cli/core 判断跨套件影响）→ `cp` 备份还原 → `diff` 确认零残留。全部 14 处均已还原（`git status`/`git diff --stat` 最终为空）。

| 变异 | 改动点 | 预期红 | 实际红（用例） | 结论 |
|---|---|---|---|---|
| M1-a | `acquireStateLock` 恒 `{acquired:false,...}`；`mutateBlockState` 在 `!lock.acquired` 时直接 return（不降级无锁 RMW） | 大面积红 | **18/25 fail**：T1-U1~U3、T1-C1、T2-E1/E2/E3/E5/E6/E7/E8/E9、T6-E1~E3、T1-C2/E4/C4 | 强命中，守护到位 |
| M1-b | 原子创建从 `staging+linkSync` 改回直接 `openSync('wx')+writeSync+closeSync`（重开"文件已在、内容为空"窗口） | 应至少偶发红（8 进程 T1-C1） | **0 fail**（全量套件跑 2 次 + 仅并发用例再跑 5 次，共 7 次，25/25 或 3/3 全绿） | **全绿 = 该点守护缺席**（见 ⑤-W1，含根因分析） |
| M1-c | 陈旧接管从"改名到唯一名→核对身份→不符则改回"简化为直接 `unlinkSync(lockPath)` 后重试 | 应命中双等待者竞态用例 | **0 fail**（3 次独立全量重跑均 25/25） | **全绿 = 该点守护缺席**（见 ⑤-W2；结构性确认：套件内无"多进程 + 预置陈旧锁"组合用例） |
| M1-d | `routeByFingerprint` 的 nonBlock 分支 `next` 去掉 `...state` 展开，只写 `nonBlockStopCount`/`lastCountedFingerprint` | 命中 T2-E9 | **2 fail**：T2-E9、T1-C2 | 命中，守护到位 |
| M1-e | `resetBlockState` 改为先 `acquireStateLock`，锁不可得时直接 return（不删状态文件） | 命中 T1-C3 | **1 fail**：T1-C3 | 命中，守护到位 |
| M2-a | `dispatchRoute` 的 `case 'nonblock':` 直接 `return 0`（跳过 `emitBlock`，静默放行、零审计） | 大面积红 | **8 fail**：T2-E1/E2/E5/E8/E9、T6-E3、T1-C2/E4 | 强命中，守护到位（关键安全性缺口有充分回归覆盖） |
| M2-b | nonBlock 分支保留 `...state` 但删除显式 `lastCountedFingerprint: fingerprint` 覆盖（指纹不更新） | 命中 T2-E2/E5/E8 | **3 fail**：T2-E2、T2-E5、T2-E8 | 命中，守护到位 |
| M2-c | `evaluate()` 返回对象里 `latestFixLineIndex: anchor.earliestFixLineIndex`（指纹改用最早锚点） | 仅 T2-E8 | card-b **1 fail**（仅 T2-E8）；judge-cli 227 用例 **0 fail** | 命中但**单点覆盖**——与 fix-report §7 A-W3 自述"在 judge-cli 全绿"完全吻合，该薄弱面已被本卡自己识别并补测 T2-E8，非遗漏 |
| M2-d | `runHook` 里把 `routeBlockEnforcement(...)` 调用移到 `if (enforcement==='warn')` 判断之前（无条件先跑指纹路由再看 warn） | 命中 T2-E4 | **1 fail**：T2-E4（warn 档不再是零状态写入） | 命中，守护到位 |
| M2-e | `nonblockRelease` 分支的 `releaseDegraded(...)` 调用把 `blockCount: decision.blockCount` 改为 `blockCount: null` | 命中 T2-E1/E7 | **2 fail**：T2-E1、T2-E7 | 命中，守护到位 |
| M2-f | `NON_BLOCK_LIMIT = 1`（打破 `>= BLOCK_LIMIT` 不变量） | 命中 T2-U2 | **2 fail**：T2-U2、T2-E1 | 命中，守护到位 |
| M6-a | `releaseCorroborated` 恒 `return true`（放行佐证闸门整体失效） | 大面积红（6b 全部） | **5 fail**：T2-E7、T2-E10、T6-E1/E2/E3 | 强命中，守护到位 |
| M6-b | `dispatchRoute` 两处 `alreadyRecorded: decision.wasAlreadyRecorded && hasFailedRunRecord(...)` 都删掉 `&& hasFailedRunRecord(...)`（终态去重只看状态字段） | 命中 T6-E1 | **1 fail**：T6-E1 | 命中，但**单点覆盖**（见 ⑤-I1） |
| M6-c | 见下方说明——两种解读均已测 | 见下 | 见下 | 见下 |

**M6-c 的双重解读说明**：verify-prompt 原文"佐证谓词 `startsWith(FIX_COMPLIANCE_FEEDBACK_MARK)` 改 `includes`"在当前源码中找不到字面对应（`countBlockFeedbackEntries` 现状本就是 `includes(FIX_COMPLIANCE_FEEDBACK_MARK)`，不是 `startsWith`）。核对 fix-report.md 第 43 行自身的措辞"**佐证谓词用 includes 不用 startsWith**"，与 commit `8e06f838` 源码一致，确认正确方向应为"变异 = 把 `includes` 改成 `startsWith`"。两种解读均已实测：
  - **变体 A**（我最初的字面尝试：`countHookFeedbackEntries` 共享的 `text.startsWith(HOOK_FEEDBACK_PREFIX)` 结构性前缀判据改 `includes`）：card-b **1 fail**（T2-U3）；judge-cli+core 合跑 **2 fail**（U-3、E-b′，恰是 JSDoc 点名"技能展开注入文本会假冒 token"的场景）。**命中**。
  - **变体 B**（对齐 fix-report 原意：`countBlockFeedbackEntries` 自身谓词 `includes(FIX_COMPLIANCE_FEEDBACK_MARK)` 改 `startsWith(FIX_COMPLIANCE_FEEDBACK_MARK)`）：card-b **10/25 fail**（T2-U3/E1/E2/E3/E5/E7/E10、T6-E1/E2、T1-C4）。**强命中**——因为生产环境真实回灌文本恒为 `"Stop hook feedback:\n[cmd]: [FIX-COMPLIANCE] ..."`，`[FIX-COMPLIANCE]` 从不在 offset 0，误用 `startsWith` 会让佐证计数永久归零，几乎所有"最终应放行"用例都会翻车。
  两种解读该谓词均有回归覆盖，**M6-c 不构成守护缺席**。

**还原完整性**：14 处变异 + 2 处 M6-c 变体，共 16 次改写，全部通过 `cp` 备份 + `diff` 确认逐次归位；最终 `git status --short` 与 `git diff --stat` 均为空，且对 card-b 套件做了收尾整体重跑（25/25 pass）二次确认磁盘状态与基线一致。

## ③ K-14 并发速率实测

方法：预置 `lastCountedFingerprint` 为已知旧值（`'f'.repeat(64)`）+ `blockCount:0` + `nonBlockStopCount:0`，N 个判定器子进程以**相同 `prompt_id`**（因而计算出相同的新指纹）并发发起同一 Stop 事件，读子进程退出码与状态文件增量。N=2、N=4 各跑 3 轮：

| N | 轮次 | exit codes | nonBlockStopCount 增量 | blockCount 终值 |
|---|---|---|---|---|
| 2 | 1 | [2,2] | **1** | 1 |
| 2 | 2 | [2,2] | **1** | 1 |
| 2 | 3 | [2,2] | **1** | 1 |
| 4 | 1 | [2,2,2,2] | **2** | 1 |
| 4 | 2 | [2,2,2,2] | **2** | 1 |
| 4 | 3 | [2,2,2,2] | **2** | 1 |

**结论**：N=2 时增量 = N−1 = 1，与 fix-report §4 K-14"每个 Stop 多消耗 N−1 格"的字面公式吻合；但 **N=4 时增量实测为 2，不是 N−1=3**——因为 `NON_BLOCK_LIMIT=2` 封顶后，第 4 个到达的进程会落入 `uncorroborated` 分支（`state-budget-uncorroborated`，exit 2 但不再递增 `nonBlockStopCount`），而不是继续叠加无进展格。这恰好证实 K-14 条目自己补的限定"**上界为 `NON_BLOCK_LIMIT`**"是必要且准确的——若只读"N−1"这半句会显著低估帧数被封顶的事实，K-14 词条完整读（含上界限定）是**如实**的，未发现 over-claim。三轮结果完全一致（无 flake），`blockCount` 三轮均稳定卡在 1（第一个抢到锁的进程赢得"有进展"判定），符合预期。

## ④ 合同对账表

对照 `contracts/fix-compliance-judge-cli.md` 新节"指纹路由、状态锁与放行佐证"逐条到源码行号：

| 合同声称 | 源码位置 | 核验 |
|---|---|---|
| `mutateBlockState`（锁包住 load，临界区不裹 IO） | `fix-compliance-io.mjs:728` | 一致（load 在锁内，`appendAuditEvent`/终态写在 `dispatchRoute` 内，锁已在 `mutateBlockState` 的 `finally` 释放之后） |
| 锁文件路径 `<状态目录>/<sessionId>.lock`，`link` 原子创建 | `acquireStateLock` `io.mjs:609`，staging+`linkSync` 在 `io.mjs:626-637` | 一致 |
| 陈旧判据：pid 不存活（含 EPERM）/墙钟>300s/`startedAt` 未来/不可解析且 mtime≥2s | `io.mjs:582-590`(`pidAlive`)、`656-662`(`fresh` 判据)、`LOCK_STALE_MS=300*1000` `io.mjs:571` | 一致，四条件均可在源码中逐一对应 |
| 有界重试 ≈480ms | `LOCK_RETRY_MAX=60` `io.mjs:568`、`LOCK_RETRY_WAIT_MS=8` `io.mjs:569`（60×8=480） | 一致，且 T1-U2 实测 `ms>=400 && ms<5000` |
| 锁不可得 ⟹ 降级为无锁 RMW，不跳过 | `mutateBlockState` 无 `if(!lock.acquired) return` 早退，正常走 load→mutator→save | 一致（M1-e/M1-a 变异证实此路径确被依赖） |
| 只由持有者按 `lockId` 比对后 unlink；`resetBlockState` 不需要互斥、不删锁 | `releaseStateLock` `io.mjs:701-709`；`resetBlockState` `io.mjs:772` 无锁调用 | 一致（M1-e 变异证实"不需要互斥"这一点确有测试钉住） |
| `computeEvidenceFingerprint` 四分量 sha256，`prompt_id` 缺席⟹null | `judge.mjs:812-821` | 一致，`promptId` 类型/空值检查在 812 行 |
| 互斥三分（nonBlock/routeBlock）；所有分支锁内写回指纹 | `routeByFingerprint` `judge.mjs:965-987` | 逐分支核对：6 个 return 分支（progressed×3 + non-progressed×3）**全部**在 `next` 中带 `lastCountedFingerprint: fingerprint`，一致 |
| `NON_BLOCK_LIMIT >= BLOCK_LIMIT` 且两者同为 2 | `judge.mjs:126,133` | 一致（`export const NON_BLOCK_LIMIT = BLOCK_LIMIT;`），T2-U2 钉住 |
| 耗尽放行：`nonBlockStopCount>=NON_BLOCK_LIMIT` 或 `entryCount>=NON_BLOCK_ENTRY_LIMIT(=420)` | `routeByFingerprint` 内 `limitExhausted`/`backstop` 变量 `judge.mjs:978-979` | 一致 |
| 放行佐证：两条降级路径均需 `blockFeedbackCount>=BLOCK_LIMIT` | `releaseCorroborated` `judge.mjs:777-779`，被 `routeBlock`(l.842) 与 `routeByFingerprint`(l.966) 共同调用 | 一致（M6-a 变异证实两条路径确实都依赖它） |
| assistant entry ≥420 不是佐证，只是 nonBlock 跑道耗尽触发 | `routeByFingerprint` 的 `backstop` 变量只喂 `limitExhausted \|\| backstop` 判据，不进 `releaseCorroborated` 的入参 | 一致；T2-E7 端到端钉住"420 且零回灌仍 exit2" |
| 终态去重只查 runs 账本 `hasFailedRunRecord` | `judge.mjs:786-805`，两处调用点 `judge.mjs:920,925` | 一致（M6-b 变异证实该 `&&` 项确实承重，唯一覆盖用例 T6-E1） |
| 耗尽放行终态 `blockCount` 为真实计数（number，键不消失） | `releaseDegraded` 默认参数 `blockCount = BLOCK_LIMIT` `judge.mjs:1188`，`Number.isInteger(blockCount)?blockCount:BLOCK_LIMIT` `judge.mjs:1217` | 一致（M2-e 变异证实两处调用点确实各自显式传了非 null 值） |
| 五个新码入 `JUDGE_DIAGNOSTICS`（不可见）且 ⊆ schema enum | `judge.mjs:103-108`（`gate-fingerprint-no-progress`/`gate-fingerprint-partial`/`nonblock-limit-exhausted`/`nonblock-backstop-exhausted`/`state-budget-uncorroborated`） | **核验通过**：`fix-compliance-verdict-event.schema.json` 第 39-75 行 enum 数组含全部 5 码，且额外含 `state-lock-unavailable`/`state-lock-taken-over`（io 侧 `STATE_STORAGE_DIAGNOSTICS`，`io.mjs:282-283`）——两族共 7 个新码均 ⊆ enum，均 `userFacing:false`（T2-U2 已逐条钉住） |
| `--mode report` 输出字段集合与改动前一致 | `runReport` `judge.mjs:1499-1522` | **逐字节核验**：`git show 592f2b73:.../fix-compliance-judge.mjs` 的 `runReport` 函数体与当前版本**完全相同（diff 零输出）**——F288 未新增/删除/重排任何 report 字段。`evaluate()` 内部虽新增了 `blockFeedbackCount`/`latestFixLineIndex`/`ledgerDelegationCount` 等字段，但 `runReport` 按白名单只取 `mode/fixSession/enforcement/configDegraded/transcriptDiagnostics/ledgerDiagnostics/inFlightDelegations/assistantEntriesSinceEarliestFix` + `...verdict`，新增字段不泄漏进 report 输出，声称成立 |
| `JUDGE_FILE_SET` 不变（无新文件） | `git show 8e06f838 -- .../judge-snapshot-core.mjs` 空输出 | 一致，本次改动未触及该文件 |

**合同对账结论**：抽查的全部条目均能在源码中逐一对应，未发现合同文字与实现方向相反的漂移；schema enum 与 `--mode report` 字段集两项关键"不变性"声称均已用直接对比方式核验为真。

## ⑤ over-claim 清单

### CRITICAL：0 项

未发现当前已合并代码中存在与 fix-report 断言方向相反的、真实可被利用的安全缺口——所有识别出的问题均为"测试覆盖缺席"或"文档记录口径漂移"，不是活跃行为缺陷（穷举了变异表 14+2 项、K-14 实测、合同逐条对账、下方 5 项 WARNING/3 项 INFO，未找到反例升级为 CRITICAL 的依据）。

### WARNING：5 项

| # | 发现 | 证据 |
|---|---|---|
| W1 | M1-b（锁文件原子创建 `link` vs `openSync('wx')+写`）的回归覆盖**实际不生效**：7 次独立运行（含仅并发用例 5 次重跑）全绿。根因追查：无论用哪种创建方式，`acquireStateLock` 里独立的 `unreadableButRecent`（`holder===null && mtime<2s`）新鲜度判据都会把"内容暂时不可读但很新"的锁判为 fresh、不接管——这恰好是 M1-b 想复现的那个窗口的通用兜底，使得"是否原子创建"这一具体设计点在当前测试规模/无人为延迟注入下**不可观测**。 | io.mjs:656-662；7/7 次变异测试全绿（②表 M1-b 行） |
| W2 | M1-c（陈旧锁接管从"改名到唯一名+身份核对"简化为裸 `unlinkSync`）**零覆盖**：3 次全量重跑全绿。结构性确认——检索整份 card-b 测试文件，**没有任何用例同时构造"预置陈旧锁 + ≥2 并发判定器进程"**（T1-C1/C2/C4 都是从零竞争新锁，T1-C3/T1-E4 的预置锁都是活锁+单进程）。这正是 fix-report §7 B-W1 所修的"双持锁丢更新"场景本身缺少专属回归测试 | grep 结果见附录；②表 M1-c 行 |
| W3 | fix-report §3/§6 的测试计数**滞后于实际交付**：文中"新测试...（22）"及其枚举列表（T1-U1~T-S1）逐项相加恰为 22，但实际测试文件为 **25** 个用例（多出 T2-E8/E9/E10，均为对抗复审 A-W3/I-5/W-2 新增，且这三条恰好在 §7 表格里被点名）。**commit `8e06f838` 的 message 本身写的是"card-b 25/0"**，与 fix-report.md 正文的"22"直接矛盾——文档定稿滞后于最终一轮修订 | `fix-report.md:41`；`grep -c "  it("` = 25；`git show 8e06f838` message 原文 |
| W4 | fix-report §6"`judge-cli 924/0` + `card-a 20/0` + core + io"一句的措辞**易读成加法**（judge-cli 单独 924，再加 card-a 20，再加 core/io），但亲跑实测 judge-cli 单独只有 **225** pass；924 其实是 **judge-cli(225)+card-a(20)+core(604)+io(75)=924** 四者合计。数字本身无误（0 fail 结论成立），但呈现方式会误导读者以为 judge-cli 单套件就有 924 个用例。commit message 里"`judge-cli + card-a + core + io 924/0`"的并列写法反而准确，fix-report.md 正文未采用同样清晰的表述 | 亲跑分项：judge-cli 225/card-a 20/core 604/io 75；`fix-report.md` §6 原文 vs commit message 原文对比 |
| W5 | `npm run test:plugins` 声称 **1886/0**，本次在当前 HEAD 全新重跑得到 **1912 pass/0 fail（2 skip）**，相差 26 个用例。0 fail 的结论未变，但绝对数字已过期，最可能原因是 fix-report 定稿时点早于最终 `rebase` 到 `b9a4aa92`（该 rebase 引入了 F284/F286/F285b 等其它批次 3 卡片的新增测试），建议下次交付前以 push 前最后一次全量跑的数字为准 | `/private/tmp/.../scratchpad/f288-test-plugins.log` 尾部 1914/1912/0/2 |

### INFO：3 项

| # | 发现 |
|---|---|
| I1 | M6-b（`alreadyRecorded` 终态去重不查账本）虽被捕获，但**全仓唯一命中用例只有 T6-E1 一条**（其余 24 个用例均不涉及该分支），属单点覆盖；不构成"全绿"但margin较薄，与 fix-report §7 A-W3 已自陈的 M2-c"仅 judge-cli 全绿故补测 T2-E8"是同一类"薄覆盖后已知悉"模式，未发现比 §7 记录更差的新增薄弱面 |
| I2 | `routeStorageUnavailable` 的放行判据用内联 `feedbackCount >= BLOCK_LIMIT`（`judge.mjs:1055`），未复用 `releaseCorroborated(counts)` 这同一个函数——两处阈值目前数值相同（`BLOCK_LIMIT`），行为一致，非缺陷，但存在"改一处忘改另一处"的潜在漂移面，不在本卡改动范围内，仅记录供后续参考 |
| I3 | verify-prompt 原文对 M6-c 的字面描述（"`startsWith(FIX_COMPLIANCE_FEEDBACK_MARK)` 改 `includes`"）在当前源码中无法直接定位（现状本就是 `includes`），已按 fix-report.md 自身措辞校正方向复测（见②表 M6-c 说明），两种解读均已验证为"命中"；建议后续同类卡片的变异清单在 fix-report 与派发 prompt 之间做一次逐字核对，避免二次转写引入方向歧义 |

## ⑥ 残余与未验项（如实）

- **K-18**（test-and-set 成功但锁外终态写抛错的微秒级窗口）：未做专项复现（需要在 `dispatchRoute` 与 `releaseDegraded` 之间人为插入延迟才能构造，超出"cp 备份+脚本改写"允许的变异范围，且 fix-report 已如实登记为"极小概率、方向安全"的残余，未独立复测）。
- **B-W3"双注册拆条回灌下地板 = ceil(2/N)"**：fix-report 自陈"handoff 零样本"，本次 K-14 只测了"同一 payload 并发"这一种真实可构造场景（③表），未构造"拆条回灌"形态（该形态依赖真实 harness 双注册行为，非判定器自身可单独复现），维持"未验证"标注。
- **M1-b / M1-c 的"该不该补测"判断留给主线程**：本报告只如实呈现"当前全绿"这一事实和结构性根因（W1/W2），是否需要新增变异体注入延迟或双等待者专项用例，属于设计取舍，不在 verify 子代理职权内下裁决。
- 未对 `plugins/spec-driver/hooks/stop-fix-compliance-check.sh` 之外的生产接线（如 Codex 方言 hook payload 差异）做端到端复测，沿用 fix-report 已登记的 K-13 残余原样。
- 全部变异均在 card-b 套件（外加 M2-c/M6-c 额外核对了 judge-cli/core）上验证，未对 `npm run build`/`repo:check`/`release:check` 做变异态下的复测（任务未要求，且变异态不允许提交，故未跑全量门禁于变异中间态）。

---

**Dogfooding 反馈**：本次 verify 未使用 Spectra MCP 工具——三个目标文件（io.mjs/judge.mjs/core.mjs）均需逐行读取以支撑变异定位与合同行号对账，Spectra 的 symbol 级检索对本任务（需要精确到"哪一行的哪个分支"）收益有限；改用 `Read`/`grep -n` 直读源码 + `git show`/`git log` 做基线对比。Spec Driver 流程本身未使用（verify 子代理独立运行，非编排入口）。若有实质反馈应落 `docs/design/dogfooding-feedback-ledger.md`，但本次判断"无"（工具选择是任务性质使然，非工具缺陷），故不落账。
