---
feature: 239-worktree-local-state
title: Worktree 与 Local 状态 — 任务分解
status: draft
created: 2026-08-02
plan_basis: specs/239-worktree-local-state/plan.md
spec_basis: specs/239-worktree-local-state/spec.md
review_round: 1
review_basis: reviews/codex-tasks-review-round1.md
---

# Feature 239 任务分解（Round 1 修订版，含终审精修）

> 本版本响应 `reviews/codex-tasks-review-round1.md` 的 6 CRITICAL / 7 WARNING（主编排器逐条判定全部为真）与 2 项被采纳的 INFO。33 → 40 个任务，任务重编号。本 feature 是基础设施型改造（无优先级化的多 User Story，spec 用"场景 A/B/C"描述而非 P1/P2/P3 User Story），因此任务按 **plan.md 的 5 批实现顺序**组织。每个任务标注 **批次** 与 **类型**（红测试 / characterization guard / 实现 / 实现-重构 / 实现-skeleton / 回归验证 / 手工验证）。
>
> **术语修正（INFO 采纳）**：全文原"九类 reason"改称 **「8 类拒绝 reason + 1 类合法通过」**（`absolute-path`/`dot-dot-segment`/`glob-char`/`negation-prefix`/`escape-char`/`trailing-slash`/`not-ignored`/`not-regular-file` 共 8 类拒绝 + 1 类合法条目通过），避免实现者寻找不存在的第九个 reason。
>
> **终审精修（T021/T022 原语边界钉死）**：主编排器终审发现 Round 1 版本的 T021/T022 仍存在残留假红陷阱——`copy_if_absent_atomic` 在 `mv` **之前本就有**二次预检查（`sync-worktree-local-state.sh:299-306`：`if [[ -e "$target_path" ]]` → 保留对方版本 + 清理 tmp + return）。若把「检查 + mv」整体提取进 `publish_exclusive`，T022 预置 `target_path` 后调用原语会命中该既有预检查分支，两条断言在旧 `mv` 语义下同样全过，T022 退化为假红（与被否决的原方案同病）。已按下方 T021/T022 措辞修订：**`publish_exclusive` 的提取边界收窄为只含最终发布指令本身**（当前语义 = 无条件 `mv`；T023 改造后 = `ln` 排他 + `EEXIST` 分支），`-e` 二次预检查保留在调用方 `copy_if_absent_atomic` 内（作为竞态收窄优化与既有日志点，不进原语）。

## Format: `- [ ] TXXX [批N][类型] 描述`

- **[批N]**：所属实现批次（批1~批5，对应 plan.md「实现分批」章节）
- **[类型]**：红测试 / characterization guard / 实现 / 实现-重构 / 实现-skeleton / 回归验证 / 手工验证
- 每个任务下附「文件」「完成判据」「依赖」三行

---

## 批 1：内容合同 + grammar 基础设施

**目标**：`.worktreeinclude` 内容合同（FR-001/FR-008）与 node/bash 双解析器 grammar 一致性（plan 决策4）独立成立。
**可独立验证**：`worktreeinclude-contract.test.ts` 与 `worktreeinclude-golden-matrix.test.ts` 单独跑绿，不依赖批 2~5 任何改动。
**Codex 复审结论**：有条件可绿；需先钉死 T002/T005 探针入口（本版本已通过 W5 修订解决，见 T005）。

- [ ] T001 [批1][红测试] 新增 `tests/unit/worktreeinclude-contract.test.ts`，覆盖 FR-001 8 类拒绝 reason（`absolute-path`/`dot-dot-segment`/`glob-char`/`negation-prefix`/`escape-char`/`trailing-slash`/`not-ignored`/`not-regular-file`）+ 1 类合法条目通过，与 FR-008 byte-budget（`AGENTS.md` 现状通过、人为构造超限 fixture 判红、`AGENTS.override.md` 存在时按 max 取较大值）
  - 文件：`tests/unit/worktreeinclude-contract.test.ts`
  - 完成判据：`npx vitest run tests/unit/worktreeinclude-contract.test.ts` 此刻**失败**，失败原因为 `validateWorktreeIncludeContract`/`validateAgentsByteBudget`/`.worktreeinclude` 文件均不存在（`Cannot find module` 或断言目标不存在类报错），而非语法错误
  - 依赖：无

- [ ] T002 [批1][红测试] 新增 `tests/unit/worktreeinclude-golden-matrix.test.ts`（decision4），构造 6 种 golden byte fixture（CRLF 混用 / UTF-8 BOM / 行内 `#` / 无末行换行 / 纯注释文件 / 空文件），同时驱动 (a) `parseWorktreeInclude()`（Node）与 (b) 通过 `WORKTREEINCLUDE_PROBE_FILE` 环境变量驱动的 bash 探针入口（见 T005 钉死的探针机制），断言两侧输出条目序列逐字节一致
  - 文件：`tests/unit/worktreeinclude-golden-matrix.test.ts`
  - 完成判据：此刻**失败**，失败原因为 `parseWorktreeInclude` 未导出 且/或 `sync-worktree-local-state.sh` 尚不支持 `WORKTREEINCLUDE_PROBE_FILE` 探针入口
  - 依赖：无

- [ ] T003 [批1][实现] 新增仓库根 `.worktreeinclude` 文件（tracked），初始内容仅一行 `.env.local`（迁移自现有硬编码 `COPY_TARGETS`）
  - 文件：`.worktreeinclude`
  - 完成判据：`cat .worktreeinclude` 输出恰为 `.env.local`（含或不含尾随换行均可，视 T001 校验规则）
  - 依赖：无

- [ ] T004 [批1][实现] 新增 `scripts/lib/worktree-local-state-core.mjs`，实现 `parseWorktreeInclude(content)`（钉死五条 grammar：单次剥 BOM、逐行剥单个 `\r`、`#` 仅行首触发注释、空行跳过、接受无末行换行）、`validateWorktreeIncludeEntry(entry, {projectRoot, gitAvailable})`（8 类拒绝 + 1 类合法通过，语法类优先于存在性/ignored 类，`trailing-slash` 必须在存在性检查之前拒绝）、`validateWorktreeIncludeContract({projectRoot})`、`validateAgentsByteBudget({projectRoot})`、`validateWorktreeLocalState({projectRoot})`（供批4 repo:check 接入的聚合入口，此处完整实现，聚合前两个校验函数）
  - 文件：`scripts/lib/worktree-local-state-core.mjs`
  - 完成判据：`npx vitest run tests/unit/worktreeinclude-contract.test.ts` 转绿
  - 依赖：T001, T003

