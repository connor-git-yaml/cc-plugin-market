# GATE_DESIGN 对抗第 5 轮（卡 C 终版）· 处置记录

**结果**：绕过面 2C/3W，误伤面 2C/5W/1I。**四条 CRITICAL 均不要求改核心机制**（方向 + 反馈计数上界两轮未被击穿），
要求的是：计数窗口基线换向、措辞纠正、登记既有相邻向量、补入库守卫。修订后跑第 6 轮。

## 一、CRITICAL 裁决

### R5-1 🔴 reset 不对称 ⟹ 同会话第 2 段不合规 0 次往返（绕过面 C-1）
`blockCount` 可被合规 reset，反馈计数（基线 `earliestFixLineIndex`，会话级）**不可 reset** ⟹ 付过 2 次往返后，修好存储→合规→再坏，首个 Stop 即放行。§1「不存在 0 次往返路径」被证伪。
**裁决**：计数窗口基线改为 **`latestFixLineIndex`**（最晚一次 fix 展开）。方向论证（**不得**照抄闸门三的 earliest 约定，两者方向相反）：
- 本计数器「窗口变窄 ⟹ 计数变少 ⟹ 更晚放行」＝ **fail-closed**；被判方重展开 fix 只会让自己多挨阻断；
- 闸门三用 earliest 是因为它的方向相反（重展开缩窗 ⟹ 推迟预算复活 ⟹ fail-open），护栏 R-5 只约束闸门三，不约束本计数器；
- 诚实多 feature 会话每段以新的 `/spec-driver-fix` 展开开头 ⟹ 窗口自然重置，与 reset 语义一致。
**残余登记**（§8 新增 ⑨）：同一段内（无重展开）修好→合规→再坏 ⟹ 0 次往返；上界＝「每段 2 次往返」，不可自愈，方向对被判方无新增收益（该段已付 2 次）。
**不加**任何可擦的 reset 锚（擦掉 ⟹ 计数变多 ⟹ 放行方向，比现在更坏）。
补 **E-m**：坏→2 次 exit 2→放行→合规 reset→**重展开 fix**→再坏 ⟹ 第 1 次 Stop 仍 exit 2。

### R5-2 🔴 既有相邻向量：预置状态文件 `{"blockCount":2,"degradedRecorded":true}` ⟹ 0 次往返 + 零终态（绕过面 C-2）
状态文件在被判方写域，与 `!saved.ok` 无关、**改动前就存在**（第 2 轮 I-B 表已列为既有 0 成本项）。
**裁决**：不在卡 C 范围（卡 C 只修 `!saved.ok`）；**显式登记**进 fix-report 移交表与 plan §8，移交 **卡 B**（状态文件完整性与锁/幂等同属一域）。禁止再写「不存在 0 次往返路径」——正确表述：「`!saved.ok` 分支不再提供 0 次往返路径；状态文件预置属既有相邻向量，移交」。

### R5-3 🔴 stderr 补救口是假的（误伤面 R5-1）
hook 进程 env 来自 CC 启动快照，会话内 `export` 到不了（POSIX）；且与 §8⑧「hook 配置启动快照」同一事实，plan 自相矛盾。
**裁决**：stderr 按**生效即时性**排序：① 修路径（`chmod u+w` / 释放磁盘 / 清掉占位）——下一次 Stop 立即生效；② `fix_compliance.enforcement: warn|off`——配置每次 Stop 重读（主线程核实 `findConfigFile` 每进程调用）；③ `SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP=<dir> claude` **须重启会话**。§8 「可自愈」列同步改。关键句并进**首行 token 同一行**（误伤面 R5-4）。

