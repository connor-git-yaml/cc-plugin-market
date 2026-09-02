# GATE_DESIGN 对抗第 6 轮（卡 C）· 处置记录

## 一、误伤面（2C / 5W）——**均为措辞精度与守卫强度，不触及机制**

| # | 裁决 |
|---|---|
| **R6-1 🔴**（C-1） | `latest` 基线的诚实代价登记不实：真值是「**每段 fix 展开 2 次**」（× compaction 次数）。§1「所有存储故障用户经历相同的 2 次往返」已被自己证伪。处置：§1 与 §8① 上界列改「2 × fix 展开段数」；§8 **新增误伤方向一行**（⑨ 是绕过方向，不得合并）。代价可接受（每段起点是用户主动动作、每次阻断带可执行 stderr、换来关闭 0 往返口） |
| **R6-2 🔴**（C-2） | 补救口 ② 未给文件名与嵌套层级；本仓两处配置文件均不存在 ⟹ 要求新建；顶层误写 `enforcement:` ⟹ `undefined ⟹ block` **且零诊断**——与 R5-3 同类「假补救口」。处置：stderr 写全「在 `<projectRoot>/spec-driver.config.yaml` 写入 `fix_compliance:\n  enforcement: warn`」；E-a 断言含文件名与嵌套两段 |
| R6-3（W-1） | `chmod u+w` 对 R5-11 钉的三条 errno（EISDIR/EEXIST/ENOTDIR）无一适用，且渲染的是文件路径、该 chmod 的是父目录。处置：补救首条按 stage/errno 映射：`mkdir EEXIST\|ENOTDIR ⟹ rm 占位物`、`EACCES ⟹ chmod u+w 父目录`、`ENOSPC ⟹ 释放磁盘`（仍零判定消费） |
| R6-4（W-2） | P-2 两条反例都不经 `startsWith` 即被排除 ⟹ 该条件在 P-2 下零守护。处置：补**第 4 条**——真实 skill 展开条目（`type:'user'` 单文本块、首块以 `Base directory for this skill:` 起头）正文注入 token ⟹ 总计仍为 1。P-2 调用写死显式基线 `-1`（纯函数合同：数字基线 ⟹ 计其后条目；U-7 只管 `null/undefined ⟹ 0`） |
| R6-5（W-3） | E-o 改为解析 `hooks.json` 取 command 路径集再扫（含 `scripts/postinstall.sh`），glob ≠ 注册集 |
| R6-6（W-4 / 范围②） | **砍 P-1**（CI 恒 skip、本机 650MB 全量读、选中集为空时静默绿）→ 由 P-2 fixture 的 `version` 字段 + handoff 调研指针替代。实测附记：324 份 / 44174 行 / 1.8s / 六个 harness 版本 `2.1.219→2.1.247` 形态 29/29 一致（这条实证进 U-3 注释） |
| R6-7（W-5） | P-2「原样保留 `[<cmd>]: ` 段」改「保留段结构、替换路径值」（该段本身是绝对路径，与 P-3 互斥） |
| R6-8（范围①） | **砍** E-a 的「同周期跑 2 次 CLI」记录（harness 不在环内，对 §8⑧ 未知零信息量）→ handoff 调研指针 |

未能证伪：双注册阻断型 hook 是否合并成 1 条反馈——本机语料含 2+ hook 段的条目为 **0**（仍无样本，进 handoff）；E-p 只钉三个字面量，`EPERM/ELOOP` 形态的放行分支不被抓（本卡无此分支，登记）。

## 二、绕过面（**0C** / 3W / 1I）——机制面首次零 CRITICAL

| # | 裁决 |
|---|---|
| R6-9（问 1，否定证明） | `latest` 基线不可后移/同号：`lineIndex` 按文件行序单调；`detectFixSkillExpansion` 只收 user、每次命中覆写为当前行；展开块以 `Base directory for this skill:` 起头与反馈块 `startsWith('Stop hook feedback:')` 互斥。**无处置** |
| R6-10（问 2，W） | 方向确认（重展开＝缩窗＝自伤）。但 §8⑨「与诚实用户地板相同」over-claim：存储可用者每次合规 reset 后重付 2 次，存储坏者付 2 次后该段其余回合 0 成本 ⟹ 摊销 2/N。处置：上界数字保留，比较句改「每段 2 次；段内回合数不设限，摊销成本随段长下降」 |
| R6-11（问 3，W） | **E-o 守卫搭错面**：它钉「源码不含 token 字面量」，而自陈威胁是 `stop-task-check.sh:18` 回显被判方选定的目录名——该威胁下源码永远不含 token，**守卫恒绿**。处置：E-o 改钉**运行时不变量**——非 judge 的阻断型 Stop hook 不存在（`stop-task-check.sh` 恒 exit 0：以 token 命名的 `specs/` 目录跑该脚本，断言 exit 0）；plan 措辞从「源码级合同」降为「运行时不变量 + 注册集核对」 |
| R6-12（问 3，W） | E-p 只杀三具名码字面量（`'E'+'ROFS'` / `err.errno` 数值 / `EPERM`/`ELOOP` 均不变红；`ln -s a b; ln -s b a` 可带内造两级 ELOOP）。处置：M-8' 的「杀任意 errno 放行分支」降级为「杀三具名码抄回形态」；E-p 排除注释行（防撤回理由写进 JSDoc 即假红） |
| R6-13（问 4，I） | U-7 生产不可达（`isFix ⟺ earliest≠null ⟺ latest≠null`，四个 `verdict:null` 早退 `judge:235/245/290/563` 全在 `routeBlock` 前 return）。保留作前瞻钉，理由补「当前不可达」；§4 C2.1 的「前两个 return」改「所有 verdict:null 返回点（4 处）」 |
| R6-14（问 5） | **最短完全绕过 = 2 次 Stop 往返**，与声称地板一致；1 次不可达（按条目计、同周期合并仍 1 条、exit-0 stderr 不回灌）。附记：两级默认路径均在被判方写域，`touch .specify/runs/.fix-compliance-state` + `touch $TMPDIR/spec-driver-fix-compliance` 即可，**不需要 env 注入**（E-a 用 env 只是复现手段——U-3/E-a 注释写明） |

## 三、结论
机制面（方向 + `latest` 窗口 + 反馈计数上界）在第 6 轮绕过面 **0 CRITICAL**；误伤面 2 条 CRITICAL 均为措辞精度。
按卡面「至零新 CRITICAL」：修订 R6-1..R6-14 后跑**第 7 轮合并确认**（两角各一路、短程），零 CRITICAL 即进 tasks。