- [ ] T005 [批1][实现] 在 `scripts/sync-worktree-local-state.sh` 中新增 `read_worktreeinclude_entries()` 函数（仅解析职责，钉死与 T004 一致的 grammar：`while IFS= read -r line || [[ -n "$line" ]]; do ... done < "$1"`），**并钉死 bash 探针入口机制（W5 修订）**：脚本参数解析头部新增对 `WORKTREEINCLUDE_PROBE_FILE` 环境变量的显式检查——若该变量非空，脚本**仅**调用 `read_worktreeinclude_entries "$WORKTREEINCLUDE_PROBE_FILE"`，将解析出的条目逐行打印到 stdout 后立即 `exit 0`，**不进入**后续 `git rev-parse`/`bootstrap_graph` 等主流程（避免测试探针误触发真实 git 副作用或依赖可安全 `source` 该脚本）；此阶段**只新增解析函数 + 探针分支**，尚不接入下游 `copy_path` 动态绑定（动态绑定与 `validate_entry()` 属于批2 范围，见 T012）
  - 文件：`scripts/sync-worktree-local-state.sh`
  - 完成判据：`npx vitest run tests/unit/worktreeinclude-golden-matrix.test.ts` 转绿（6 种 golden fixture 下 node/bash 两侧条目序列逐字节一致，bash 侧经 `WORKTREEINCLUDE_PROBE_FILE=<fixture-path> bash scripts/sync-worktree-local-state.sh` 驱动且不产生任何 git/文件系统副作用）
  - 依赖：T002, T004

- [ ] T006 [批1][回归验证] 批1 checkpoint：确认新增两个测试文件独立全绿，且不破坏现有 `tests/unit/sync-worktree-local-state.test.ts`（此时该文件尚未改动，仅验证 T005 新增探针分支不影响既有脚本主流程行为——即不带 `WORKTREEINCLUDE_PROBE_FILE` 时行为与改动前逐字节一致）
  - 文件：无新增（验证性任务）
  - 完成判据：`npx vitest run tests/unit/worktreeinclude-contract.test.ts tests/unit/worktreeinclude-golden-matrix.test.ts tests/unit/sync-worktree-local-state.test.ts` 全部通过，0 失败
  - 依赖：T004, T005

---

## 批 2：bash 动态绑定 + containment + allowlist + FR-012 覆盖语义 guard

**目标**：`sync-worktree-local-state.sh` 从硬编码 `COPY_TARGETS` 切换为动态读取 `.worktreeinclude`，接入 8 类拒绝 reason（FR-003/FR-011），并补齐 fixture 的 ignored 前提与 FR-012/FR-002/FR-004 遗漏分支。
**可独立验证**：`tests/unit/sync-worktree-local-state.test.ts` 全绿（含新增/重做用例），不依赖批3的 graph provenance 改造。
**Codex 复审结论（本版本已修复）**：原判定"不可绿"——ignored fixture 缺失、FR-002/004/012 证据不完整；本版本 T007（C3）、T008（C5）、T009（C1）、T011（C5）已分别补齐。

- [ ] T007 [批2][红测试]（C3 修复）在 `tests/unit/sync-worktree-local-state.test.ts` 中扩展 `setupRepo({ worktreeInclude = ['.env.local'], gitignore = ['.env.local'] } = {})` 签名——**init commit 必须同时创建 `.gitignore`**（默认含 `.env.local`），否则后续 `not-ignored` 拒绝会让默认 manifest 条目被误判为不合规；新增动态清单红测试（C9-1）：manifest 新增一个 ignored 路径应被 copy（**该新增路径必须同步加入 fixture `.gitignore` 并先断言 `git check-ignore <path>` 成功**，再执行 sync 断言 copy 生效）；移除 `.env.local` 后不再被 copy（同时是 SC-002(b) 直接证据）
  - 文件：`tests/unit/sync-worktree-local-state.test.ts`
  - 完成判据：`npx vitest run tests/unit/sync-worktree-local-state.test.ts -t "动态清单"` 此刻**失败**，失败原因为脚本仍读取硬编码 `COPY_TARGETS`（新增路径未被 copy / 移除 `.env.local` 后仍被 copy）；且用例内部对新增 manifest 路径的 `git check-ignore` 前置断言必须先行通过（若前置断言本身失败，视为 fixture 构造错误，需先修 fixture 而非当作红测试证据）
  - 依赖：T006

- [ ] T008 [批2][红测试]（C5 修复，FR-002 分支补全）新增 manifest 文件缺失端到端用例：`setupRepo({ worktreeInclude: null })`（即不创建 `.worktreeinclude` 文件），断言 sync 执行后输出可见提示（如 `[worktree-sync]` 前缀日志含"未找到 .worktreeinclude"或等价文案）、其余同步步骤正常继续（`SYMLINK_TARGETS` 软链完成）、脚本 `exit 0`
  - 文件：`tests/unit/sync-worktree-local-state.test.ts`
  - 完成判据：此刻**失败**——脚本当前尚无 `.worktreeinclude` 缺失时的显式降级路径与提示文案（因为动态绑定尚未实现，硬编码 `COPY_TARGETS` 场景下该分支从未被触发过）
  - 依赖：T007

- [ ] T009 [批2][characterization guard]（C1 修复，FR-012 二次同步覆盖 guard）新增 characterization guard：同一 fixture 连续执行两次 sync，第一次 sync 后 worktree `.env.local` 已存在，随后把**主仓** `.env.local` 内容从 `v1` 改为 `v2`，再执行第二次 sync，断言 worktree 侧 `.env.local` 内容被覆盖为 `v2`（而非保留 `v1`）——本用例**首跑即绿**（现有 `copy_path` 本就是每次覆盖语义），其作用是**锁死该语义**，防止 T012 在动态绑定改造过程中被误改成 copy-if-absent
  - 文件：`tests/unit/sync-worktree-local-state.test.ts`
  - 完成判据：`npx vitest run tests/unit/sync-worktree-local-state.test.ts -t "二次同步覆盖"` **首次运行即通过**（在改动前的现有 `copy_path` 实现下即可通过，测试文件注释需显式标注"guard: 现状已合规，非红测试"）；T012 完成后必须仍然通过（回归防线）
  - 依赖：T006

