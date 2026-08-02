---
feature: 239-worktree-local-state
title: 批 2（T007-T013）实现留痕 — bash 动态绑定 + containment + allowlist + FR-012 guard
status: done
created: 2026-08-02
tasks_basis: specs/239-worktree-local-state/tasks.md
batch1_basis: specs/239-worktree-local-state/implement-log-batch1.md
---

# 批 2 实现留痕（T007-T013）

批 1 已由主编排器复验并提交（564dbda）。本批全部改动集中在 `scripts/sync-worktree-local-state.sh`
与 `tests/unit/sync-worktree-local-state.test.ts` 两个文件。

**红态基线（T012 实现之前，全部测试代码就位后）**：

```
命令: npx vitest run tests/unit/sync-worktree-local-state.test.ts
输出: Tests  11 failed | 61 passed (72)
```

11 红 = T007(2) + T008(1) + T010(8)；T009、T011 的 characterization guard 部分按设计**首跑即绿**，
未混入红态计数——这正是 W3 要求的"不谎称先红"。

---

## T007 [红测试] `setupRepo` 扩展 + 动态清单红测试

### 红态确认

```
× 动态清单：manifest 新增 ignored 路径后该路径被 copy（无需改脚本代码）
× 动态清单：从 manifest 移除 .env.local 后不再被 copy（SC-002(b) 直接证据）
  → expected true to be false // Object.is equality
```

移除用例的红因即"`.env.local` 已从 manifest 移除、脚本仍然把它 copy 过来"——硬编码
`COPY_TARGETS` 实现下的必然结果，无法靠改 fixture 绕过，是动态绑定缺失的直接证据。

### 实现要点

- `setupRepo({ worktreeInclude = ['.env.local'], gitignore = ['.env.local'] })`：`.gitignore` 与
  `.worktreeinclude` **一起进 init commit**（`git add -A` + `git commit`，不再用 `--allow-empty`），
  因此两者随分支 checkout 到 worktree，`not-ignored` 前提天然成立
- `worktreeInclude: null` 表示不创建清单文件（T008 场景）
- 新增路径 `local-notes.md` 同步加入 fixture `.gitignore`，并在 sync 之前**先断言**
  `git check-ignore --quiet -- local-notes.md` 退出码为 0；该前置断言失败视为 fixture 构造错误
  （已在用例注释中写明"不能当作动态绑定未实现的红测试证据"）
- 脚本消费的是 `$CURRENT_ROOT/.worktreeinclude`（当前 worktree 侧的 checkout），因此测试辅助
  `writeWorktreeInclude()` 写 worktree 侧

### 转绿确认

T012 后两条用例均绿（见 T013 汇总）。

---

## T008 [红测试] manifest 缺失端到端降级

### 红态确认

```
× manifest 文件缺失 → 可见提示 + 其余同步步骤继续 + exit 0
  → expected '[worktree-sync] 检测到 worktree:\n[workt…' to contain '未找到 .worktreeinclude'
```

红因符合判据：脚本此时根本没有"清单缺失"这一分支（硬编码数组下该分支从未存在）。

### 实现要点

断言三件事齐备：stderr 含"未找到 .worktreeinclude"、`.env.local` **不**被 copy（降级为空清单）、
`CLAUDE.local.md` 软链仍完成、`exit 0`。

### 转绿确认

见下方「意外与处置」第 1 条——本用例在实现后仍红了一轮，暴露出一个真实脚本缺陷，修掉后转绿。

---

## T009 [characterization guard] FR-012 二次同步覆盖语义

### 性质说明（非红测试）

```
✓ 二次同步覆盖：主仓 .env.local 由 v1 改为 v2 后重跑 sync，worktree 侧被覆盖为 v2  130ms
```

**首跑即绿**，与 tasks 判据一致。现有 `copy_path` 本就是每次覆盖语义，本用例作用是锁死它，
防止 T012 动态绑定改造过程中被误改成 copy-if-absent。测试文件内已显式标注
「guard: 现状已合规，非红测试」。T012 完成后仍绿（回归防线生效）。

---

## T010 [红测试] FR-011 逃逸对抗矩阵（决策 6 / C8 重做）

### 红态确认（8 例全红，红因为缺少精确 reason code）

