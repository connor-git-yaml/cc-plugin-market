---
feature: 239-worktree-local-state
title: Codex implement review 修复轮留痕（5 CRITICAL / 7 WARNING）
status: done
created: 2026-08-02
review_basis: specs/239-worktree-local-state/reviews/codex-implement-review-round1.md
batch4_basis: specs/239-worktree-local-state/implement-log-batch4.md
---

# 修复轮留痕（C1-C5 / W1-W7）

每条按「红态证据 → 修复 → 转绿」三段记录。红态一律为**实跑输出**，不是事后追述。

---

## C1. Volta 环境中全局 `spectra` 对 Node 子进程不可见

### 红态证据（含**声称降级**注记）

审查称"freshness 永远降级、`--attempt-build` 永远失败"。**该措辞与主编排器 SC-001 成功腿的实证
矛盾**：完整生产链在本机真实构建成功（4745ms / 6083 节点），若"永远失败"成立则该实测不可能发生。
因此本条的准确表述是：**调用上下文相关**（取决于 Node 是否经 Volta shim 启动、shim 目录是否被
从子进程 PATH 摘除），而非普遍必然。

裸命令名依赖调用方 PATH 这一**风险本身**成立，且绝对路径修法极廉价、根治整类问题（不止 Volta），
故**修法照做、结论降级**。

测试盲区是真的：真实 CLI 冒烟原先把 `unknown-provenance` 也当合法结果，于是"CLI 根本没启动"
仍判绿——这条必须堵。

### 修复

- `sync-worktree-local-state.sh` 顶部解析一次 `SPECTRA_BIN="$(command -v spectra 2>/dev/null || true)"`，
  经 `--spectra-bin` 把**绝对路径**传给 `check-freshness` 与 `attempt-build`（两处都用数组参数拼装）
- helper 的 `spectraBin` 默认值保留裸名 `'spectra'` 作 fallback，保住"没装 CLI"这条真实降级路径
- 冒烟测试改判据：传绝对路径时 `reason` **不得**为 `spectra-cli-missing`

### 转绿

`C1：真实全局 spectra CLI（绝对路径）必须真的被启动，reason 不得为 spectra-cli-missing` — 本机装有
全局 CLI，该用例**实际执行**（非 skip）并通过。

---

## C2. containment 可被中间 symlink 与 `git check-ignore` 128 绕过（最高优先，全盘照修）

### 红态证据

```
命令: npx vitest run tests/unit/worktreeinclude-contract.test.ts
× symlink-component：最终对象本身是 symlink → 拒绝
  → expected 'not-regular-file' to be 'symlink-component'
× symlink-component：中间路径组件是 symlink → 拒绝
  → expected true to be false          ← 旧实现**接受**了穿 symlink 的仓库外路径
× symlink-component：另一侧根（target 侧父目录为 symlink）同样被拒绝
  → expected true to be false          ← 旧实现接受，copy 会写出 worktree
× check-ignore-error：git 返回 128 → 独立 reason 拒绝
  → expected true to be false          ← 128 被当作"未拒绝"放行
Tests  6 failed | 29 passed (35)
```

shell 侧五形态用例同批判红（形态 1/3/4 直接放行，形态 5 未拦）。

### 修复（node / bash 双侧同步）

- (a) `check-ignore` 只有 **exit 0** 算通过；1 → `not-ignored`；**其余（128 等）→ 新 reason `check-ignore-error`**，
  与 not-ignored 分开记，日志可区分
- (b) 新增 `symlink-component`：逐段下降对**每个已存在路径组件**做 lstat（`-L`），任一为 symlink 即拒
- (c) 最终对象自身是 symlink 一并拒（消除"bash 接受 / node 判 not-regular-file"的漂移）
- (d) 全部校验都在任何读写之前完成（`validate_entry` 返回非 0 时 `copy_path` 根本不被调用，
  由 `PROBE_LOG` 探针断言）
- (e) 五形态真实测试：final symlink / intermediate symlink / target-parent symlink / git-128 /
  manifest 穿 symlink；沙盒内自建 `_reference` 型布局，**不碰**仓库真实 `_reference`

**判定顺序钉死**：语法 → check-ignore → symlink 组件 → not-regular-file（两侧逐条对齐）。

### 转绿 + 零误伤

`Tests 35 passed (35)`（contract）/ `98 passed (98)`（shell）。专门补了一条零误伤守护：
现行清单唯一条目 `.env.local` 无 symlink 组件，照常 copy 且 stderr 无任何 `[containment]`。

### ⚠ 修复过程中发现的真实回归（已修，需你知悉）

首版把 **target 侧最终对象**也纳入拒绝，打红了既有用例
`遗留的 .env.local 软链应被替换为 copy (迁移路径)`（F213 起就被守护的行为）。

判定：这是**我的修复引入的回归**，不是既有缺陷。收敛为按侧区分语义：

