# 移交包 · 卡 A / 卡 B 的设计资本（F276 拆卡后）

**背景**：F276 原为 P0-A 四组残余的单卡，GATE_DESIGN 三轮六路异构对抗累计 22 CRITICAL 后，
用户拍板（2026-09-02）拆三卡。本目录是**卡 A / 卡 B 的输入**，不是 F276 的交付物。
F276 只交卡 C（`!saved.ok` fail-open 收口），见 `../fix-report.md` §范围裁决 2。

## 文件索引

| 文件 | 内容 | 服务 |
|---|---|---|
| `plan-pre-split-design-capital.md` | 拆卡前完整 plan（978 行）：FR→Phase 覆盖矩阵、G0–G4 五批设计、TDD/变异清单、K-1..K-19 风险登记、已知下界 | 卡 A（G0/G3/G4 段）、卡 B（G1/G2 段） |
| `../verification/gate-design-adversarial-round1.md` | 第 1 轮 8C 处置（D-1..D-8） | 卡 B 为主 |
| `../verification/gate-design-adversarial-round2.md` | 第 2 轮 8C 处置（R2-1..R2-14）+ 实测确证的设计 | 卡 A/B |
| `../verification/mainline-adversarial-pass1.md` | 主线程自审 | — |
| `../research/reverse-census.md` | 五量反向普查（F270 底版增量） | 卡 B |
| `../research/baseline-reproduction.md` | B-1..B-9 改动前基线 | 卡 B |

## 第 3 轮对抗结论（未单独成文，在此落账）

**绕过面**：C-1 级 3 `NONLOCK_DEGRADE_ATTEMPTS` 无合法存储（每次 Stop 是新进程，进程内重试统计不跨 Stop；跨 Stop 只能写状态文件，与级 2「不持久化」自相矛盾）；C-2 `NON_BLOCK_LIMIT ≡ BLOCK_LIMIT` 同一符号，传它作 `blockCount` 会让终态与 `releaseDegraded` 逐字节同形且对真实 0 写 2；W-1 指纹四分量中 3 项在被判方自由生成域但放行地板持平；W-2 磁盘满在 fail-closed 下整场 exit 2 且 420 上界对 97% 会话不可达；W-3 `enforcement` 来源 `spec-driver.config.yaml` 在被判方写域、「已知下界」漏登记（但 `enforcement: off` 本就是更彻底的既有逃逸，无新增绕过）；W-4 `userFacing` 过滤器若只查 judge 表会让 io/core/ledger 的 6 个既有可见码静默消失。
**误伤面**：N3-1 同 W-2；N3-2 该路径零解释零终态；N3-3 同 W-4（现存 10 个可见码删 6 个，且 G0 判据事先赦免收窄）；N3-4 K 表对 R2-1/R2-7 零登记；N3-5 同 C-2；N3-6 `pidStartedAt` 只能 `spawnSync ps`（实测 p50 3.24ms，落在 100% Stop；秒级分辨率与毫秒时刻永不相等 ⟹ 活锁恒被接管）；N3-7 R2-13 过度收窄（27→15 份，DONE 过滤误杀 ≥3 条真 PENDING；`⏸️` 漏裸 `⏸`）；N3-9 建议三卡拆分（已采纳）。

## 主线程对第 3 轮的裁决（卡 B 须承接，不要重新讨论）

1. **删掉级 2 / 级 3**。锁不可得 ⟹ 有界重试后**直接降级为无锁 RMW（＝改动前行为）** + 落 `state-lock-unavailable`；裁决方向不变。不需要任何跨 Stop 状态；被判方长期占锁的全部收益＝把 G1 退回改动前。R2-9 的 reset 问题随之消失。
2. **不做 `pidStartedAt`**（N3-6 实测成本与分辨率错配）。锁归属只做 pid 存活 + 墙钟 300s 兜底；**安全性不押在锁判据上**。
3. `routeNonBlock` 耗尽放行传**真实** `loaded.blockCount`（number，键不消失），靠 `degraded` + `blockCount` 区分；不传 `NON_BLOCK_LIMIT`。
4. `userFacing` 白名单必须覆盖能到达 `buildFeedbackText` 的**全部**码（judge/io/core/ledger 并集），G0 退出判据改「前后可见码集合差集须逐条点名」，不得写「允许收窄」。
5. G3 判据：`⏸️?`；**撤回**「同行含 ✅ 不计」（表格把状态与延期备注写同一 cell）；保留 `(?<!等)待用户`；用**人工真值集 + precision/recall 双报**取代恒真判据。
6b. **既有相邻向量移交卡 B**（第 5 轮 C-2）：预置状态文件 `{"blockCount":2,"degradedRecorded":true}` ⟹ `routeBlock` 首个 Stop 0 次往返放行且零终态（`degradedRecorded:true` 抑制终态写入）。属状态文件完整性域，与锁/幂等同源；卡 B 设计锁与幂等键时须同时定义该文件的不可伪造性（否则任何以它为预算的机制都可被预置耗尽）。
6. R2-1（`!saved.ok`）已从卡 B 剥离 → **卡 C 独立交付**，卡 B 以卡 C 落地后的 `routeBlock` 为基线；`routeNonBlock` 死代码由卡 C 删除，卡 B 按修订后合同**重写**（`buildFeedbackText` 复用 / 真实 `blockCount` / warn 门控 / 所有分支写回指纹）。