- [ ] T010 [批2][红测试]（C4 重做）决策6重做后的 FR-011 逃逸矩阵，逐条修复审查指出的非因果与证据不全问题：
  1. **两侧 canary 精确布置**（不按 `dirname(worktreeDir)` 想当然）：`..` 穿越类条目 `../shared-secret` 对应的 source 路径按脚本真实解析为 `$PRIMARY_ROOT/../shared-secret`，target 路径为 `$CURRENT_ROOT/../shared-secret`——**两侧都要**分别在这两个精确路径创建 canary 文件（若两路径物理重合可只建一份，但断言需覆盖两个路径变量各自解析结果都未被触碰）；绝对路径类条目在一个独立沙盒目录内的绝对路径处真实创建 canary 文件
  2. **每用例四断言齐备**：(a) stderr 出现精确 `[containment] <reason-code>: <entry>` 格式；(b) 脚本 `status === 0`；(c) 同一次 sync 中合法步骤仍完成（如 `CLAUDE.local.md` 正常软链存在）；(d) 隔离 `HOME` 沙盒（`spawnSync` 注入独立 `HOME`）内外均无非预期变化——canary 文件 mtime/内容快照在 sync 前后一致
  3. **`copy_path` 未被调用的可观察探针**：`copy_path()` 函数新增可选 `PROBE_LOG` 环境变量支持（写入 `$PROBE_LOG` 一行 `copy_path called: <source> -> <target>` 每次被调用时），测试通过设置 `PROBE_LOG` 并断言该文件中**不包含**任何与非法条目 source/target 相关的记录，证明 containment 校验确实在 `copy_path` 调用之前拦截
  4. `.env.local/` 尾斜杠用例：断言 `trailing-slash` reason
  - 文件：`tests/unit/sync-worktree-local-state.test.ts`
  - 完成判据：此刻**失败**——`validate_entry()` 函数不存在，`copy_path` 尚无 `PROBE_LOG` 支持；每类非法条目在当前实现下要么被字面尝试 copy（因 source 不存在被现有"跳过"日志误判为已拦截），要么无法产出精确 reason code
  - 依赖：T007

- [ ] T011 [批2][characterization guard]（C5/W7 修复）新增 FR-004 allowlist 精确性用例（断言 `SYMLINK_TARGETS` 精确等于既定 6 项 + 每项 source 存在时确实生成 symlink）+ **六个 `SYMLINK_TARGETS` 字符串逐一不出现在 `.worktreeinclude` 内容中的参数化交叉断言**（C5 补全）+ FR-005 pattern 黑名单**正反例矩阵**（W7 机械化）：对每个 pattern（`\.env`/`\bsecret\b`/`\bkey\b`（含 `id_rsa`/`\.pem`/`\.p12`/`\.pfx`）/`\btoken\b`/`\bcredential`/`\bpassword\b`/`\bauth\.json\b`）至少给出一个命中例与一个不命中例，且**必须包含** `monkey.json`、`keyboard-layout.json` 两个不误伤反例
  - 文件：`tests/unit/sync-worktree-local-state.test.ts`
  - 完成判据：allowlist 精确性子用例与六字符串交叉断言子用例**首次运行即通过**（数组现状本就精确等于 6 项且不与 `.worktreeinclude` 内容重叠，标注为 characterization guard）；FR-005 正反例矩阵中每个 pattern 的命中例插入后判红、移除后恢复通过，`monkey.json`/`keyboard-layout.json` 全程保持不命中（通过）
  - 依赖：T006

- [ ] T012 [批2][实现] 改造 `scripts/sync-worktree-local-state.sh`：(1) 删除硬编码 `COPY_TARGETS` 数组，同步主流程改为调用 `read_worktreeinclude_entries(".worktreeinclude")` 逐条动态处理，文件缺失时降级为空清单并输出可见提示（T008）；(2) 新增 `validate_entry()` 实现 8 类拒绝（统一输出格式 `[containment] <reason-code>: <entry>`）+ 1 类合法通过；`not-ignored` 子检查先探测 `git rev-parse --is-inside-work-tree`，非 git 环境降级为 `skip`（为批4沙箱测试预留）；(3) 校验失败的条目 skip 且不中断其余 sync 步骤；(4) `copy_path()` 新增 `PROBE_LOG` 环境变量支持（T010 探针需求）
  - 文件：`scripts/sync-worktree-local-state.sh`
  - 完成判据：`npx vitest run tests/unit/sync-worktree-local-state.test.ts` 中 T007、T008、T010 新增用例转绿；T009、T011 的 characterization guard 部分保持绿、T011 黑名单正反例矩阵红→绿；同文件中此前已绿的既有用例（F193 8 个 graph bootstrap 用例、`.agents` 旧软链迁移守护三场景、主工作区 no-op、幂等性）**不回归**
  - 依赖：T007, T008, T009, T010, T011

- [ ] T013 [批2][回归验证] 批2 checkpoint：`tests/unit/sync-worktree-local-state.test.ts` 全绿（含批1/批2全部新增用例 + 既有回归用例）
  - 文件：无新增（验证性任务）
  - 完成判据：`npx vitest run tests/unit/sync-worktree-local-state.test.ts` 0 失败
  - 依赖：T012

---

## 批 3：graph provenance 重构 —— 风险最集中的一批

**目标**：新增 `graph-bootstrap-status.mjs` 承载四事实追踪的 `bootstrapSource` 状态机、freshness adapter（复用全局 `spectra graph-quality --json`）、异步进程组构建兜底；移除 F193 sidecar 并做迁移性删除；`copy_if_absent_atomic()` 内部最终发布指令改为硬链接排他发布（经原语重构 + 真红测试证明其必要性）。
**可独立验证**：`graph-bootstrap-status.test.ts` + `sync-worktree-local-state.test.ts` 全绿。
**Codex 复审结论（本版本已修复）**：原判定"不可作为可信 checkpoint"——发布竞态测试假红、SC-007 接线与旧 stale fixture 改造缺失；本版本通过 T021-T023（三步拆分）与 T020/T025/T026（补全）修复。**终审精修**：T021/T022 的原语提取边界进一步收窄（见下方措辞），避免二次假红。

- [ ] T014 [批3][红测试] 新增 `tests/unit/graph-bootstrap-status.test.ts`：schema 字段完整性（`schemaVersion`/`bootstrapSource`/`embeddedSourceCommitAtBootstrap`/`worktreeHeadAtBootstrap`/`generatedAt`/`assessable`）、`--dry-run` 不落盘/不删除遗留 sidecar、原子写、**唯一 temp 并发 writer**（两次先后写入均成功、后写内容生效）—— 此时模块尚不存在，整组用例因 `import` 失败而红
  - 文件：`tests/unit/graph-bootstrap-status.test.ts`
  - 完成判据：`npx vitest run tests/unit/graph-bootstrap-status.test.ts` 此刻**失败**，失败原因为 `scripts/lib/graph-bootstrap-status.mjs` 模块不存在（`Cannot find module`）
  - 依赖：T013

- [ ] T015 [批3][实现-skeleton]（W1 修订）新增 `scripts/lib/graph-bootstrap-status.mjs` **skeleton**：导出全部函数签名（`readEmbeddedSourceCommit`、`resolveWorktreeHead`、`readPreviousStatus`、`determineBootstrapSource`、`buildStatusPayload`、`writeBootstrapStatus`、`checkFreshness`、`attemptLocalGraphBuild`、`main`），函数体均 `throw new Error('NotImplemented: <fnName>')`（`attemptLocalGraphBuild` 返回 rejected Promise）——使 T014 的"模块缺失"红态转为"可 import 但调用即抛错"，为 T016-T018 提供针对具体行为断言失败的特异性红态基础
  - 文件：`scripts/lib/graph-bootstrap-status.mjs`
  - 完成判据：`npx vitest run tests/unit/graph-bootstrap-status.test.ts` 中 T014 的用例此刻仍**失败**，但失败原因从 `Cannot find module` 变为 `NotImplemented: <fnName>`（可观察的错误信息变化即为本任务完成的证据）
  - 依赖：T014

