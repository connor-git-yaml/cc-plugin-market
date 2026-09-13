# F289 verify 子代理 · 终态核验报告（精简版，因并发负载重派）

> 审查基线：HEAD `493ce5c7148ed269afbbd4a1f895f5fac604608e`（未改动，见 §7 收尾核对）。
> 范围：按重派任务说明执行精简清单——不跑全量 vitest、不做 3× 重复、真实语料抽样上限 8 份；
> 主门禁（build / test:plugins / broad 套件 / vitest 全量隔离复跑）已由主线程跑过，本报告只做端到端复核 + 变异测试 + over-claim 核验。
> 全部构造在 `/private/tmp/.../scratchpad/f289/*` 与系统 tmp 临时项目上实跑（`--mode hook` / `--mode report`，
> `--project-root` 指临时目录），未 `git stash` / `checkout <path>` / `add` / commit / push，worktree 零改动
> （§7 有 md5/diff 收尾证据）。真实 sidechain 语料只读 `~/.claude/projects/`，未写入任何字节。

## ① 门禁复核（主线程已跑，本次抽查复核）

| 命令 | 结果 | 备注 |
|---|---|---|
| `node --test plugins/spec-driver/tests/fix-compliance-tier2-continuation.test.mjs` | **23/23 pass, 0 fail** | exit 0；与 fix-report §3/§6 计数一致 |
| `node --test judge-cli + card-a-* + card-b-*`（Tier 1 三套合跑） | **273 tests / 271 pass / 0 fail / 2 skipped** | exit 0；2 skip 为环境性既有条件跳过（本机无对应真实 transcript / root uid 检测），非本卡引入，Tier 1 零翻转成立 |

结论：两条门禁均**实跑确认**，与主线程结论一致，未发现假绿。

## ② 终态两关键点端到端（独立脚本，不复用测试文件本身）

独立脚本：`scratchpad/f289/e2e-key-points.mjs`（自建临时项目 + 真实 CLI 子进程调用，字段形状取自生产契约，非测试专属）。

### (a) 同目标编辑循环自愈 —— **PASS**

bare witness 绑定（Write `fix-report.md`，全程零 verify 委派），每轮重编辑同一文件响应阻断，连续 5 轮：

```
exit codes: [2, 2, 0, 0, 0]
stderr 首行: [FIX-COMPLIANCE] 缺少 verify 类委派 ×2 → [GATE-DEGRADED] 已达阻断上限(2 次)... ×3
```

第 3 轮准时降级自愈，且第 4/5 轮保持放行（不反弹回阻断、也未见"永久 fail-closed"）。与 fix-report §3 implement 处置表描述的终态一致。

### (b) sidechain 无提名不绑定 —— **PASS**

三组独立构造：

| 场景 | 标记 candidatePath | 主 transcript 提名 | verify 委派 | exit | tier | verdict 事件数 |
|---|---|---|---|---|---|---|
| b1 | null | 无 | 有 | **0** | **null** | **0** |
| b2 | null | 无 | 无 | **0**（非硬阻断） | — | — |
| b3（对照） | 携带 `specs/702-fix-sidechain-bug` | — | 无 | **2** | 2（`tier2-bound-sidechain`） | missing=[delegation:verify] |

b1/b2 确认"无提名"既不硬阻断（b2 消除误伤面）也不是零成本免费通行（b1 仍需真实提名才落 Tier2 判定，非"标记存在即放行"）；b3 确认有提名时正常执法。三支路行为与 spec §4 (c) 行、fix-report implement 处置表逐字一致。

### (c) 跨目标 per-session 残余 —— 如实复现，**确认未被过度声称为已修**

同会话内构造：Fix-A（resume 绑定：skill 展开 + 同段 `sed -i` 写指示符提名，缺 verification-report）先付 2 次真实阻断，第 3 轮正常降级自愈（`[2, 2, 0]`）；随后**同一会话、同一持续增长的 transcript**里首次出现 Fix-B（全新目录、纯 Write 见证、零 verify、零 verification-report）：

```
Fix-A 序列: [2, 2, 0]
Fix-B 首次评估: exit 0（stderr 含 [GATE-DEGRADED] 已达阻断上限(2 次)... + 缺少验证报告...）
Fix-B report 模式: tier=2, missing=[verification-report.md, delegation:verify]
```

Fix-B 明确被 Tier2 绑定判定为不合规（`missing` 非空、`tier2` 已识别到 Fix-B），但因同会话 `state.blockCount` 已在 Fix-A 阶段被打满且 corroboration（`blockFeedbackCount`）复用同一份 transcript 里 Fix-A 阶段回灌的 2 条反馈，**Fix-B 首次评估即 0 往返降级放行**——与 spec §7 残余9 / fix-report §7 implement 处置表描述的"Fix-A 付 2 次阻断后 Fix-B 首评仍 per-session 复用放行"完全一致。