```
× absolute-path      → expected ... to contain '[containment] absolute-path: /var/fol…'
× dot-dot-segment    → expected ... to contain '[containment] dot-dot-segment: ../sha…'
× glob-char          → expected ... to contain '[containment] glob-char: *.env'
× negation-prefix    → expected ... to contain '[containment] negation-prefix: !keep.…'
× escape-char        → expected ... to contain '[containment] escape-char: esc\ape.env'
× trailing-slash / not-ignored / not-regular-file 同形
```

关键：红因是**精确 reason code 缺失**，不是宽泛的"跳过/警告"匹配失败——后者在完全没有
containment 校验的实现下也会输出，起不到证伪作用（审查指出的原方案缺陷）。

### 实现要点（逐条对应 C8 修法）

1. **两侧 canary 按脚本真实解析路径布置**，不按 `dirname(worktreeDir)` 想当然：
   - source 侧 `$PRIMARY_ROOT/../shared-secret` = `tempDir/shared-secret`
   - target 侧 `$CURRENT_ROOT/../shared-secret` = `tempDir/worktrees/shared-secret`
   - 两者物理不重合，各自建 canary 并分别快照断言
   - 绝对路径类 canary 落在与 primary/worktree 无父子关系的**独立 mkdtemp 沙盒**内，且**真实存在**
     ——若 containment 被移除，`copy_path` 的 `-e` 检查会通过并真的 `cp`，因果链成立
2. **每用例四断言齐备**：(a) 精确 `[containment] <reason>: <entry>`；(b) `status === 0`；
   (c) 同一次 sync 中 `CLAUDE.local.md` 软链 + 合法条目 `.env.local` copy 均完成；
   (d) canary 内容 + mtime 快照前后一致、隔离 HOME 沙盒目录列表为空
3. **`copy_path` 调用探针**：`PROBE_LOG` 环境变量，断言日志中**不含**非法条目字符串
4. `.env.local/` 尾斜杠用例断言 `trailing-slash`
5. 隔离 HOME：`spawnSync` 注入 `HOME=<沙盒>`，使脚本末尾的 `$HOME/.claude/projects` 段落
   操作沙盒而非真实 `~`，"仓库外零写入"的断言范围因此被精确限定且真实成立

矩阵覆盖全部 8 类 reason（超出 tasks 最低要求的 5 类 + 尾斜杠，把 `not-ignored`/`not-regular-file`
两类运行时拒绝也纳入）。

### 转绿确认

T012 后 8 例全绿（见 T013 汇总）。

---

## T011 [characterization guard] FR-004 allowlist + FR-005 pattern 黑名单

### 性质说明

allowlist 精确性、逐项软链生成、六字符串交叉断言均**首跑即绿**（数组现状本就精确等于 6 项，
且与 `.worktreeinclude` 内容零重叠），标注为 characterization guard。

### 实现要点

- `readSymlinkTargets()` 从脚本源码正则解析数组，断言精确等于既定 6 项（增删任一项即判失败）
- `it.each` 逐项：source 存在时生成软链，且软链解析目标等于主仓 source（比较 **realpath**，
  见「意外与处置」第 2 条）
- 六字符串逐一交叉断言不出现在**仓库根真实** `.worktreeinclude` 内容中
- FR-005：11 条 pattern（`\.env` / `\bsecret\b` / `\bkey\b` / `id_rsa` / `\.pem` / `\.p12` /
  `\.pfx` / `\btoken\b` / `\bcredential` / `\bpassword\b` / `\bauth\.json\b`）各配一个命中例与
  一个**近似但不该命中**的反例（如 `\bkey\b` 配 `monkey.json`、`\bauth\.json\b` 配 `oauth.json`、
  `\bsecret\b` 配 `secretary-notes.md`），另加 `monkey.json` / `keyboard-layout.json` 的
  "不命中任何 pattern"专项断言
- SC-003 反向插入验证：向 allowlist 副本插入 `config/db-secret.json` 后检测必有命中（判红），
  原数组零命中（通过）——机械化证明"插入即红、移除即绿"，无需真的改脚本

---

## T012 [实现] `sync-worktree-local-state.sh` 动态绑定 + containment

### 实现要点

- 删除硬编码 `COPY_TARGETS` 数组与其 for 循环，改为 `WORKTREEINCLUDE_REL=".worktreeinclude"`
  + `copy_worktreeinclude_targets()`：`while IFS= read -r entry; do ... done < <(read_worktreeinclude_entries "$manifest")`