### R5-4 🔴 P-1 探针在 CI 永远 skip（误伤面 R5-2）
**裁决**：入库脱敏 fixture `tests/fixtures/fix-compliance/real-stop-hook-feedback-entries.jsonl`（3 条：1 条命中 + 1 条 `tool_result` 型 user + 1 条 assistant 含串），断言谓词命中 1/排除 2；照 `f270-real-corpus.test.mjs:112-118` 加脱敏完整性用例；README 索引。P-1 本机扫描保留作漂移侦测。主线程已备好三条原样本（scratch），脱敏字段：session/uuid/parentUuid/promptId/cwd/绝对路径/用户名/gitBranch/时间戳；**保留** `Stop hook feedback:` 前缀、`[<cmd>]: ` 段、content 类型、块数、harness `version`。

## 二、采纳的 WARNING
| # | 裁决 |
|---|---|
| R5-5（绕过 W-1）| 守护面＝「本周期所有阻断型 hook 的 stderr 合并体」。加源码守卫：`plugins/spec-driver/hooks/*.sh` 与 judge 之外的 stderr 生产方**不得含 token**（`stop-task-check.sh` 会 echo 目录名，目录可叫 token；今天它 exit 0 无害，改阻断即 0 成本投喂）|
| R5-6（绕过 W-2）| 基线缺席 ⟹ **return 0**（不是 −1：对本计数器 −1 ⟹ 全量计数 ⟹ 放行方向）。U-7 钉住 |
| R5-7（绕过 W-3 / 误伤遗留）| 双注册同周期是否产 2 条反馈条目 **无样本**，最坏地板 2→1。并入 §8⑧ 同一未知；E-a 追加同周期跑 2 次 CLI 的实跑记录退出序列 |
| R5-8（误伤 R5-3）| E-j 加 root skip 守卫，照抄 `ledger-writer.test.mjs:251`（`process.getuid?.()===0`）|
| R5-9（误伤 R5-5）| 补 **E-n**：两级不可写 + **合规** ⟹ exit 0、stderr 空、不含 token |
| R5-10（误伤 R5-6）| C3 交接注释改「当前只有原样带回、无递增方；带回逻辑属不可删面；递增方留给卡 B；**该字段不可单独作预算**，除非同时定义不可伪造性」；护栏表补一行 |
| R5-11（误伤 R5-8）| errno 按主线程实跑值：目录占位 → `write EISDIR`；文件占位 → `mkdir EEXIST`；tmp 指向文件 → `mkdir ENOTDIR`。`errors[]` 加 `stage:'mkdir'|'write'`（零判定消费），stderr 渲染 `主路径 <p>: mkdir EEXIST` |
| R5-12（误伤 R5-9）| §8③ 改：用户粘贴含 token 的反馈原文可命中谓词（至多 2 条即跳过地板），登记为已接受、不加防线（绕过面实测：UI 粘贴物以 `[FIX-COMPLIANCE]` 起头、无 `Stop hook feedback:` 包装 ⟹ 通常不命中；两路结论并列登记）|
| R5-13（误伤 R5-7 范围）| **砍 E-l**（依赖 macOS SSV，Linux CI 守护为零）→ 改源码守卫「judge/core/io 不含 `ENOSPC|EDQUOT|EROFS` 字面量」；§2 移交行压成一行指针（FR 矩阵保留，理由在 handoff/）；§8⑧ 压一行 + 指针 |
| R5-14（绕过 I）| U-3 写明 `startsWith` 的真正承重理由：技能展开注入的 user 单文本块恒以 `Base directory for this skill:` 起头（实测），被判方自写 SKILL 正文永远不在 offset 0 |

## 三、确证站得住（两轮未被击穿）
- 方向（`!saved.ok` 一律 exit 2）与上界（反馈计数 ≥ BLOCK_LIMIT）。
- 窗口不可被推前（`earliest` 一次写定；改用 `latest` 后重展开只会缩窗＝自伤）。
- assistant 侧 / `tool_result` 型 / exit-0 hook stderr / warn 档 / defer 路径均不能投喂（890 份实扫 29/29 单段、0 条 exit-0 并入）。
- 软链「先写成功后消失」变体不影响计数（走正常分支不打 token）。
- `nonBlockStopCount` 零消费者、零阈值。