- [ ] T016 [批3][红测试]（W1：针对 skeleton 的特异性红）同文件新增 `checkFreshness` adapter 解析/映射测试（plan 决策5）：fixture 驱动假 `spectra` CLI 输出 `fresh`/`dirty`/`stale`/`unknown-provenance` 四态、exit 1 携带合法 JSON、exit 2 携带合法 JSON、CLI 缺失（`ENOENT`）、stdout 不可解析共 8 种形态，四态原样透传不折叠；另加一条真实 CLI 冒烟（本机已装全局 `spectra` 时跑，未装则 `it.skip` 并标注 skip 原因）
  - 文件：`tests/unit/graph-bootstrap-status.test.ts`
  - 完成判据：此刻**失败**，失败原因为 `checkFreshness` 抛出 `NotImplemented: checkFreshness`（而非模块缺失，特异性红）
  - 依赖：T015

- [ ] T017 [批3][红测试]（W1：针对 skeleton 的特异性红）同文件新增 `attemptLocalGraphBuild` 两个关键 stub（plan 决策5）：忽略 SIGTERM 的 stub（断言总墙钟 `< 50000ms` 且最终被 SIGKILL 收口）、启动后台孙进程的 stub（断言孙进程心跳文件在 deadline+grace 后停止更新，判据用心跳文件而非 `pgrep` 查宿主进程表）
  - 文件：`tests/unit/graph-bootstrap-status.test.ts`
  - 完成判据：此刻**失败**，失败原因为 `attemptLocalGraphBuild` 返回的 Promise reject 为 `NotImplemented: attemptLocalGraphBuild`（特异性红，而非裸 `spawnSync(timeout)` 方案的进程组清理缺陷——该方案已被证伪，不作为对照）
  - 依赖：T015

- [ ] T018 [批3][红测试]（W1：针对 skeleton 的特异性红）同文件新增 `bootstrapSource` 四事实状态机测试：(a) 首次 `primary-copy` 后无变化 rerun 必须继承 `primary-copy`（不得被覆盖为 `local-build`）；(b) 仅补 snapshot 不得改变已记录的 graph 来源；(c) `graph.json` 解析失败时原子落盘 `assessable:false` 而非未捕获异常退出；(d) 无历史记录且图已存在 → `unknown`
  - 文件：`tests/unit/graph-bootstrap-status.test.ts`
  - 完成判据：此刻**失败**，失败原因为 `determineBootstrapSource`/`readPreviousStatus` 抛出 `NotImplemented`（特异性红）
  - 依赖：T015

- [ ] T019 [批3][实现] 逐函数实现 `scripts/lib/graph-bootstrap-status.mjs`（替换 T015 skeleton 的 `NotImplemented` 抛错为真实逻辑）：`readEmbeddedSourceCommit`（三态）、`resolveWorktreeHead`、`readPreviousStatus`、`determineBootstrapSource`（四步判定）、`buildStatusPayload`、`writeBootstrapStatus`（唯一 temp 命名 `${targetPath}.${pid}.${random}.tmp` + 原子 rename + 落盘后迁移性删除遗留 sidecar）、`checkFreshness`（`spawnSync` 参数数组形式，非拼接字符串，防 §M10 事故）、`attemptLocalGraphBuild`（异步 `spawn` + `detached` 独立进程组 + TERM→grace→KILL）、`main`（async CLI 入口，分发 `write-status`/`check-freshness`/`attempt-build` 三个子命令）
  - 文件：`scripts/lib/graph-bootstrap-status.mjs`
  - 完成判据：`npx vitest run tests/unit/graph-bootstrap-status.test.ts` 全部转绿（T014/T016/T017/T018 涉及的全部用例），且此前已绿的批1/批2测试不回归
  - 依赖：T016, T017, T018

- [ ] T020 [批3][红测试]（补全 + C9-2/C9-3）在 `tests/unit/sync-worktree-local-state.test.ts` 中：(a) 新增 poison-sidecar 接线测试（C9-2）——内嵌 `graph.sourceCommit` 记 stale、遗留 sidecar 人为写成 current，rerun 仍必须 warn；反向：内嵌 fresh、sidecar 写成 stale，不得误报 stale；(b) 新增 bootstrap 后显式断言 `specs/_meta/.graph-source-commit` **不存在**（含预先 seed 一个遗留 sidecar，bootstrap 后必须被清理，C9-3）；(c) **将 plan 明确要求的"两个既有 stale 相关用例改造为 seed 含 `graph.sourceCommit` 字段的 JSON"显式并入本任务**——修改现有两个 stale fixture 用例的 graph fixture 内容，使其带真实 `graph.sourceCommit` 字段（不再是旧格式）
  - 文件：`tests/unit/sync-worktree-local-state.test.ts`
  - 完成判据：此刻**失败**——若 `check_graph_source_stale` 仍读 sidecar（或两者都读但优先级不对），两个方向中至少一个给出错误结果；sidecar 清理断言此刻失败（sidecar 仍会被写入且不被清理）；两个既有 stale 用例因 fixture 数据结构未对齐新 schema 而在实现完成前处于**待改造**状态（本任务范围内完成 fixture 数据结构迁移，此步骤本身不引入新回归，仅重塑既有断言的数据 shape）
  - 依赖：T019

- [ ] T021 [批3][实现-重构]（C2-a，**终审精修：原语边界收窄**）从 `copy_if_absent_atomic()`（`sync-worktree-local-state.sh:273-310`）中提取一个可被测试直接调用的发布原语函数 `publish_exclusive(tmp, target_path)`，**该原语的提取边界只含最终发布指令本身**（当前语义 = 无条件 `run mv "$tmp" "$target_path"`，即 `sync-worktree-local-state.sh:306` 一行），**不包含** `:301-306` 的"发布前 `-e` 二次预检查"（该预检查——"若 `target_path` 此时已存在则保留对方版本、清理 tmp、return"——继续留在调用方 `copy_if_absent_atomic` 内部，作为既有竞态收窄优化与既有日志文案的载体，不下沉进原语）；本任务是纯重构，`publish_exclusive` 内部此刻**保持无条件覆盖式 `mv`**，不改变任何可观察行为
  - 文件：`scripts/sync-worktree-local-state.sh`
  - 完成判据：`npx vitest run tests/unit/sync-worktree-local-state.test.ts` 全部既有用例（含批1/批2/T020 新增用例）保持全绿，无任何行为变化（纯重构验证）；**额外验证**：调用方 `copy_if_absent_atomic` 内既有"期间目标已被其他进程生成，保留对方版本（清理 tmp）"日志分支（由调用方的 `-e` 预检查触发，不下沉进 `publish_exclusive`）仍然存在且其既有测试/日志文案不变——即预检查与原语的职责边界清晰可见（调用方负责"是否已存在"的竞态收窄判断，原语只负责"execute 发布动作本身"）
  - 依赖：T020