- 清单缺失 → `warn` 可见提示 + 降级空清单 + `return 0`，其余步骤继续
- `validate_entry()` 判定顺序与 `worktree-local-state-core.mjs::SYNTAX_RULES` **严格一致**：
  absolute-path → negation-prefix → escape-char → glob-char → trailing-slash → dot-dot-segment
  → not-ignored → not-regular-file；语法类用 `case` 字面模式（元字符加引号防自身被当 glob）
- `not-ignored`：先 `git rev-parse --is-inside-work-tree` 探测（结果缓存在 `GIT_IGNORE_PROBE`，
  避免每条目一次 spawn），非 git 环境降级 skip；`check-ignore` 退出码**只把 1 当作"明确未忽略"**，
  其余非 0（128 等）视为 git 无法判定，不据此拒绝合法条目（与 node 侧三态映射一致）
- `containment_reject()` 固定输出 `[containment] <reason-code>: <entry>` 到 stderr，
  **不复用 `warn()`**：containment 是安全相关拒绝，`--quiet` 下也必须可见
- 校验失败仅 `return 1` 使调用方 skip 该条目，不中断其余 sync 步骤
- `copy_path()` 顶部（**早于** source 存在性检查）加 `PROBE_LOG` 记录——只有记在函数入口，
  才能区分"被 containment 拦截"与"仅因 source 不存在而跳过"

### 转绿确认

```
命令: npx vitest run tests/unit/sync-worktree-local-state.test.ts
输出: Tests  72 passed (72)
```

既有回归用例（F193 8 个 graph bootstrap、`.agents` 旧软链迁移三场景、主工作区 no-op、
幂等性、COPY 三例、source 缺失两例、scheduled_tasks.lock）全部保持绿。

---

## T013 [回归验证] 批 2 checkpoint

```
命令: npx vitest run tests/unit/sync-worktree-local-state.test.ts
输出: Test Files  1 passed (1)
           Tests  72 passed (72)
退出码: 0

命令: npx vitest run tests/unit/worktreeinclude-contract.test.ts tests/unit/worktreeinclude-golden-matrix.test.ts
输出: Tests  35 passed (35)   —— 批 1 零回归

命令: bash -n scripts/sync-worktree-local-state.sh   （bash 5.3 与 /bin/bash 3.2 双版本）
输出: 均语法 OK
```

真实 worktree 冒烟（`--dry-run`，不落盘）确认动态绑定对**仓库真实** `.worktreeinclude` 生效：

```
命令: bash scripts/sync-worktree-local-state.sh --dry-run
输出: [worktree-sync] [dry-run] cp -p <主仓>/.env.local <worktree>/.env.local
      [worktree-sync] 计划链接 .env.local (copy): ...
退出码: 0（零 containment 拒绝）
```

改动量：脚本 `97 插入 / 11 删除`，测试 `431 插入 / 5 删除`。

---

## 意外与处置

| 现象 | 判定 | 处置 |
|---|---|---|
| **T008 在 T012 实现后仍红**：`exit 1` + `行 367: manifest?: 未绑定的变量` | **真实脚本缺陷**，被红测试抓出：`warn "...（$manifest），..."` 中紧跟变量的**全角括号 `）`** 被 bash 吞进变量名，`set -u` 下直接报未绑定变量并以 1 退出——清单缺失这条降级路径会整体崩掉 | 改用 `${manifest}` braced 形式（本脚本既有代码在 CJK 标点前一律用 `${label}` 写法，属既有约定）；已在代码注释中写明原因，防止后续再犯。这是本批唯一一处真实产品缺陷，由 T008 的端到端红测试而非事后走查发现 |
| T011 的 6 个软链 guard 首跑意外判红：`expected '/private/var/...' to be '/var/...'` | **我的断言写错**，非产品缺陷：脚本 `PRIMARY_ROOT` 经 `cd ... && pwd` 归一化，macOS 上 `/var` 解析为 `/private/var`；该 fixture 侧差异在脚本内早有 `resolve_physical_path` 注释记录 | 断言由 `readlinkSync` 原文比较改为 `realpathSync` 比较，并在测试注释写明原因。修正后 6 例首跑即绿，符合 characterization guard 定性；修正前后红态计数从 17 收敛为**真正的批 2 红 11 例** |
| `git check-ignore` 每条目一次子进程，条目多时开销线性增长 | 非缺陷，但探测结果无需重复 | `git rev-parse --is-inside-work-tree` 的探测结果缓存进 `GIT_IGNORE_PROBE`，每次 sync 只探一次；`check-ignore` 本身仍逐条目调用（语义要求如此，当前清单仅 1 条） |