核验结论：fix-report §7 与 spec §7 残余9 的措辞（"如实登记为残余"、"前提：Fix-A 须先付 2 次真实阻断；Tier 2 新基建真实语料 0 例"、"根治=per-target 阻断预算……移交 M11 独立立卡"）**准确、未过度声称已修**——通篇未见"已堵住"/"已解决"字样描述该路径，与本次实测行为吻合。**诚实性核验：PASS**。

## ③ 变异测试（6 处，逐处独立：`cp` 备份 → 改写 → 跑指定测试 → `cp` 还原 → `diff` 确认零差异）

全部改写用字面精确替换脚本（`scratchpad/f289/mutate.mjs`，要求 old-string 在文件中恰好出现 1 次才允许改写，避免误伤其它位置）。

| # | 变异内容 | 目标文件 | 预期红 | 实测结果 | 隔离度 |
|---|---|---|---|---|---|
| M1 | 还原 sidechain option-a（去掉 `hasNomination(main)\|\|carried.length>0` 判定，恒绑定） | fix-compliance-judge.mjs | E2 | **E2 red**（22 pass / 1 fail） | 仅 E2 失败，其余 22 项不受影响 |
| M2 | 佐证锚改「最晚活动行」（witness `first = witnesses[0]` → `witnesses[witnesses.length-1]`） | fix-compliance-judge.mjs | E1 | **E1 red**（22 pass / 1 fail） | 仅 E1 失败；精确复现 delta 误伤面 CRITICAL 的病灶方向 |
| M3 | earliest resume 改 latest（`earliestResumeLineIndex/Timestamp` → `latestResumeLineIndex/Timestamp`） | fix-compliance-judge.mjs | A4 | **A4 red**（22 pass / 1 fail） | 仅 A4 失败 |
| M4 | requireMeta 去掉（`detectFixSkillExpansion(entries, {requireMeta:true})` → 去掉选项） | fix-compliance-sidechain-marker.mjs | C5 | **C5 red**（22 pass / 1 fail） | 仅 C5 失败 |
| M5 | 项目闸去掉（`isSpecDriverProject` 判定短路为恒假） | fix-compliance-sidechain-marker.mjs | C4 | **C4 red**（22 pass / 1 fail） | 仅 C4 失败 |
| M6 | 账本 sinceTs 传 null（`{sinceTs: effective.latestFixTimestamp ?? null}` → `{sinceTs: null}`） | fix-compliance-judge.mjs | E3 | **E3 red**（22 pass / 1 fail） | 仅 E3 失败 |

6/6 变异全部按预期精确变红，且每次都**只**打中目标用例（无连带误伤、无漏判），证明这 6 个回归钉子是真实承重的，不是摆设断言。

还原收尾（每处变异后立即执行，非最后一次性收尾）：

```
M1: DIFF_CLEAN_M1_RESTORE   M2: DIFF_CLEAN_M2_RESTORE   M3: DIFF_CLEAN_M3_RESTORE
M4: DIFF_CLEAN_M4_RESTORE   M5: DIFF_CLEAN_M5_RESTORE   M6: DIFF_CLEAN_M6_RESTORE
```

全部还原后 md5 与 `git show HEAD:<path>` 逐字节一致（见 §7），未毒化 worktree。

## ④ 真实 sidechain 语料抽样（8 份，只读）

本机 `~/.claude/projects/**/subagents/*.jsonl` 当前共 **693** 份（fix-report/spec 记录的 N=624 系更早取数，语料随会话持续增长，符合预期）。按文件体积分层抽样 8 份（含最小 4.9KB 与历史最大 2,431,844 bytes 那份，覆盖尾部而非纯随机）：

| 体积 | in-process 单次耗时 | CLI 端到端耗时 | recordSidechainFixMarker 结果 |
|---|---|---|---|
| 4,877 B | 0.575ms | 24.1ms | no-fix-expansion |
| 146,774 B | 1.421ms | 21.7ms | no-fix-expansion |
| 255,520 B | 1.519ms | 21.3ms | no-fix-expansion |
| 347,106 B | 2.104ms | 21.7ms | no-fix-expansion |
| 447,696 B | 2.352ms | 21.8ms | no-fix-expansion |
| 576,109 B | 3.054ms | 22.4ms | no-fix-expansion |
| 836,743 B | 3.282ms | 22.9ms | no-fix-expansion |
| 2,431,844 B（历史最大文件） | **6.579ms**（冷启动首次调用） | 26.8ms | no-fix-expansion |