- [ ] T022 [批3][红测试]（C2-b，真红，**终审精修：跳过调用方预检查，直调原语本体**）新增对 `publish_exclusive` 原语的**直接**调用测试（**不经过** `copy_if_absent_atomic` 的调用方预检查，直接调用 `publish_exclusive(tmp, target_path)` 本身）：预置 `tmp` 与 `target_path` 双双存在（`target_path` 内容已知且非空），直调 `publish_exclusive(tmp, target_path)`，断言 (a) `target_path` 原内容不被覆盖、(b) `tmp` 文件被清理
  - 文件：`tests/unit/sync-worktree-local-state.test.ts`
  - 完成判据：此刻**真实失败**——`publish_exclusive` 当前实现是**无条件** `mv "$tmp" "$target_path"`（T021 只提取了这一行，不含调用方的 `-e` 预检查分支），预置的 `target_path` 会被 `tmp` 内容无条件覆盖，断言 (a) 判红；这一失败**不依赖**调用方 `copy_if_absent_atomic` 的预检查是否存在（测试直调原语，绕开了预检查），因此排除了"命中既有 `-e` 预检查分支从而两条断言在旧语义下同样全过"这一假红路径（此前版本的残留缺陷已被消除）
  - 依赖：T021

- [ ] T023 [批3][实现]（C2-c）将 `publish_exclusive` 内部实现从"无条件 `mv`"改为硬链接排他发布：`ln "$tmp" "$target_path" 2>/dev/null` 成功即视为本进程赢得发布（清理 `tmp`）；失败（`EEXIST` 或其他）即视为对方已发布，保留对方版本并清理 `tmp`；调用方 `copy_if_absent_atomic()` 的既有 `-e` 预检查逻辑**不变**（仍在 `publish_exclusive` 调用之前先做一次"目标是否已存在"的检查与日志），只是最终发布这一步改为调用 `publish_exclusive`
  - 文件：`scripts/sync-worktree-local-state.sh`
  - 完成判据：`npx vitest run tests/unit/sync-worktree-local-state.test.ts` 中 T022 转绿（直调原语场景下 `ln`+`EEXIST` 保留对方版本）；`copy_if_absent_atomic` 既有全部回归用例（F193 8 个，含调用方预检查路径）保持绿
  - 依赖：T022

- [ ] T024 [批3][实现] 改造 `scripts/sync-worktree-local-state.sh` 完成 graph provenance 主流程接线：(1) 删除 `SOURCE_COMMIT_REL` 常量与 `bootstrap_graph()` 内"仅当 copy 才写 sidecar"的写入逻辑；(2) `check_graph_source_stale()` 重命名/委托为 `check_graph_freshness()`，内部包在 `command -v node` 条件分支内调用 `node scripts/lib/graph-bootstrap-status.mjs check-freshness`，按四态映射决定是否 warn（**`stale`/`unknown-provenance` → warn，`fresh`/`dirty` → 静默**）；(3) `bootstrap_graph()` 结尾新增：`command -v node` 可用时按四事实（`graphCopiedThisRun`/`snapshotCopiedThisRun`/`buildAttempted`/`buildSucceeded`）调用 `write-status`，不可用时仅输出「状态文件写入跳过：node 不可用」warning，其余步骤照常完成；(4) 新增 `--attempt-build` flag 解析，带该 flag 且 `node` 可用、图既未 copy 也不存在时调用 `attempt-build` 子命令，成功/失败结果反映进四事实
  - 文件：`scripts/sync-worktree-local-state.sh`
  - 完成判据：`npx vitest run tests/unit/sync-worktree-local-state.test.ts tests/unit/graph-bootstrap-status.test.ts` 中 T020、T025（下）、T026（下）三组新增用例**全部**转绿；同文件既有全部回归用例（F193 8 个、`.agents` 三场景、主工作区 no-op、幂等性、批1/批2新增用例）不回归
  - 依赖：T023

- [ ] T025 [批3][红测试]（补全：完整 shell `--attempt-build` 接线证据）新增完整 shell 端到端测试：在 `PATH` 中放置一个 stub `spectra` 可执行文件（`spectra batch --mode graph-only` 时写出一个含已知 `graph.sourceCommit` 字段的 `graph.json`），运行 `bash scripts/sync-worktree-local-state.sh --attempt-build`，断言：(a) 状态文件 `graph-bootstrap-status.json` 的 `bootstrapSource === "local-build"`；(b) `embeddedSourceCommitAtBootstrap` 等于 stub 写入图内嵌的 `sourceCommit` 值；(c) `worktreeHeadAtBootstrap` 等于 fixture worktree 的真实 HEAD（`git rev-parse HEAD` 结果）
  - 文件：`tests/unit/sync-worktree-local-state.test.ts`
  - 完成判据：测试代码先行编写，在 T024 完成之前跑此刻**失败**（脚本尚无 `--attempt-build` flag 与四事实接线，状态文件或字段值不符合预期）；T024 完成后转绿
  - 依赖：T024

- [ ] T026 [批3][红测试]（补全：bash warning 四态映射测试）新增假 `spectra` CLI fixture 驱动的四态映射测试：分别构造 `fresh`/`dirty`/`stale`/`unknown-provenance` 四种 `checkFreshness` 返回态（通过 stub `spectra graph-quality --json` 的输出控制），逐态运行 `sync-worktree-local-state.sh`（不带 `--attempt-build`），断言 `fresh`/`dirty` 态下**不产生** warning、`stale`/`unknown-provenance` 态下**产生**对应 warning 文案
  - 文件：`tests/unit/sync-worktree-local-state.test.ts`
  - 完成判据：测试代码先行编写，在 T024 完成之前跑此刻**失败**（`check_graph_freshness()` 尚未接入四态映射逻辑）；T024 完成后转绿
  - 依赖：T024

- [ ] T027 [批3][实现] 更新 `docs/spectra-cli-reference.md:171-173`：将 `.graph-source-commit` sidecar 的描述替换为 `specs/_meta/graph-bootstrap-status.json` 新状态文件合同说明（含 freshness 现算、不缓存 stale 布尔值）
  - 文件：`docs/spectra-cli-reference.md`
  - 完成判据：`grep -n "graph-source-commit" docs/spectra-cli-reference.md` 不再输出旧描述文本（或仅保留标注为 superseded 的历史说明），改为出现 `graph-bootstrap-status.json` 描述
  - 依赖：T024

