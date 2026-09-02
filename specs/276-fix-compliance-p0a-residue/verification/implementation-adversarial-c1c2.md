# C1+C2 实现期异构对抗审查 · 处置记录

> 实现者（spec-driver:implement）在 C1 阶段自派过一轮两路对抗（结论见 `../implementation-notes.md` §3/§4）；
> 主编排器在 C1+C2 完成后**另派两路**对 diff 做代码级审查（本文件）。Codex 审查暂停，异构档位缺席。

## 一、绕过面（0C / 2W / 1L / 1I）

| # | 级别 | 裁决 |
|---|---|---|
| IW-1 | WARNING | `routeBlock` 第 5 参无默认值 + `main` 顶层 `catch { return 0 }` ⟹ 未来调用点漏传 = **TypeError 被兜成 exit 0**（静默完全绕过），JSDoc「无默认值＝忘传即炸」方向写反。**修**：默认 `{}`，`storageUnavailableFeedbackCount` 非数字 ⟹ 按 0 处理（fail-closed：阻断而非放行），注释改写 |
| IW-2 | WARNING | `ENOTDIR`（`.specify/runs` 本身被占成文件）下 `err.path` 是不存在的子路径，补救 ①「删除 @ 后那一个文件、勿删 .specify/runs」**自相矛盾**——唯一正确动作恰被禁止。**修**：`describeWriteFailure` 增加 `blocker` 字段：沿 `err.path` 祖先向上找**第一个存在且不是目录**的节点；stderr 渲染 `@ <err.path>（挡路对象: <blocker>）`，① 改「删除挡路对象那一个文件」；`blocker` 不存在时保持原措辞。零判定消费 |
| IL-1 | LOW | `renderPathSegment` 只折 C0+DEL；NEL/C1/LS/PS/零宽/双向控制/BOM 未消毒、无长度上限（当前不可达）。**修**：消毒集扩至 C0(0x00-0x1F)、DEL+C1(0x7F-0x9F)、U+2028/U+2029、U+200B..U+200F、U+202A..U+202E、U+FEFF，并 `slice(0, 512)`；E-q 补两例 |
| II-1 | INFO | 包 `appendAuditEvent` 的 try/catch 为死代码（io 内部已吞）。**不改**（与全文件既有写法一致），登记 |

确证：四条件与 `latest` 基线逐字落地、基线守卫非 `-1`；放行条件唯一；无隐藏 exit 0（含诱发抛错逐点排除）；token 零渗漏；`err.path` 三来源不可注入锚点；审计三码齐备；机制面最短绕过仍 2 次往返。

## 二、误伤面（0C / 1 MAJOR / 1 MINOR / 2 INFO）——全部基于 /tmp 副本实跑

| # | 级别 | 裁决 |
|---|---|---|
| IM-1 | MAJOR（与 IW-2 同源） | `ENOTDIR` 下 `err.path` 是**被创建的目标**（不存在），不是挡路物；`.specify/runs` 本身是文件时唯一正确动作被同一行「勿删 .specify/runs 目录」禁止。**修**：同 IW-2（祖先探测 `blocker` + ENOTDIR 独立文案 + E-a 补断言「ENOTDIR 时渲染的挡路对象存在且非目录」） |
| IM-2 | MINOR | P-2 fixture ③（assistant）只断 `role`，token 藏在 `tool_use.input` 无 raw 断言 ⟹ 重录抹掉会静默退化。**修**：补一条 raw `includes(token)` 断言 |
| IM-3 | INFO | schema 新 enum 行缩进 8 空格（同级 10）。**修**（纯格式） |
| IM-4 | INFO | ② 「写入下面两行」对已存在配置有覆写歧义。**修**：改「追加/合并到该文件」 |

确证（实跑）：D7 存储可用面 HEAD vs 工作树 4 轮 Stop **stderr sha256 逐条相同**、审计/终态/状态文件全等；既有两条用例改写未丢意图；变异日志 M-1/M-4/M-11 副本重放逐条同名变红、M-11 只红 E-m（唯一守护点坐实）；fixture 4 条与 README 一致、P-3 扫描面覆盖 `[<cmd>]: ` 段；E-o (b) 真跑且 token 目录真被扫到；计数趟 17.9MB 实测 **0.066ms**（构造最坏 1.52ms）；T001–T032 无遗漏；`test:plugins` 副本实跑 1721/1719/0/2。

## 三、结论
两路**零 CRITICAL**。修补清单：IW-1、IW-2/IM-1、IL-1、IM-2、IM-3、IM-4（全部为可执行性/守护力/格式，不动机制）。修补后提交 C1+C2。