| 侧 | 范围 | 理由 |
|---|---|---|
| source（`PRIMARY_ROOT`） | 含最终对象 | source 是 symlink 会**读穿**到仓库外 |
| target（`CURRENT_ROOT`） | **仅父目录** | 最终对象是 symlink 时 `copy_path` 已有安全处置：`rm -f` 删的是**链接自身**（绝不写穿），再写出真实文件；父目录 symlink 才会让 copy 落到 worktree 外 |

审查举证的 target 侧场景原文即 "target-parent symlink"，与本收敛一致；形态 3 用例仍红→绿。

---

## C3. `--dry-run --attempt-build` 会真实构建并写图

### 红态证据

红测试：fake `spectra batch` 一旦被调用就写 marker。

```
× --dry-run --attempt-build：只打印拟执行计划，不 spawn 构建，图/状态/sidecar 零变化
  → marker 存在 / graph.json 被写出（dry-run 契约破裂）
```

### 修复

构建分支最外层先判 `DRY_RUN`：dry-run 只 `log "[dry-run] 拟执行本地构建：spectra batch --mode graph-only（本次不执行）"`，
**绝不 spawn**（此前 dry-run 只作用于状态写入，构建分支根本没查 DRY_RUN）。

### 转绿

marker 不存在、`graph.json` 未生成、`graph-bootstrap-status.json` 未落盘、遗留 sidecar 仍在。

---

## C4. 子进程 exit 0 被直接认定构建成功

### 红态证据

审查用 `/usr/bin/true` 复现：`{"outcome":{"ok":true},"graphExists":false,"bootstrapSource":"local-build"}`。
更关键的是**既有测试把这个错误语义锁死了**（`graph-bootstrap-status.test.ts:446` 断言 `exit 0 → ok:true`）。

### 修复（含语义翻转）

`ok:true` 收紧为三条件并立：直接子进程 exit 0 **且** `graph.json` 是常规文件 **且** JSON 可解析且含
非空 `graph.sourceCommit`（最小可查询性）。任一不满足 → `graph-missing-after-build` /
`graph-unparsable` / `graph-not-queryable`。

产物未就绪时按**剩余 deadline 轮询等待**（覆盖 launcher 秒退、后台 worker 仍在写图的真实形态），
到期后无论成败都对整个进程组补一次 KILL 回收残留。`bootstrapSource=local-build` 仅在新三条件成立时设置。

**翻转 :446**：该用例改为 `C4：子进程 exit 0 但没产出图 → ok:false + graph-missing-after-build（不再是假成功）`。

### 转绿

新增 5 条 C4 用例全绿，含审查点名的盲区"父进程快速 exit 0、后台孙进程稍后才写出图 → deadline 内等到即 ok:true"。

---

## C5. freshness 无界阻塞

### 红态证据（**最硬的一条**）

跑全量修复轮测试时套件直接挂死；杀掉 vitest 后，**子进程作为孤儿存活**：

```
79296 bash /var/folders/.../graph-bootstrap-status-AdI1fg/stub-hang graph-quality --json
82510 node .../scripts/lib/graph-bootstrap-status.mjs check-freshness --project-root ...
82511 bash /var/folders/.../sync-worktree-test-hWg7hz/stub-bin/spectra graph-quality --json
```

测试进程都没了、freshness 子进程还在跑——`spawnSync` 无 timeout 的直接后果。

### 修复

抽共享 `runBoundedProcess({command,args,cwd,deadlineMs,graceMs,captureStdout})`：`detached` 独立进程组
+ deadline `kill(-pgid,TERM)` → grace → `kill(-pgid,KILL)`；`checkFreshness` 与 `attemptLocalGraphBuild`
**共用同一实现**（两份各自维护的 deadline 必然漂移——其中一份就曾完全没有）。
freshness 默认 deadline = 5000ms；超时 → `unknown-provenance` + `freshness-timeout` + sync 侧 warning。

### 转绿

- 模块级：`C5：CLI 卡死时按 deadline 收口 → freshness-timeout（秒级返回）` 1110ms 通过
- shell 级：freshness CLI 卡死时 sync 仍秒级返回并给出 warning
- **进程级复验**：修复后重跑同一套件，`ps` 查 stub/helper 残留 = **0**（修复前为 3）

---

## W1. `publish_exclusive` 把所有 `ln` 错误伪装成"对方已发布"

**红态**：`W1：ln 因真实错误失败（target 仍不存在）→ 明确 warn` 判红（旧实现对任何 ln 失败都打
"目标已被其他进程发布"）。

**修复**：`ln` 失败后按 `[[ -e || -L target ]]` 二分——target 存在 = 并发发布（保留对方、清理 tmp、
沿用原文案）；target 不存在 = **真实错误**（warn 具体 stderr + 清理 tmp + 返回非成功）。
另在发布**前**判 `[[ -L target ]]`：symlink 目标视为已有他方产物，不覆盖不跟随（防 BSD `ln` 跟随
symlink-to-dir 在外部目录建链）。

**转绿**：三条原语用例全绿（含"target 是 symlink 时不覆盖不跟随、外部路径未被创建"）。

---

## W2. freshness 接受面过宽 + shell 静默吞未知态