selfdiag：0 条；标记文件写入：0 个（8 份全部 `no-fix-expansion`，与 spec §7 残余7 "真实语料尚无 fix 展开命中" 的描述一致）。

**SC-005 数字复核（发现，见 §5 WARNING-1）**：对历史最大文件重复调用 10 次（同进程内），耗时曲线为 `[6.834, 5.875, 5.350, 5.147, 5.018, 4.684, 4.584, 4.558, 4.536, 4.382]`——明显的 JIT 预热曲线，**稳定态**（~4.4–4.6ms）与 fix-report/spec 记录的 `max=4.79ms` 吻合，但**首次冷调用**达 6.58–6.83ms。生产真实形态是**每次 SubagentStop 都是全新 node 进程**（无跨调用预热），故冷启动数字（~6.8ms）比文档记录的稳态 max 更贴近真实生产尾部，但仍在 ≤10ms 绝对预算内（余量 ~32%）——**SC-005 的"预算内"结论不受影响，但 `max=4.79ms` 这个具体数字更可能反映的是预热态而非生产态首次调用**，登记为 WARNING-1（文档精度问题，非功能缺陷）。

## ⑤ over-claim 核验（fix-report §7 implement 处置 + spec §7 残余，逐条找反例）

### fix-report §7 implement 处置表（三行核心结论）

| 处置描述 | 核验方式 | 结论 |
|---|---|---|
| "跨目标复用……如实登记为残余" | §2(c) 端到端复现 | **未找到反例**：复现结果与描述完全一致，未见"已修复"措辞 |
| "sidechain 无提名……收敛到第三方向（双空⟹不绑定）" | §2(b) 端到端复现 + M1 变异（还原 option-a 会破坏 E2） | **未找到反例**：M1 证明当前实现确实已脱离 option-a（无条件绑定），第三方向真实生效 |
| "已还原为 F288 per-session 佐证窗口" | M2 变异（改回"最晚活动行"会破坏 E1） | **未找到反例**：M2 证明当前实现确实是"未前移"的原始 per-session 窗口，而非仍留有前移逻辑 |

### spec §7 残余清单（10 项逐条）

| 项 | 核验方式 | 结论 |
|---|---|---|
| 误阻断1（约 1/4 缺 verification-report，少量缺 Root Cause） | 对本仓库 `specs/*-fix-*/` 89 个真实 fix 目录做统计 | **未找到反例，且数字精确匹配**：22/89=24.7% 缺 verification-report（"约 1/4"），7/89=7.9% 缺 Root Cause（"少量"） |
| 误阻断2（≥420 assistant entry 耗尽闸门三，F257 既有预期行为） | 核对 `EARLIEST_FIX_ENTRY_DEFER_LIMIT`/`NON_BLOCK_ENTRY_LIMIT` 源码常量 | **未找到反例**：常量确为 420；机制为 F257 既有基建、非 F289 新引入，未独立构造 420+ 行会话复现（超出本次抽样预算，风险低——非本卡改动面） |
| 边界3（resume 到极早期 fix 无提名⇒不绑定，漏判非误判） | 与既有 A2 用例（resume 无提名⇒零判定）行为一致；未额外反证 | 未独立反证，属既有测试覆盖的设计边界，非本次新增经验性声称 |
| 残余4（sidechain 标记可 rm，无 transcript 侧兜底） | 独立脚本：写标记→阻断(exit2)→rm 标记+清状态→再评估 | **未找到反例**：before=2, after=0，标记删除后确实退回不绑定 |
| 残余5（(b) 只认 Write/Edit×fix-report.md，不含 Bash/verification-report） | 独立脚本两组反例尝试：① 纯 `sed -i` 编辑 fix-report.md（无 Write/Edit 工具）② 只 Write verification-report.md（不碰 fix-report.md） | **均未找到反例**：①②均 exit 0 不绑定，与残余5描述一致；且代码读确认 `ARTIFACT_WRITER_TOOL_NAMES = {Write, Edit}` 与 `ANCHORED_ARTIFACT_PATH_REGEX` 精确锚定 `fix-report.md` |
| 残余6（拆会话逃 implement 委派，已豁免仍严于现状） | 设计声明，非经验性可证伪命题 | 未独立反证（本身即"已豁免"的既定设计，无"反例"概念可套用） |
| 残余7（(a) resume 383 份 0 命中；(c) sidechain 1 命中即诱饵） | 全量 390 份主 transcript 裸 grep 命中 6 份"skills/spec-driver-resume"字样，逐份用**真实** `detectFixSkillExpansion` 结构化重新核验 | **未找到反例，且方法论上有重要发现**：6 份裸 grep 命中里，5 份可读取解析，`earliestResumeLineIndex`/`latestResumeLineIndex` **全部为 null**（真实结构化 0 命中）；1 份因本会话自身 transcript 超 `MAX_TRANSCRIPT_BYTES` 未读（覆盖 389/390，非 100%）。裸 grep 的假阳性系命中 SKILL.md 自述文本等非展开语境，印证残余7 statement 的"0 命中"经得起更大样本 + 更严格方法复核 |
| 残余8（Tier2 放行地板=1 次任意 review 类委派，合同拍板） | 设计声明 | 未独立反证（拍板决策，非可证伪的经验性数字声称） |
| **残余9**（跨目标 per-session 复用，未声称已修） | §2(c) 端到端复现 | **PASS，见 §2(c) 专项**：诚实性确认 |
| **残余10**（sidechain 无提名不覆盖） | §2(b) 端到端复现 | **PASS，见 §2(b) 专项**：诚实性确认 |

