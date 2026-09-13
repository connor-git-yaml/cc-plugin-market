# F289 · fix-compliance 续做 / 旁链入口收口（Tier 2 续做合同）

> 模式：spec-driver fix（门禁 / 判定器类：**常设异构对抗**——spec 阶段 ×2（绕过面 / 误伤面）+ implement 阶段 ×2 + verify 子代理；Codex 审查暂停，异构档位缺席）。
> 来源：`docs/design/fix-compliance-continuation-binding-design.md`（parked 定稿）；前置 F270 / F287 卡 A / F288 卡 B 均已合入。
> 基线：`22529ff8`（F288 分支）→ rebase 到 F288 合入后的 origin/master。

## 1. 问题与证据（改动前）

| # | 缺陷 | 证据 |
|---|---|---|
| 1 | `isFix` 只认主 transcript 的 `spec-driver-fix` 展开：resume 入口（`spec-driver-resume` 展开被同一正则捕获但只落 `resume` 计数）、裸会话续做、sidechain 内展开三种形态全部零判定 | `core.detectFixSkillExpansion` 只为 `fix` 记基线；F257 实证「子代理写制品主 transcript 结构性不可见」 |
| 2 | F288 的放行佐证 / 指纹分量 / 反馈计数全部以 `anchor.latestFixLineIndex` 为窗口起点：无 fix 展开 ⇒ 全为 null ⇒ 即使强行进入判定也会佐证恒 0（无界阻断）或指纹 null | judge 九处 `anchor.*` 消费点 |
| 3 | Codex 侧无 `agent_transcript_path` 语义，SubagentStop 事件不存在；分发面若把新 hook 当 owned 会被 F283 generator fail-loud 拒绝 | `codex-hooks-generator` 非产品事件未知 handler 抛错（本卡首跑实证） |

## 2. 修复（承接 spec §3–§5）

### 两级互斥 + 有效锚点（judge）

- `evaluate` 非 fix 分支：仅 Claude 方言评估 `detectTier2Binding(entries, projectRoot, sessionId, anchor)`；未命中走既有零接触早退（诊断不变，`tier: null`）；命中则 `tier = 2`，`effective` 锚点 = 绑定源锚点（resume 展开行 / 会话起点 `-1`），**九处 `anchor.*` 消费点全部改为 `effective.*`**，F288 的佐证 / 指纹 / 反馈计数 / 提名 / 见证 / 委派 / 执行记录 / 在途窗口在 Tier 2 下自然成立。
- Tier 1 路径逐字不变：`isFix === true` 时 `effective === anchor`，judge-cli / card-a / card-b 三套零翻转（D1 守卫）。

### 三源二级证据

- (a) resume：`core.detectFixSkillExpansion` 同趟累计 `latestResumeLineIndex / latestResumeTimestamp`；judge 以其为锚跑既有 `resolveFeatureDirCandidate`，**无提名不绑定**（feature / story 续做零判定，spec §7 对照组）。
- (b) 写入见证：`collectArtifactWriteWitnessDirs(entries, -1, projectRoot)`（会话起点），多目录取最晚；只认 Write / Edit / 带写指示符 Bash + 成功回执。
- (c) sidechain：新 `hooks/subagent-stop-fix-marker.sh`（薄壳，恒 exit 0 零输出，`SIDECHAIN_MARKER_CLI` 可覆盖）→ `lib/fix-compliance-sidechain-marker.mjs`（形状守卫 / Codex 静默 / 单趟 `detectFixSkillExpansion` / `MAX_TRANSCRIPT_BYTES` / 失败只进 `.sidechain-selfdiag.jsonl`）→ `io.writeSidechainMarker` 写 `<sid>.sidechain.<agent>.json`；judge 侧 `io.listSidechainMarkers` 只读本会话标记（`resetBlockState` 不删）。**不做在途判定**（T-2 陷阱）。

### 续做合同（core）

- `judgeCompliance({ tier2 })`：Tier 2 只跳过 `delegation:implement`；`DEFERRABLE_MISSING_KEYS` / no-op path B / 制品齐全判据原样（U3 钉住豁免面只有一项）。

### 可观测性 / 分发

