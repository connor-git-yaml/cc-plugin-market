# T063（= F239 T039）第二轮验证报告 — 仅第 2 项（override 同层取代）

- 观测时间：2026-09-01 ~11:46 CST；执行方：Codex 桌面 App 新建 managed worktree `696d` 内的 Codex 会话（只读）；本文由用户转交、主线程转录入库
- 前置：主仓探针 `AGENTS.override.md`（AGENTS.md 副本 + 第 313 行 `<!-- T063-OVERRIDE-MARKER-20260831 -->`，24356B，gitignored）由主线程于第一轮后预置
- 环境：codex-cli 0.151.0；worktree `/Users/connorlu/.codex/worktrees/696d/cc-plugin-market`；HEAD `e01611b2`
- **桌面客户端版本号：【待用户补填】**

## 原始输出（用户转交，逐字）

```text
$ ls -la /Users/connorlu/.codex/worktrees/696d/cc-plugin-market/AGENTS.override.md
-rw-r--r--@ 1 connorlu  staff  24356 Sep  1 11:46 /Users/connorlu/.codex/worktrees/696d/cc-plugin-market/AGENTS.override.md
[exit 0]

$ rg -n --fixed-strings 'T063-OVERRIDE-MARKER-20260831' /Users/connorlu/.codex/worktrees/696d/cc-plugin-market/AGENTS.override.md
313:<!-- T063-OVERRIDE-MARKER-20260831 -->
[exit 0]
```

turn setup 项目指令块标题逐字：`# AGENTS.md instructions for /Users/connorlu/.codex/worktrees/696d/cc-plugin-market`
同一指令块内容末尾逐字包含：`<!-- T063-OVERRIDE-MARKER-20260831 -->`
（会话自述：判断依据为 turn setup 注入的指令块本体；用户消息里提到的标记未计入。）

## 两层结论

| 层 | 结论 | 依据 |
|---|---|---|
| 创建时复制 | **PASS** | override 在新建 worktree 根存在、字节数与主仓探针一致（24356B）、marker 命中第 313 行 |
| 同层取代生效 | **PASS** | turn setup 指令块内容包含 override 独有的 marker ⇒ 实际加载的是 override 内容 |

**观察备注（非分歧）**：指令块**标题**写作 `AGENTS.md instructions ...` 而实际内容来自 `AGENTS.override.md`——标题是装饰性标签不反映来源文件。对 F239 spec 的「同层取代」语义无影响，如实记录以免未来把标题当加载证据（第一轮 2b 正是靠"标题 + 内容 + marker"三证并用才判得准）。

## 与第一轮合并后的 T039 总判定

- (a) `.worktreeinclude` copy-if-absent：PASS（第一轮）
- (b) `AGENTS.override.md` 创建时复制 + 同层取代：**PASS（本轮）**
- 完成判据剩余缺口：**桌面客户端版本号待用户补填**——补齐即勾 T039