**红态**：`W2：exit 3 / killed-by-signal / unknown-state` 三条判红；shell 侧未知 state 无任何 warning。

**修复**：只接受 `exit ∈ {0,1,2}` **且** `signal === null` **且** `state ∈ 四态枚举`；违者 →
`unknown-provenance` + 具体 reason（`unexpected-exit-code` / `killed-by-signal` / `unknown-state`，
后者回传 `receivedState` 原始值）。shell 的 `case` 补 `fresh|dirty` 显式分支，`*)` 默认分支输出
可见 warning 并回显收到的 state。

**转绿**：模块 3 条 + shell 1 条全绿。

---

## W3. rename 失败残留 temp / broken-symlink sidecar 清不掉

**红态**：`W3：遗留 sidecar 是 broken symlink 时同样被清理` 判红（`existsSync` 对 broken symlink 返回
false——用例里先断言了这一点作为盲区证据）。

**修复**：写状态用 `try/finally`，rename 未成功则清理唯一命名的 tmp（否则残渣因名字唯一永远不会被覆盖）；
sidecar 判存改 `lstat`。

**转绿**：W3 用例 + 既有原子写/无 tmp 残留用例全绿。

---

## W4. dry-run 输出的"拟状态"与真实执行不等价

**红态**：`W4：dry-run 输出操作计划清单，而非"拟合成"的最终状态对象` 判红（旧实现打印整个 payload，
而该 payload 由"尚未发生的 copy"推算，与真实执行结果不等价）。

**修复**：dry-run 改为返回并打印**操作计划清单**（`拟写状态文件` / `拟删除遗留 sidecar`，
shell 侧再加 `拟执行本地构建`），不再声称打印最终状态对象；`writeBootstrapStatus` 新增 `plan` 返回字段供断言。

**转绿**：W4 用例 + 既有 dry-run 不落盘用例全绿。

---

## W5. graph / 历史状态无界读取

**红态**：`W5：graph.json 超出体积上限 → graph-too-large` 与 `历史状态文件超限 → 按无记录处理` 判红。
用**稀疏文件**（`truncateSync` 到 256 MiB+1）构造，statSync 报告超限但不占磁盘、不被读入。

**修复**：两处读取前先 `statSync`，超 `MAX_JSON_BYTES`（256 MiB）→ graph 记 `graph-too-large`
（连带 `assessable:false`）、历史状态按 null 处理，**均不读入内存**。

**转绿**：两条用例全绿。

---

## W6. 并发与 HOME 测试证据不足

**红态**：原"两个 writer"实为串行调用（固定 `${path}.tmp` 实现也能过）；除 containment 套件外
所有 shell/hook 测试继承真实 HOME，而脚本 `:611` 的 memory-symlink 步骤会读写 `~/.claude/projects`。

**修复**：
- (a) 新增**两个真实并发子进程**（`spawn` 两个 node 进程同时 `write-status`）：断言两者都 exit 0、
  终态是其中之一的**完整** JSON、无 tmp 残留。按裁决用进程级并发，不做 barrier 精确交错（避免 flaky）
- (b) `setupRepo` 为每个 fixture 创建隔离 HOME 并由 `stubbedEnv` **默认注入**所有 `runSync*`；
  hook 测试同样默认注入——不再只有 containment 套件密封

**转绿**：并发用例通过；全套 shell/hook 测试不再触碰真实 HOME。

---

## W7. 第 14 族对异常 manifest 不是结构化失败

**红态**：

```
× W7：manifest 是目录 → 结构化 fail（不裸抛 EISDIR）
  → expected [Function] to not throw an error but 'Error: EISDIR: illegal operation on a…' was thrown
× W7：manifest 是 symlink → 结构化 fail
  → expected 'pass' to be 'fail'
```

**修复**：`lstat` 判 manifest 必须是**常规非 symlink 文件**（目录 / symlink / 其他 → 本族结构化 fail
并说明类型）；`readFileSync` 包 try/catch，读取异常同样收敛为本族 fail。理由写进注释：第 14 族在
repo:check 里是聚合调用，裸抛会让整份报告变成一段栈，其余 13 族结论一并丢失。

**转绿**：两条 W7 用例全绿；`npm run repo:check` 仍 pass。

---

## 完成判据核验

```
命令: npx vitest run tests/unit/worktreeinclude-contract.test.ts \
        tests/unit/worktreeinclude-golden-matrix.test.ts \
        tests/unit/graph-bootstrap-status.test.ts \
        tests/unit/sync-worktree-local-state.test.ts \
        tests/unit/worktree-lifecycle-hook.test.ts \
        tests/integration/spec-drift-repo-check-regression.test.ts
输出: Test Files  6 passed (6) / Tests  197 passed (197)   退出码 0

命令: bash -n scripts/sync-worktree-local-state.sh   （bash 5.3.9 与 /bin/bash 3.2.57）
输出: 双版本均 OK

命令: npm run repo:check
输出: [repo-check] status=pass，退出码 0（第 14 族四项全 pass）

进程级复验: ps 查 stub/helper 孤儿残留 = 0（C5 修复前同一套件残留 3 个）
```