- `JUDGE_DIAGNOSTICS` +3 不可见码 `tier2-bound-resume|witness|sidechain`（多源命中全部保留）；审计事件 `tier: 1|2|null`；report 模式 `tier / tier2Source`；schema enum + `tier` 字段；`missing` 枚举不新增。
- `hooks.json` +`SubagentStop`；脚本登记 `CLAUDE_ONLY_HOOK_SCRIPT_SUFFIXES`（不进 `OWNED_HOOK_EXPECTED_EVENT`，Codex 不分发）；F283 归属派生测试改按登记表剔除（不再硬编码单个文件名）。
- judge 的 EAGAIN 安全 `readStdinSync` 下沉到 io，SubagentStop CLI 复用（`cat | node` 同形态）。

## 3. 红先行 / 守护

- 新套件 `plugins/spec-driver/tests/fix-compliance-tier2-continuation.test.mjs`（**23**：16 基线 + spec 阶段 A4/A5/C4/C5 + implement 阶段 E1/E2/E3）：U1–U5 单元（resume 累计 / 标记写读 / implement 豁免 / 豁免面唯一 / 形状守卫）；A1–A3 resume 有提名阻断 · 无提名零判定 · Tier 1 优先；B1–B3 见证绑定 · 非制品写不绑 · 合规放行；C1–C3 标记绑定 · 跨会话不绑 · CLI 端到端写标记；D1 Tier 1 零翻转（judge-cli 全量在同一进程树复跑）+ D2 源码守卫（CLI 单趟 / 上限 / 恒 exit 0）。
- 既有：judge-cli 全量 + card-a 20 + card-b 22 零翻转；codex-hooks 五套 vitest + F283 派生测试零翻转；`test:plugins` 1902/0；vitest 8226/0。
- 变异清单（verify 执行）：M-a `detectTier2Binding` 恒 null（A/B/C 全红）；M-b resume 提名跳过 `resolveFeatureDirCandidate` 直接绑定（A2 红）；M-c 见证窗口改 `effective.latestFixLineIndex`（B1 红）；M-d `listSidechainMarkers` 不比 session（C2 红）；M-e `tier2` 豁免扩大到 verify（U3 红）；M-f CLI 去掉形状守卫（U5 红）；M-g `effective` 回退 `anchor`（Tier 2 下佐证恒 0：A1 反馈计数断言红）。

## 4. 如实登记（代价 / 残余 / 移交 M11）

- **标记可 `rm`**：sidechain 标记无 transcript 侧对账兜底，弱于 Tier 1（spec §7 用户认可）。
- **拆会话逃 implement 委派**：Tier 2 已豁免 implement，仍严于现状（现状零判定）。
- **(b) 以会话起点为锚**：同会话前段无关流程的 verify 委派 / 阻断反馈会被算进窗口（fail-open 于误阻断，不影响放行地板）。
- **transcript 截断清零** 等 Tier 1 共性弱点不变。
- **Codex 方言**：Tier 2 不评估（无 SubagentStop、resume 展开形态未采样）；Codex 侧 resume / 裸会话续做仍零判定——移交 M11（需 Codex 语料采样）。
- **真实 sidechain 分位数**：CLI 单趟 + 上限，但真实子代理 transcript 体积分布未实测（verify 用本机语料抽样补）。

## 5. 影响范围

- `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs`（resume 累计 + tier2 豁免）、`lib/fix-compliance-io.mjs`（标记 io + `readStdinSync`）、`lib/fix-compliance-sidechain-marker.mjs`（新）、`fix-compliance-judge.mjs`（Tier 2 绑定 + 有效锚点 + 可观测性）、`hooks/subagent-stop-fix-marker.sh`（新）、`hooks/hooks.json`、`lib/codex-hooks-schema.mjs`（Claude 独有登记）。
- 合同：`specs/208/.../fix-compliance-verdict-event.schema.json`（+3 码 + `tier`）、`contracts/fix-compliance-judge-cli.md`（Tier 2 新节）。
- 消费方：审计事件多 1 个可选字段 + 3 个可选码；report 模式多两个字段；Claude 插件多一个 SubagentStop hook（恒 exit 0）。

## 6. 验证（主线程）

