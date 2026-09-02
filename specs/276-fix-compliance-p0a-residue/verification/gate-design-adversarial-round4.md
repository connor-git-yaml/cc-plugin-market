# GATE_DESIGN 对抗第 4 轮（卡 C）· 处置记录

**对象**：拆卡后卡 C 的 `plan.md`（231 行）。两路独立子代理（绕过面 / 误伤面）。
**结果**：绕过面 1C/3W/2I，误伤面 2C/4W/4I。**本轮不通过**，修订后跑第 5 轮。

## 一、CRITICAL 裁决

### R4-1 🔴 420 兜底可**自泵**（绕过面 C-1）
`assistantEntriesSinceEarliestFix` 只数 assistant 条目——**全在被判方产出面**。廉价工具调用把它推过 420，再目录占位 ⟹ 首次 Stop `feedbackCount=0` 但 `entryExhausted=true`（析取）⟹ exit 0。**0 次阻断绕过原样复活**，与 plan「成本从 0 抬到 2」直接冲突；本机 P95=392 说明正常会话已贴阈，每 ~34 个会话白送一次。
**归因**：plan 把兜底方向登记成 fail-closed，只算了诚实越阈率没算自泵成本——正是 R2-10 判死 420 时的同一个错，本卡自己又犯一次。
**裁决**：**删除 420 兜底**。该路径不再消费 `assistantEntriesSinceEarliestFix`（顺带让绕过面 W-2「缺席态方向」与 U-5/M-8 整体消失）。

### R4-2 🔴 「storage-free 上界」在磁盘满下并非 storage-free（误伤面 C-1）
ENOSPC 时两级状态与 **transcript 同卷**（macOS `/var/folders` 与 $HOME 同 APFS；容器同 overlay）⟹ harness 写不进反馈条目 ⟹ 计数器恒 0 ⟹ 无界 exit 2。改动前该用户首次 Stop 即放行，改动后 brick。
**归因**：把「不依赖可写路径」误读为「不依赖存储」——transcript 就是存储，且与状态路径相关。
**裁决**：采纳其方案 (b) 的**白名单**形态（不是 R2 判死的黑名单）：
> `saveBlockState` 两级失败时，**仅当每一级的 errno 都 ∈ {ENOSPC, EDQUOT, EROFS}**（环境性耗尽/只读——被判方带内不可诱发或诱发即自毁、且此时 transcript 通道必然同失效）⟹ 维持既有 `releaseDegraded(storageUnavailable:true)`；**其余任何 errno**（EISDIR/ENOTDIR/EACCES/EPERM/EEXIST/ENOENT/…，全部在被判方写域可诱发）⟹ fail-closed，上界 = 反馈条目计数 ≥ `BLOCK_LIMIT`。
与 fix-report「errno 不进判定分支」的表述**冲突，本轮更正**：R2 判死的是「按 errno 猜自诱发」的**黑名单**（换手法即绕过）；白名单只放行**不可诱发**的 errno，方向安全。errno 仍须进 stderr/审计。
**不采纳** `stop_hook_active` 兜底：判定器 `:962-975` 注释与 nine-round-lessons §3 已实证「惩罚动作生成豁免」形态被击穿（最短绕过 2→1），本卡不复活它。

### R4-3 🔴 反馈形态漂移零可发现性（误伤面 C-2）
E-a 由测试自造条目**自证**；`plugins/` 下零处引用真实语料。子代理实扫 324 份 jsonl：14 份含串、32 条 user、**29 条命中谓词**、3 条 `tool_result` 块正确排除、**9 条 assistant 条目含同串**——`role==='user'` 过滤是实证承重。
**裁决**：`plugins/spec-driver/tests/f270-real-corpus.test.mjs` 加真实语料探针（扫 `~/.claude/projects`，存在含 `HOOK_FEEDBACK_PREFIX` 的条目则断言 ≥1 条满足计数器谓词；语料缺席 skip）。`judge:doctor` 探针**不进本卡**（登记移交）。