## ⑥ 三档发现

- **CRITICAL：0**
- **WARNING：1** —— SC-005 的 `max=4.79ms` 更可能反映 JIT 预热稳态而非生产真实的单次冷启动（实测冷调用 6.58–6.83ms）；不影响"≤10ms 预算内"结论（仍有 ~32% 余量），登记为文档精度问题，非功能缺陷，不建议阻断合入。
- **INFO：4**
  1. 误阻断1 数字精确匹配实测（22/89≈24.7% 缺 verification-report；7/89≈7.9% 缺 Root Cause）。
  2. 误阻断2 引用的 `EARLIEST_FIX_ENTRY_DEFER_LIMIT`/`NON_BLOCK_ENTRY_LIMIT`=420 与源码常量核对一致。
  3. 残余7 (a) 核验过程发现：裸 grep 对 skill 展开类声称不可靠（SKILL.md 自述文本会造成假阳性），必须用结构化 `detectFixSkillExpansion` 复核——本报告 §5 已按此方法论修正后确认结论仍成立。
  4. 8 份分层抽样全部 `no-fix-expansion`，且本机语料已从文档记录的 624 份增长到 693 份（自然增长，非异常）；389/390 份主 transcript 完成 resume 结构化核验，1 份因本会话自身体积超限跳过（覆盖率非 100%，如实登记）。

## ⑦ worktree 收尾核对（未改动证据）

```
git status --short                    → 空
git diff --stat                       → 空
git log -1 --format='%H'              → 493ce5c7148ed269afbbd4a1f895f5fac604608e（与任务指定 HEAD 一致）
md5(fix-compliance-judge.mjs)         == md5(git show HEAD:...fix-compliance-judge.mjs)
md5(fix-compliance-sidechain-marker.mjs) == md5(git show HEAD:...fix-compliance-sidechain-marker.mjs)
```

未执行 `git stash` / `git checkout <path>` / `git add` / commit / push；未修改 `specs/src.spec.md`（未触碰）；6 处变异全部通过 `cp` 备份 + 精确字面替换 + `cp` 还原 + `diff`/`md5` 双重确认清零。

## ⑧ 工具使用反馈（dogfooding）

- 本次未用 Spectra MCP：核验对象是判定器链 4 个 `.mjs` + 1 个 shell 脚本的行为契约（exit code / stderr / 落盘事件），Spectra 的 symbol/impact 图谱对这类"运行时行为断言"帮助有限；已读代码路径明确（`detectTier2Binding` / `collectArtifactWriteWitnesses` / `resolveFeatureDirCandidate` 等），直接 Grep + Read 更快。
- Spec Driver：本次是 verify 子代理独立核验、非完整 spec-driver 编排流程，无 phase/gate 交互可反馈。

## 一行结论

CRITICAL 0 / WARNING 1 / INFO 4；(a) 同目标编辑循环自愈 = **PASS**（`2,2,0,0,0`，未永久 fail-closed）；(b) sidechain 无提名不绑定 = **PASS**（无提名恒 exit 0/tier:null/零落盘，有提名才 Tier2 阻断）；(c) 跨目标 per-session 复用残余**如实复现**（Fix-A 付 2 次阻断后 Fix-B 首评 0 往返放行），fix-report/spec 对该残余"未声称已修"的诚实性核验通过；6/6 变异精确复现预期红且隔离度良好；未发现假绿或 over-claim，**建议维持既有交付结论（可合入）**。