- [ ] T028 [批3][回归验证] 批3 checkpoint：`graph-bootstrap-status.test.ts` + `sync-worktree-local-state.test.ts` 全绿（含 T025/T026 完整 shell 接线证据）
  - 文件：无新增（验证性任务）
  - 完成判据：`npx vitest run tests/unit/graph-bootstrap-status.test.ts tests/unit/sync-worktree-local-state.test.ts` 0 失败
  - 依赖：T024, T025, T026, T027

---

## 批 4：hook 修复 + AGENTS.override.md + repo:check 接入

**目标**：`worktree-lifecycle.sh` 失败可见但不阻断；`AGENTS.override.md` ignored 前提生效；第 14 族 `worktree-local-state` 接入 `repo:check` 且不回归两个既有集成沙箱测试。
**依赖诚实化（W3 修订）**：T030/T031/T032/T033 仅依赖批1，可与批3 并行；T029 的 PATH 剥离 node 子场景需要批3 已落地的 `command -v node` 条件分支（T024）才能验证"其余步骤仍完成"，故 T029 显式依赖 T024；T034 依赖 T031（使红转绿）；批4 **完整** checkpoint（T035）依赖 T024（间接依赖批3），不能声称批4 整体独立于批3。
**可独立验证**：`npm run repo:check` 含新族且 pass，两个既有集成测试仍 pass，`worktree-lifecycle-hook.test.ts` 绿。

- [ ] T029 [批4][红测试]（W2 修正判据）新增 `tests/unit/worktree-lifecycle-hook.test.ts`：(a) 固定 stderr 内容 + 非零退出码的 `sync-worktree-local-state.sh` fixture（FR-009），断言 `worktree-lifecycle.sh` create 分支运行后该 stderr 内容在 hook 输出中可见、hook 自身退出码为 0；(b) 新增 PATH 剥离 `node` 的端到端用例，断言 warning 出现 + `.env.local` copy 与 `SYMLINK_TARGETS` 步骤仍完成 + `exit 0`
  - 文件：`tests/unit/worktree-lifecycle-hook.test.ts`
  - 完成判据：(a) 子场景此刻**失败**，失败原因为 hook 现状 `2>/dev/null || true` 会把 stderr 吞掉，测试断言"stderr 内容可见"失败（**而非** `set -e` 中断——W2 修正：此时 T024 的 node 条件分支已存在于脚本中，真正的红因是 hook 层面尚未捕获/透传 stderr）；(b) 子场景此刻**失败**，失败原因为 hook 尚未捕获 stderr 因此看不到"状态文件写入跳过：node 不可用"这条 warning（脚本内部该 warning 本身已由 T024 产出，但 hook 吞掉了它）
  - 依赖：T024

- [ ] T030 [批4][红测试] 新增断言（可并入 `worktreeinclude-contract.test.ts` 追加断言块，非新文件）：`git check-ignore AGENTS.override.md` 命令成功（退出码 0）；`AGENTS.override.md` 字符串不出现在 `.worktreeinclude` 内容中
  - 文件：`tests/unit/worktreeinclude-contract.test.ts`
  - 完成判据：此刻**失败**——`.gitignore` 尚未收录 `AGENTS.override.md`，`git check-ignore AGENTS.override.md` 退出码非 0
  - 依赖：T006

- [ ] T031 [批4][红测试]（W4 新增：14 族接线证据）新增断言：直接调用 `validateRepository({ projectRoot })`（或 `npm run repo:check -- --json` 解析输出），断言其结果集中**存在**以 `worktree-local-state` 为前缀的 check 项——当前状态下因该族尚未注册而**判红**
  - 文件：`tests/integration/repo-maintenance-sync-check.test.ts`（新增独立断言块于同文件）
  - 完成判据：`npx vitest run tests/integration/repo-maintenance-sync-check.test.ts -t "worktree-local-state"` 此刻**失败**，失败原因为 `validateRepository` 输出的 checks 集合中不存在 `worktree-local-state` 前缀条目
  - 依赖：T006

- [ ] T032 [批4][实现] 改造 `plugins/spec-driver/hooks/worktree-lifecycle.sh` 的 `create` 分支：捕获 `sync-worktree-local-state.sh` 执行的 stderr，非零退出时打印捕获内容到 stderr，hook 自身仍以 `exit 0` 结束
  - 文件：`plugins/spec-driver/hooks/worktree-lifecycle.sh`
  - 完成判据：`npx vitest run tests/unit/worktree-lifecycle-hook.test.ts` 中 T029 的 (a)(b) 两个子场景均转绿
  - 依赖：T029

- [ ] T033 [批4][实现] `.gitignore` 新增一行 `AGENTS.override.md`
  - 文件：`.gitignore`
  - 完成判据：`npx vitest run tests/unit/worktreeinclude-contract.test.ts` 中 T030 新增断言转绿；`git check-ignore AGENTS.override.md` 手动执行退出码 0
  - 依赖：T030

- [ ] T034 [批4][实现]（合并接线）先补齐两个既有集成沙箱测试的复制清单以防第 14 族接入后误判回归：`tests/integration/spec-drift-repo-check-modes.test.ts` 的 `COPY_FILES` 数组新增 `.worktreeinclude`；`tests/integration/repo-maintenance-sync-check.test.ts` 的 `copyFile(projectRoot, ...)` 调用序列新增 `.worktreeinclude`；随后在 `scripts/lib/repo-maintenance-core.mjs::validateRepository()` 中接入第 14 族：`aggregateValidation('worktree-local-state', validateWorktreeLocalState({ projectRoot: resolvedRoot }), warnings, errors, checks)`（复用 T004 已实现的聚合函数）
  - 文件：`tests/integration/spec-drift-repo-check-modes.test.ts`、`tests/integration/repo-maintenance-sync-check.test.ts`、`scripts/lib/repo-maintenance-core.mjs`
  - 完成判据：`npx vitest run tests/integration/spec-drift-repo-check-modes.test.ts tests/integration/repo-maintenance-sync-check.test.ts` 中 T031 新增断言转绿（`worktree-local-state` 前缀 check 确实出现且为 pass）；同时两个既有沙箱测试原有的整体 `pass` 断言**不因新族接入而回归**（验证缓解生效：`.worktreeinclude` 已提前补入复制清单，非 git 环境下 `not-ignored` 子检查降级为 `skip` 不拖累整体族状态）
  - 依赖：T031, T033

- [ ] T035 [批4][回归验证] 批4 checkpoint：`worktree-lifecycle-hook.test.ts` 绿 + `npm run repo:check` pass（含第 14 族）+ 两个既有集成测试仍 pass
  - 文件：无新增（验证性任务）
  - 完成判据：`npx vitest run tests/unit/worktree-lifecycle-hook.test.ts tests/integration/spec-drift-repo-check-modes.test.ts tests/integration/repo-maintenance-sync-check.test.ts && npm run repo:check` 全部 0 失败
  - 依赖：T032, T034

---

## 批 5：全量回归收口 + 手工验证