## 卡 A/B 须先重审的一条既有处方

- fix-report 拆卡前「同步更新清单」里给卡 A/B 的处方「调用点参数统一为**无默认值** fail-loud（F238 纪律）」**方向已被卡 C 实证为反**（IW-1 + M-14/E-r）：`main` 顶层 `catch { return 0 }` 把 TypeError 兜成放行，忘传＝静默完全绕过。正确形态＝有默认值 + 非法值按 fail-closed 归一。F238 的「required fail-loud」只在**没有** fail-open 兜底的调用链上成立。

## 待调研（卡 C 第 5/6 轮遗留、无样本，勿当已知）

- **双注册阻断型 Stop hook 同周期是否合并成 1 条反馈条目**：本机 324 份语料含 2+ hook 段的条目为 0（仅一个阻断型 hook）。若产 N 条，卡 C 的反馈计数地板由 2 降到 1（§8⑧）。`runCli` 单进程复现对此零信息量（harness 不在环内），需真实双注册会话录制。
- `judge:doctor` 加「反馈条目形态」探针（卡 A G0 可顺带）。
- **既有守护缺口（C1 实现期对抗旁观发现，非本卡引入，未动）**：① `detectFixSkillExpansion` 的 `role !== 'user'` 判据删掉后全套 671 用例仍全绿——锚点反伪造的承重判据零守护，建议另开小卡补变异钉；② `saveBlockState` 写失败会留下 **0 字节状态文件**（非原子覆写），`loadBlockState` 容错跳过但 `blockCount` 被静默归零——正是 P0-D（F267 atomic-write）主题，移交该卡。
- harness 对同周期多个阻断型 Stop hook **拆成多条**反馈条目（对抗方读 CLI 二进制得到的倾向性证据，本机 909 份语料零样本）：若属实，卡 C 的反馈计数地板由 2 对折为 1；hook 配置可能被 settings watcher **热重载**（同样未实跑）。两条都只影响准备成本/倍率，不影响「每条投喂 = 一次往返」。

## 已实测确证、可直接引用的事实（勿重测）

| 事实 | 数据 | 出处 |
|---|---|---|
| Stop hook 阻断反馈在 transcript 的形状 | 84 份文件 / 29 条：`type:'user'`, `isMeta:true`, `userType:'external'`, content 为字符串、以 `Stop hook feedback:\n[<cmd>]: ` 开头 | 主线程 2026-09-02 实扫 |
| **阻断前后 `promptId` 不变** | 样本 2/2：反馈条目 promptId == 前一条 user promptId；之后的 assistant 条目 promptId 为 None | 同上 —— **直证 N3-5 的前提**，卡 B 指纹以 `prompt_id` 为分量时须知：exit 2 回灌不换 prompt_id |
| Stop payload 携带 `prompt_id` | F270 harness-field-probe P-12（真实 Stop payload） | round-2 P-2 关闭 |
| G4 集合归属判据 | 859 份 / 53716 条 assistant：多 text 块 0、空 text 块 0、末条多类型块 0 ⟹ 误判率 0%（裸子串 10.8%）；末条无 text 块 81/857=9.5% ⟹ 键缺席态 | 第 2 轮误伤面实测 |
| G4 耗时 | 17.07MB/6600 entries：parse 57.6ms，集合构造+归属 **0.91ms** | 同上 |
| G3 旧判据命中 | 190 份报告 27 份/81 行；R2-13 收窄后 15 份/59 行；DONE 过滤误杀 ≥3 真 PENDING；裸 `⏸` 190 份中 4 行/3 份 | 第 2/3 轮实测 |
| transcript 可篡改下界 | 截断后 `assistantEntriesSinceEarliestFix` 502→2；删锚点行 `fixSession` 翻 false | 主线程实跑 |
| `!saved.ok` 自诱发 | 两级目录占位 ⟹ 首次 Stop exit 0 | 主线程实跑（卡 C 修） |
| `spawnSync ps -o lstart=` | p50 3.24ms / p100 3.86ms，1 秒分辨率 | 第 3 轮误伤面实测 |
| 闸门三 420 | 本机 P50=202 / P95=392 / 越阈 2.9% | 第 1 轮 W-c |
| 本机最大 transcript | 17.07MB，距 `MAX_TRANSCRIPT_BYTES=20MB` 15% | 第 2 轮 |
| 反馈条目跨 harness 版本形态 | 324 份 / 44174 行 / 六个版本 `2.1.219→2.1.247`：命中前缀 29 条、单文本块 29/29、多块 0（第 6 轮实扫）| 卡 C 入库 fixture 的依据 |
| 两级默认状态路径均在被判方写域 | `touch .specify/runs/.fix-compliance-state` + `touch $TMPDIR/spec-driver-fix-compliance` 即两级不可写，无需 env 注入 | 第 6 轮绕过面 |
| `record-workflow-run.mjs:255` | `blockCount` 仅 `typeof==='number'` 时保留 | 主线程复核 |