## 二、采纳的 WARNING
| # | 来源 | 裁决 |
|---|---|---|
| R4-4 | 误伤 W-1 | `appendAuditEvent` 与 `recordWorkflowRun` 都写 `.specify/runs/`（状态目录的**父目录**）⟹ 诚实故障下三者同生共死，plan §8④「同时失效概率低」**事实错误**。改登记为「存储部分可用时终态可见」；补 **E-j**：`chmod 0o500 .specify/runs` + tmpdir 占位，断言实际行为（退出码序列 + 终态/审计条数为 0） |
| R4-5 | 误伤 W-2 | stderr 主消费者是**模型**：现文案 4 行动作行 + 双路径指引全指向「补制品」，模型会烧光预算而人不知情。采纳其措辞：首行 token；第二行「⚠️ 这不是制品问题，模型无法修复：请向用户报告下方路径不可写，勿反复重试补制品」；两级路径 + errno；「可临时绕开：`SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP=<可写目录>`」；最后才是 `buildFeedbackText` |
| R4-6 | 误伤 W-3 | 上界分支硬编码 `['state-storage-unavailable']` 丢弃 upstream 诊断 ⟹ 改 `[...new Set([...extraDiagnostics, 'state-storage-unavailable'])]` |
| R4-7 | 误伤 W-4 | compaction / transcript 换文件 ⟹ 计数器归零（存储仍坏则重吃 2 次）；痕迹未随迁则 `isFix=false` 整体失效。登记为风险 ⑦（双向、不自愈、上界＝每次 compact 重置） |
| R4-8 | 绕过 W-1 | 自注册 Stop hook 打 token + exit 2 可投喂计数器；每条伪造伴随**自家 hook** 的 exit 2，hook 配置会话中途不生效（启动快照）⟹ 成本 = 重启 + N 次往返；多 hook 是否合并成 1 条**无样本**，最坏地板 1 次往返。登记为残余（仍高于已接受的 transcript 篡改 0 成本下界） |
| R4-9 | 绕过 W-3 | E-c/E-e 必须断言 token **不出现**在存储可用 / 单级失败的 stderr（渗漏 + `rm -rf` 状态目录 ⟹ 地板 2→0） |
| R4-10 | 误伤 ⑦ | errno 在 `saveBlockState` 内两次 try/catch 收集，**不改 `tryWriteState` 签名**；砍 E-f（与 U-4 重复）；C3 保留（用户原卡明令删死代码）但作最后一个独立提交 |
| R4-11 | 绕过末条 | 地板表述改为「2 次 Stop **往返**」而非「2 次真实阻断」 |

## 三、确证站得住（不改）
- 单级失败行为与存储可用完全相同（`routeBlock` 只看 `saved.ok`，`degraded/diagnostics` 不进判定）。
- 存储可用路径逐字节不变：`routeBlock` 未导出、唯一调用点 `judge:1075`，report 面显式构造。
- assistant 侧伪造 token 不计数（`role==='user'` + `startsWith` 双条件）；`PREFIX_*` 后接空格不误匹配 token。
- 两条既有用例改写无意图损失；`p3-carry` 改 `saveBlockState` 造数零覆盖损失。
- 计数趟性能：17.1MB/6600 entries 实测 **0.129ms**（解析的 0.6%），独立第二趟即可。
- 删 `routeNonBlock` 后 3 个 `nonblock-*` 成登记零产出码，但 R-12 守卫逐码、无全局反向守卫，**无新盲区**；新 2 码有 E 行为钉。

## 四、未能证伪（诚实登记）
- ENOSPC 下 harness 是否真停止追加 transcript：只读约束未实跑；由同卷推断。白名单裁决对此**不依赖**该推断（白名单放行是既有行为）。
- 反馈形态只覆盖 14 份文件 / 单一 CC 版本——R4-3 探针即为此而设。
- stderr 新增路径行是否污染锚点：已核两条正则对状态路径不命中；实现须把核验扩到整条 stderr。

## 五、R4-2 裁决**撤回**（主线程实跑证伪，2026-09-03）

R4-2 的 errno 白名单在写下当轮即被主线程自己的探针击穿：

```
ln -s /  <tmp>/.fix-compliance-state   →  mkdirSync(recursive) ok，writeFileSync → EROFS
（/System、/bin、/Library/Apple → EPERM；只有 / 根给 EROFS）
```

macOS 密封系统卷的根目录对任何用户都返回 **EROFS**，而 `tryWriteState` 走 `writeFileSync` 会**跟随软链**。
被判方两条 `ln -s /` 即让两级 errno 同为 EROFS ⟹ 白名单放行 ⟹ **0 成本绕过复活**。
补 `realpath` 越界检查能堵这一条，但那是在同一个失效方向上再叠一层判据——本卡前四轮的教训正是「每加一个机制就多一个洞」。

**终裁**：**不设任何 errno 判定分支**。`!saved.ok` 一律 fail-closed，上界＝反馈条目计数 ≥ `BLOCK_LIMIT`。
errno 只进 stderr 与审计。诚实 ENOSPC/EROFS 双故障 ⟹ **可恢复的阻断**：stderr 面向模型明示「这不是制品问题，请向用户报告；
临时绕开 `SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP=<可写目录>`」；磁盘满时 harness 自身已在失效，会话本就不可用，门禁不是主要矛盾。
这条残余按 F257 四要素登记：形态＝双故障；方向＝fail-closed；可自愈＝用户修好存储/改环境变量后下一次 Stop 即恢复；上界＝用户动作而非计数。
新增诊断码由 2 降为 **1**（`storage-unavailable-block-budget-exhausted`），schema enum 27 → 28。