- 新套件 **23/0**；judge-cli / card-a / card-b 零翻转；合并态（rebase 到 F288 c63d44ba 后）broad 套件 950/0；`test:plugins` / vitest / build / repo:check 于 push 前全量门禁复跑（见 §6 门禁行）。
- rebase 到 F288 合入后 master 再跑全量 + release:check（push 前复核）。

## 7. 对抗复审处置

门禁 / 判定器类常设异构对抗：**spec 阶段** ×2（绕过面 `abd513af` / 误伤面 `a026dc83`，各 3C + 大量 W/I，两路 CRITICAL 高度收敛）已处置于下；**implement 阶段** ×2 + verify 子代理见后续。Codex 审查暂停，异构档位缺席。

### spec 阶段 CRITICAL（两路收敛为四类定义层缺陷，均已改 spec + 实现）

| # | 发现（两路） | 处置 |
|---|---|---|
| C-1 绑定锚点用最晚 / 信任模型反转 | (a) 用**最晚** resume 展开为锚 ⟹ 尾部再展开一次 resume 零往返解绑（比 Tier 1 更糟：绑定本身依赖它）；(c) sidechain 首条 user 文本 = 父编排器 prompt，按 harness 采信错误 ⟹ 真实语料唯一 (c) 命中就是 prompt 引用诱饵，端到端复现为误阻断 | **已改**：(a) `detectFixSkillExpansion` 增记 `earliestResumeLineIndex`，绑定用**最早**；(c) `normalizeTranscriptEntry` 透传 `isMeta`，sidechain CLI 传 `detectFixSkillExpansion(entries, { requireMeta: true })` 只认 `isMeta===true`（父 prompt 引用 isMeta=false 排除）。新测试 A4（尾部重展开不解绑）/ C5（引用诱饵不检出） |
| C-2 单锚点坍缩 / 有效锚点喂 -1 | (b)/(c) 锚 = 会话起点 ⟹ 闸门三从 line 0（长会话 in-flight verify 无法推迟 = 误阻断）、账本 sinceTs=null（补充恒空 = 误阻断）、420 backstop 从 line 0（长会话首停零往返放行 = 误放行）；FR-001「语义零改动」结构性不可能 | **已改**：`collectArtifactWriteWitnesses` 返回有序 `{dir,lineIndex,timestamp}`；`detectTier2Binding` 每源给**真实绑定事件行**（resume=最早 resume；witness=首条见证行；sidechain=见证行或回落 -1），primary = 有真实行号里最早那个。420 backstop 已由 **F288 卡 B C-1** 关闭为非放行腿 ⟹ 误放行面在本卡 rebase 后自动消失。FR-001/§4 改为「Tier 1 零改动，Tier 2 各窗口按真实锚点」 |
| C-3 (b) 合同与实现不符 | FR-003/US2 写「Write/Edit/Bash × fix-report 或 verification-report」，实现 `collectArtifactWriteWitnessDirs` 只认 Write/Edit × fix-report.md（扩 verification-report / Bash 即复活 F257 第 3 轮绕过） | **已改 spec**（不改实现——实现是安全的那侧）：FR-003/§4/US2 改为「Write/Edit × fix-report.md × 成功回执」，heredoc / cp / 只写 verification-report / sed-i 编辑均登记为残余 5（fail-open 漏判，刻意不扩） |
| C-4 项目闸缺失 | SubagentStop CLI 的 `appendSelfdiag` / marker 写无 `isSpecDriverProject` 白名单 ⟹ 非 spec-driver 项目每个子代理停止都凭空建 `.specify/`（与 F270 采集器 CRITICAL-2 同型） | **已改**：`ledger-writer.isSpecDriverProject` 导出复用，置于 `recordSidechainFixMarker` 最前（早于任何 selfdiag / marker 写）。新测试 C4（非 spec-driver 项目零落盘） |

### spec 阶段 WARNING（处置摘要）

