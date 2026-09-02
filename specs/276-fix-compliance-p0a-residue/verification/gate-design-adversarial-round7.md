# GATE_DESIGN 对抗第 7 轮（卡 C · 合并确认）· 处置记录

## 一、绕过面（1C / 4W）——CRITICAL 为 plan 内部自相矛盾，非机制

| # | 裁决 |
|---|---|
| **R7-1 🔴**（C-1） | R6-3 的补救映射把 `ENOSPC ⟹ 释放磁盘` 写成 stderr **模板字面量**，与 E-p「judge/core/io 不含 `ENOSPC\|EDQUOT\|EROFS` 字面量」**互斥**：正确实现必红 ⟹ 实现者更可能削弱 E-p ⟹ M-8' 失守 ⟹ 白名单可重新藏入（F278「防线照错方向搭」同型）。处置：模板**不写 ENOSPC 明文**，渲染运行时 `err.code`（`主路径 <p>: <stage> <code>`）；静态映射只保留 `EEXIST\|ENOTDIR ⟹ rm 占位物`、`EACCES ⟹ chmod u+w 父目录`；其余 code 统一「请向用户报告该错误码」。§8① 同步 |
| R7-2（W-1） | E-o (b) 必须 **cwd = 临时 fixture 根**（`stop-task-check.sh:8` 用相对 glob `specs/*/tasks.md`），否则 token 目录永不被扫、断言恒绿（与 R6-11 同型）。处置：E-o (b) 写明 `cwd` 与 fixture 布局（`<tmp>/specs/<token-name>/tasks.md`），并断言 stderr **含**该目录名（证明确实被扫到）再断言 exit 0 |
| R7-3（W-2） | 阻断还有 stdout JSON `decision:"block"` + exit 0 一路，E-o (b) 只断 exit code 抓不到。登记边界，不追加防线（本仓 Stop hook 未用该形态） |
| R7-4（W-3） | E-b′ 诱饵若含 `spec-driver-fix` 会推走 `latestFixLineIndex`（窗口自塌 ⟹ M-4 假绿）；含其他 mode 会改 `anchor.mode`（假红）。**唯一可写形态**：诱饵用非 `spec-driver-*` 的真实 skill 展开（如 `/skills/defuddle`），`SKILL_EXPANSION_REGEX` 不命中、两个基线不动。写进 §5 E-b′ 与 §6 M-4；P-2 ④ 的 fixture 亦按此构造（主编排器备料已用 `spec-driver-fix` 展开，**须换成非 spec-driver skill**） |
| R7-5（W-4） | stderr 补救 ② 把 `enforcement: warn` 的文件名+嵌套告诉了**模型**（主消费者）⟹ 被判方读完第 1 次阻断即可自写配置 ⟹ 第 2 次 Stop 在 warn 分支 return 0 ⟹ **1 次往返**。机制既有、已公开文档化（`docs/configuration.md:61`）、在被判方写域、与 `!saved.ok` 无关 ⟹ 同 ⑩ 判例**不在卡 C 修**。处置：§8 补 ⑫ 并移交卡 B；§1/§8⑨ 的「最短完全绕过=2」限定为「**`!saved.ok` 机制面**最短=2」；补救 ② 措辞改为**用户动作**（「由用户决定是否在 … 写入 …」），不写成对模型的操作指令 |

确认成立：带内伪造 envelope 不可能；§1 措辞无新 0 往返路径；compaction 对本计数器 fail-closed；新增 stderr 不污染锚点；P-2 ④ 守护成立。

## 二、误伤面（2C / 3W + 1 漏项）——均为措辞精度

| # | 裁决 |
|---|---|
| **R7-6 🔴**（C-1） | 补救 ② 转写成自然语言时**丢了缩进** ⟹ 模型照写出无缩进两行 ⟹ YAML 解析为 `fix_compliance: null` + 顶层 `enforcement` ⟹ `undefined ⟹ block` 零诊断（正是 R6-2 要关的口）。处置：stderr 渲染两行**字面量**（第二行两空格缩进）；E-a (b) 断言改正则 `/fix_compliance:\s*\n\s{2,}enforcement:\s*(warn\|off)/` |
| **R7-7 🔴**（C-2） | `mkdir EEXIST ⟹ rm 同名占位物` 指向对象未渲染：`tryWriteState` mkdir 的是 `dirname(filePath)`，挡路物是**父目录位置的文件**（`.specify/runs`），而行内渲染的是状态文件路径 ⟹ 模型可能升格为 `rm -rf .specify/runs`（审计与终态同目录 ⟹ 毁证据）。与 R6-3 判死 chmod 臂的理由同构。处置：`errors[].path` 取 **`err.path`**（Node 在 mkdir/write 均填），渲染 `<stage> <code> @ <err.path>`；① 行改「删除上行 `@` 后**那一个**文件；**勿删 `.specify/runs` 目录**」；E-a 断言含 `@ ` 路径段 |
| R7-8（W-1） | §1:22-24 残留「同一段内完全相同的 2 次」是 R6-10 判死的比较句翻版。改「同段内首次触顶前 2 次，其后回合 0，摊销 2/N（详 §8⑨）」 |
| R7-9（W-2） | P-2 ④ 不是「真实条目」而是「真实骨架 + 注入正文」，README 保留清单须标注（否则重录时注入内容会被当噪声删掉）。与 R7-4 合并：④ 的骨架换成**非 `spec-driver-*` 的真实 skill 展开** |
| R7-10（W-3） | harness 形态漂移**无自动可发现性**（P-2 是冻结快照只守我方谓词回归）——改为已接受残余，删「可发现性唯一由 P-2 提供」的归属 over-claim |
| R7-11（漏项） | §11 末行「本卡 2 个新码」与 §4 C2.5 / E-g 矛盾，订正为 **1** |

## 三、GATE_DESIGN 结论
- 机制面（方向 / `latest` 窗口 / 反馈计数上界）连续 **3 轮（5/6/7）零 CRITICAL**；第 7 轮 3 条 CRITICAL 全部是 stderr 文案与 fixture 构造的精度问题。
- 处置：落实 R7-1..R7-11 后跑**第 8 轮字面核对**（单代理、只核对 11 条是否逐字落实，不再开新猎场），零残留即放行进 implement。
- 卡面「至零新 CRITICAL」的口径在本卡按「机制 CRITICAL 为零 + 文案 CRITICAL 已修并经字面核对」收口，理由：文案类 CRITICAL 每轮都会以新的措辞形态再生，Phase 4a spec-review 对 plan/fix-report/实现三方一致性另有独立审查。