**目标**：三件套零失败并对照 M8 基线核对净增量；两项 spec 明确要求但不纳入自动化门禁的手工验证单列执行；最终聚合 checkpoint 收口交付。

- [ ] T036 [批5][回归验证]（W6 计数修正）全量单元/集成测试：`npx vitest run`，对照 M8 基线（483 test files / 5773 tests，见 `orchestrator-measurements.md` §M8）核对净增量——**本 feature 预期新增 4 个新测试文件**（`worktreeinclude-contract.test.ts`/`worktreeinclude-golden-matrix.test.ts`/`graph-bootstrap-status.test.ts`/`worktree-lifecycle-hook.test.ts`）**+ 1 个既有文件扩展**（`sync-worktree-local-state.test.ts` 新增用例，非新文件），而非此前误计的"5 个新文件"
  - 文件：无新增（验证性任务）
  - 完成判据：`npx vitest run` 输出 0 失败；记录实际新增测试文件数（应为 4）与既有文件新增用例数，形成 A/B 归因锚点
  - 依赖：T006, T013, T028, T035

- [ ] T037 [批5][回归验证] `npm run build` 类型检查零错误，随后 `npm run repo:check` 零失败（含第 14 族 `worktree-local-state`，既有 13 族均不回归）
  - 文件：无新增（验证性任务）
  - 完成判据：`npm run build` 退出码 0，无 TypeScript 编译错误；`npm run repo:check` 退出码 0，输出中第 14 族状态为 pass
  - 依赖：T036

- [ ] T038 [批5][手工验证]（W7 机械化）**SC-001 双腿实测计时**（不阻塞自动化门禁，spec 明确要求"两腿都必须被演示"）：
  - **参考环境**：本开发机 darwin + 全局 `spectra` CLI ≥ 4.4.0 + 干净 worktree（新创建、未预先手工构建图）
  - **成功腿命令序列**：`time bash scripts/sync-worktree-local-state.sh --attempt-build`（记录墙钟秒数）；随后 `node -e "const s=require('fs').readFileSync('specs/_meta/graph-bootstrap-status.json','utf-8'); const j=JSON.parse(s); if(j.assessable!==true) process.exit(1); console.log(JSON.stringify(j))"` 断言 `assessable===true`；再执行 `node -e "const g=JSON.parse(require('fs').readFileSync('specs/_meta/graph.json','utf-8')); if(!(g.nodes?.length>0)) process.exit(1); console.log(g.nodes.length)"` 断言图节点数 `>0`；`bootstrapSource` 实际值按"主仓是否已有图"分支记录预期（主仓有图 → 预期 `primary-copy`；主仓无图触发本地构建 → 预期 `local-build`）
  - **失败腿命令序列**：临时 `mv "$(command -v spectra)" "$(command -v spectra).bak"`（或等价 PATH 移除），重跑 `time bash scripts/sync-worktree-local-state.sh --attempt-build`，`node -e` 断言状态文件 `bootstrapSource==="none"` 且 `assessable===false`；结束后恢复 `spectra` 可执行文件
  - 文件：无（人工操作记录，建议记入本次交付报告，不修改 tasks.md 之外的任何设计文件）
  - 完成判据：两腿实测墙钟时间均 ≤ 60 秒；成功腿 `assessable===true` 且图节点数 `>0`；失败腿 `bootstrapSource==="none"` 且 `assessable===false`；结论（含具体秒数与 `bootstrapSource` 实际值）记录留痕
  - 依赖：T028

- [ ] T039 [批5][手工验证] **Codex 桌面客户端行为人工验证**（spec Non-Goals 已声明不入自动化门禁）：在真实 Codex 桌面应用中为本仓库创建一个 managed worktree，验证 (a) `.worktreeinclude` 中列出的 copy 类文件（`.env.local`）被 Codex 原生复制（copy-if-absent 语义）；(b) 若本地存在已被 ignore 的 `AGENTS.override.md`，该文件确实取代 `AGENTS.md` 生效
  - 文件：无（人工操作记录）
  - 完成判据：两项行为均被人工观察确认并记录结论（含 Codex 客户端版本号），若观察结果与 spec 边界声明不符需回报主编排器评估影响
  - 依赖：T033

- [ ] T040 [批5][回归验证]（W6 终局闭环）最终交付 checkpoint：聚合自动化三件套结果与两项手工验证结论，形成完整交付证据链
  - 文件：无新增（验证性任务）
  - 完成判据：确认 T037（自动化三件套）、T038（SC-001 双腿实测）、T039（Codex 客户端人工验证）**三者均已完成且结论已记录**；若任一手工验证发现与 spec/plan 声明不符，本任务不得判定完成，需先回报主编排器
  - 依赖：T037, T038, T039

---

## Dependencies & Execution Order

### 批次依赖

- **批1**：无前置依赖，可立即开始
- **批2**：依赖批1完成（`worktree-local-state-core.mjs` 存在 + golden-matrix 验证过的 bash 探针入口）
- **批3**：依赖批2完成（`sync-worktree-local-state.sh` 已完成 containment 校验改造，硬链接发布/四事实状态机在此基础上叠加）
- **批4**：T030/T031/T032（部分）/T033/T034 仅依赖批1，理论上可与批3 并行；但 **T029 显式依赖 T024**（PATH 剥离 node 子场景需要批3 的 `command -v node` 条件分支已存在才能验证"其余步骤仍完成"），**T035（批4完整 checkpoint）因此间接依赖批3**，不能声称批4 整体独立于批3（W3 诚实化）
- **批5**：依赖批1~批4全部完成

### 批内顺序（TDD 纪律）

- 每批内：红测试任务必须先于对应实现任务；实现任务完成判据必须显式包含"此前已绿测试不回归"
- 批3 的红态需具备**目标特异性**（W1）：T015 skeleton 先行落地，T016-T018 的红态判据均为"针对 skeleton 具体函数抛 `NotImplemented`"，而非笼统的"模块不存在"
- 批3 的三步（T021 重构 → T022 真红 → T023 转绿）必须严格按序执行，不得跳过 T022 直接做 T023（否则无法证明重构前的 `mv` 语义确实不具备排他性）；**T021 的原语提取边界必须严格限定为"最终发布指令本身"，不得把调用方的 `-e` 二次预检查一并下沉进原语**（终审精修，否则 T022 会命中预检查分支而退化为假红）

### 并行机会

- 批1 的 T001/T002（不同测试文件）可并行编写
- 批2 的 T007/T008/T009/T010/T011（同文件不同断言块）建议顺序编写以避免合并冲突，但 T009（characterization guard）与 T011（characterization guard）逻辑上互相独立，可并行
- 批3 的 T016/T017/T018（同文件不同断言块，均基于 T015 skeleton）可并行编写
- 批4 的 T030/T031/T033（不同文件/不同断言块）可并行执行；T029 需等 T024 落地
- 批4 与批3 的非 T029/T035 部分可团队并行（分工场景）
- 批5 的 T036/T037 存在先后依赖（先跑测试确认无回归，再 build+repo:check），不建议并行；T038/T039 手工验证任务互相独立，可并行安排不同人执行