- W-1（(a) 0 语料 + resume skill 无 fix 恢复）/ W-6（旧目录约 1/4 缺 verification-report、误阻断 1 代价被低估）/ W-9（Tier 2 地板 = 1 次 review 委派、串号）→ **§7 残余 1/7/8 如实登记**；(a) 明标「前向结构占位」，resume fix 恢复列 §8 独立跟进卡。
- W-2（可观测性反了：绑定用户看不到为何按 fix 判）→ **登记 + 跟进项**（不在本卡改 stderr 文案：审计事件已带 `tier` + `tier2-bound-*` 便于离线核对；给被阻断 agent 加「本会话因 <源> 绑定为 fix 续做、目录 <dir>」的可见首行需跨 routeBlockEnforcement→emitBlock 多层加参，会动到刚交付的 F288 卡 B 路由签名——为不给安全门叠新风险，列 M11 跟进）。
- W-3（(c) sidechain 内部 verify 委派不计，US3 结构性阻断）→ FR-006 明示「主线程 transcript ∪ 主线程账本」，§7 残余登记。
- W-4（FR-009/012/SC-004 与实现矛盾）→ **已对齐 Claude-only**：spec FR-009/012 + SC-004 改为 OWNED 6 条 + Claude 独有表含新脚本；实现 `codex-hooks-schema` 已是该状态。
- W-5（主 Stop / SubagentStop projectRoot 同源未证，worktree 隔离）→ **K-5 登记待探针**。
- W-7 §7 缺项 / W-8 标记无 TTL/sweep / W-10 no-op path B 跨会话 → **§7 残余 + K-6 登记**。
- W-5(A)/W-6(A) `JUDGE_FILE_SET` 覆盖不到检测侧 / SC-004 引用悬空 → SC-004 改为核对 Claude 独有表条目所挂事件；judge 不 import 新 lib 故 `JUDGE_FILE_SET` 不变（检测侧闭包 doctor 覆盖列 M11）。
- W-7(A) SC-005/FR-011 不可机械验收 → 改为结构钉 + 绝对预算（≤10ms @ 真实 p99），分位数写验证报告。

### INFO（已采纳）

- A-I2 / B-I2 SC-004 引用「FR-002b」悬空 → 改为核对事件归属。
- B-I3 真实 payload fixture 的 `agent_transcript_path` 脱敏 → SC-001 真实 payload 用例须覆盖该字段（verify 执行）。
- 其余（tool_result 不入 textBlocks 已挡伪造 / DEFERRABLE 不受 tier2 影响 / 现场 rebase 漂移）记录为背景。

### 现场说明（两路 I-1 / 附带）

两路审查在 rebase 中途 + 实现并发漂移的树上进行（spec 与 impl 并行改），故上述以**当前 HEAD 的 spec + 实现**为准重新对账；spec:5「基线 b9a4aa92」在审查时不实，已随 rebase 到 F288 合入后 master 校正。dogfooding 账本记一条「对抗审查应冻结 commit 作基线」（见 §8）。


### implement 阶段 CRITICAL 处置（两路 ×2C + delta 复审两路 ×3C/1C，三轮收敛后终态）

门禁 / 判定器类常设异构对抗：implement 阶段 ×2（绕过 a5299 / 误伤 ad0936）+ **delta 复审** ×2（绕过 ac3ec8 / 误伤 a56c60，专审前一轮修复）。**关键教训：本卡 Tier 2 的两处 fix 各自引入过反向缺陷**（earliest 锚→跨目标 fail-open；latest-activity 锚→同目标 fail-closed），delta 复审各抓一次，故终态是"收敛到安全最小面 + 如实登记两处争议残余"，而非叠更多机制。