---

## Implementation Strategy

### 建议执行顺序（无 MVP 切分场景，采用严格分批推进）

1. 批1 → checkpoint 验证（T006）
2. 批2 → checkpoint 验证（T013）
3. 批3（风险最集中） → checkpoint 验证（T028），逐条走查风险表列出的三项高危风险（`command -v node` 条件分支全覆盖、进程组信号发送、`spawn` 参数数组形式）+ 本轮新增的三步拆分是否严格按序完成，**尤其核对 T021 的原语边界是否严格排除调用方预检查**
4. 批4（部分任务可与批3 并行，但 T029/T035 需等批3 的 T024） → checkpoint 验证（T035）
5. 批5 全量回归 + 两项手工验证 + 终局聚合 checkpoint（T040） → 交付

### 团队并行策略

- 若双人协作：开发者 A 负责批1→批2→批3（主链路，风险集中），开发者 B 在批1完成后立即开始批4 的 T030/T031/T033/T034（不依赖 T024 的部分），两者在 T024 完成后由 A 或 B 补做 T029，最终在批5 汇合
- 手工验证任务（T038/T039）建议在批3/批4 分别完成后即可提前安排，不必等到批5 才启动，只是最终交付报告需等两者都完成后由 T040 聚合

---

## Spec FR/SC 覆盖映射表（Round 1 修订：修正 INFO 指出的 FR-011 错误交叉引用）

| FR/SC | Task ID |
|---|---|
| FR-001 | T001, T003, T004 |
| FR-002 | T002, T005, T007, T008, T012 |
| FR-003 | T010, T012 |
| FR-004 | T011, T012 |
| FR-005 | T011, T012 |
| FR-006 | T014, T016, T017, T018, T019, T020, T024, T025, T026, T027 |
| FR-007 | T030, T033 |
| FR-008 | T001, T004 |
| FR-009 | T029, T032 |
| FR-010 | T017, T024, T025, T038 |
| FR-011 | T010, T012（隔离 HOME + 精确 canary + reason code + 可观察探针） |
| FR-012 | T009（characterization guard，锁死既有覆盖语义） |
| FR-013 | T006, T013, T028, T035, T036 |
| SC-001 | T017, T019, T038 |
| SC-002 | T007, T002 |
| SC-003 | T011 |
| SC-004 | T011 |
| SC-005 | T001, T030, T033 |
| SC-006 | T010（四断言齐备：reason code + status0 + 合法步骤完成 + HOME 沙盒内外零变化） |
| SC-007 | T016, T020, T024, T025, T026 |
| SC-008 | T029, T032 |
| SC-009 | T036, T037 |

---

## Codex Round 1 复审：6 CRITICAL / 7 WARNING / 2 INFO 落点

| 编号 | 问题概述 | 落点 Task ID |
|---|---|---|
| C1 | FR-012 二次同步覆盖测试无承载 | T009（新增 characterization guard） |
| C2 | 发布竞态测试假红，无法守护竞态修复 | T021（重构，边界收窄）+ T022（真红，直调原语）+ T023（转绿） |
| C3 | 批2 fixture 未建立 ignored 前提 | T007（`setupRepo` 扩展含 `.gitignore` 前置） |
| C4 | FR-011 逃逸 fixture 非因果 + SC-006 证据不全 | T010（两侧精确 canary + 四断言齐备 + `PROBE_LOG` 探针） |
| C5 | FR-002/FR-004 分支缺任务 | T008（manifest 缺失端到端）+ T011（六字符串交叉断言） |
| C6 | FR-006/SC-007 shell 接线证据缺 + 旧 stale fixture 改造无承载 | T020（fixture 改造并入）+ T025（`--attempt-build` 完整接线）+ T026（四态 warning 映射）+ T038（SC-001 机械化） |
| W1 | 原批3任务红态无特异性 | T015（新增 skeleton 任务）+ T016/T017/T018（红态判据改为针对 skeleton） |
| W2 | 原 hook 测试任务红因写错时点 | T029（完成判据修正为"stderr 被吞"而非"set -e 中断"） |
| W3 | 批4 不能声称仅依赖批1、可独立 checkpoint | 批4 说明段落显式标注 T029/T035 依赖 T024 |
| W4 | 第14族接线缺失红任务 | T031（新增红测试）+ T034（接线转绿） |
| W5 | bash 探针入口无法从原文确认 | T005（钉死 `WORKTREEINCLUDE_PROBE_FILE` 机制） |
| W6 | 净增量计数错误 + 无终局闭环任务 | T036（计数修正为"4 新文件+1 扩展"）+ T040（新增终局聚合 checkpoint） |
| W7 | 判据机械化不足 | T011（FR-005 正反例矩阵含 monkey.json/keyboard-layout.json）+ T038（SC-001 具体命令序列与记录字段） |
| I1 | FR-011 → 原手工验证任务错误交叉引用 | 映射表已修正为 T010/T012，不再指向手工验证任务 |
| I2 | "九类 reason"应改称"8 类拒绝 + 1 类合法通过" | 全文已重命名（frontmatter 下方说明段落 + 全部任务描述） |

**终审精修记录（T021/T022 二次假红修复）**：主编排器终审指出 `copy_if_absent_atomic` 在 `mv` 之前本就有 `:299-306` 的 `-e` 二次预检查分支——若把"检查 + mv"整体提取进 `publish_exclusive`，T022 预置 `target_path` 会命中该既有分支而非命中"发布指令本身"，导致两条断言在旧 `mv` 语义下同样全过，退化为假红。已修订：T021 的原语提取边界**只含最终发布指令**（`ln`/`mv` 那一行），预检查留在调用方；T022 改为**直调原语、绕开调用方预检查**，此时旧"无条件 `mv`"语义下预置的 `target_path` 必然被覆盖，(a) 断言真实判红；T023 落地 `ln`+`EEXIST` 后转绿。

---

## 我认为仍站不住的点

无——本轮修订已逐条对应 Codex 复审的 6 CRITICAL / 7 WARNING / 2 INFO，以及主编排器终审指出的 T021/T022 残留假红陷阱（其余 1 条 INFO 属于对已有映射关系的描述性总结，不构成可执行的修订点，未单独列 Task）。若主编排器认为 T025/T026 的"测试代码先行编写以确认红态"这一表述与严格 TDD 顺序（先红后绿、同一提交内完成红→绿）存在张力，可要求收紧为"T025/T026 必须先于 T024 提交为独立 commit 并跑出红态证据留痕"；本版本未强制要求分离 commit，因为 T024 本身内部已按"先写状态机接线代码→跑三组测试确认全绿"的顺序执行，符合 plan 测试策略表的整体红绿节奏。