| 缺陷 | 三轮演进 | 终态处置 |
|---|---|---|
| **跨目标阻断预算复用**（绕过面 a5299 impl-C1 / delta ac3ec8 C-1）：Fix-A 耗尽 2 次阻断后，同会话全新 Fix-B 复用 Fix-A 历史回灌 0 往返放行 | ① earliest 锚（spec 阶段修 C-1）留此洞；② 我改「佐证锚=最晚绑定活动行」试图前移窗口——**被 delta 误伤面 a56c60 实测证伪**：把「同目标合法重复编辑 fix-report 响应每次阻断」也前移窗口，诚实用户 release valve **8 轮零自愈**（改动前第 3 轮即愈），且 delta 绕过面证 Bash-pivot 仍绕过（修不彻底）——比要修的洞更严重 | **已还原**为 F288 per-session 佐证窗口（`effective.latestFixLineIndex`，同目标正常自愈，E1 回归钉住 2,2,0）。跨目标复用作为「**阻断预算按 session 非按目标**」的既有 F288 设计**如实登记为残余**（前提：Fix-A 须先付 2 次真实阻断；Tier 2 新基建真实语料 0 例；本门为合规**推动**非硬边界，会话付过 2 次阻断后 per-session 降级本就是设计语义）。**根治=per-target 阻断预算**，需改 F288 状态模型（`<sid>` 键→`<sid>+dir`），**移交 M11 独立立卡**（不在已交付安全门上同 session 叠第三次重构）。 |
| **sidechain 无提名判定方向**（误伤面 ad0936 C-1：硬阻断误伤 / delta 绕过 ac3ec8 C-3：F224 宽松免费通行）——两路**方向相反** | ① 原 `{ambiguous:false}` 落不可推迟硬阻断（误伤，短会话即中）；② 我改 `{ambiguous:true}` 接 F224 宽松——**被 delta 绕过面证**廉价子代理 + 一次文本匹配 verify 委派 = 全新会话免费通行 | **收敛到第三方向（与 (a) resume 源对称）**：main/carried **双空 ⟹ 不绑定 Tier 2**（未识别为 fix 续做，走既有非 fix 早退 exit 0 零落盘）——既非硬阻断（消除误伤）、亦非 F224 宽松免费通行（消除绕过）。有提名（main 或标记携带 candidatePath）才绑定。E2 回归钉（无提名有/无 verify 均 exit 0 零落盘 + tier:null；携带 candidatePath 才 Tier 2 阻断）。残余：无处定位 fix 目录的 sidechain 续做**不被门禁覆盖**（漏判 fail-open，与 resume 无提名对称、诚实上限）。 |
| **fix-report over-claim**（delta ac3ec8 C-2）：早稿「佐证锚逐目标前移堵住复用面」表述超实际 | 佐证锚机制已还原、不再存在 | 本节 + §7 残余已改为如实「per-session 预算 + 跨目标残余 + M11」，不写「已堵」。 |
| **C-2 修复无回归覆盖**（误伤面 ad0936 C-2）：闸门三真实锚 / 账本 sinceTs 可被撤销而测试全绿 | — | E3 钉账本 sinceTs 真实窗口（锚后补充放行 / 锚前排除阻断，改 null 即翻红）；闸门三真实锚的长会话耗尽按 Probe 4 如实登记为 F257 有界化预期（spec §7 误阻断 2 已改） |

### implement / delta 阶段 WARNING / INFO 处置

- 绕过 a5299 W-1/W-2（witness 锚回 -1 / 排序反转全绿）+ delta ac3ec8 变异「Math.max→Math.min 全绿」→ 佐证锚机制已还原，相关变异面消失；E1（同目标自愈）+ E2（sidechain 绑定门）为终态承重回归钉。
- 误伤 ad0936 W-1（SC-001 (b)/(c) 缺独立自愈用例）→ 自愈三源共享同段（`BLOCK_LIMIT`/佐证），A3 + E1 已验；(c) 自愈与 (a)/(b) 正交，验证报告显式外推。
- 计数口径（16→23 / card-b 22→26）已更正（§3/§6）。
- SC-005 分母 → 固定「N=624 全量真实 sidechain，p99=4.19ms / 冷启动 max≈6.83ms」（§6）。
- `.specify` 软链借壳（绕过 a5299 INFO-2）→ 写沿软链落回真项目、非本地凭空建目录，需本地手工放软链，登记不修。
- 审计事件 tier 归属（F224 fail-open 早退事件不带 tier；--mode report 带）→ 既有面，登记 M11（Tier 2 阻断可见性一并）。

## 8. 工具使用反馈（dogfooding）

- 本次未用 Spectra MCP：改动集中在判定器链四个 .mjs + 一个 shell，调用链由 F288 同批次直读钉死；本 worktree 图 stale。
- Spec Driver：按 fix 骨架手工执行；SubagentStop 事件在 Codex 分发面首跑即被 generator fail-loud 拒绝——归属表缺「Claude 独有 hook」的一等登记通道（本卡用 `CLAUDE_ONLY_HOOK_SCRIPT_SUFFIXES` 补）；对抗档位仍缺变异运行器骨架（同 F284 账本条目，不重复落账）。
