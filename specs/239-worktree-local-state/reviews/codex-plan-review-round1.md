总体结论先说：当前 plan 不应进入 tasks 阶段；核心方向可保留，但须先修完下列 CRITICAL。

## CRITICAL

### C1. Node helper 引入了未声明的运行时前提，并可能被 `set -e` 直接放大为整条 sync 中断

- **问题描述**：plan 把“零 `node_modules` 依赖”误写成“零额外环境前提”。实际每次 bootstrap 都会调用 `node`，包括未传 `--attempt-build` 的默认路径。当前脚本启用了 `set -euo pipefail`；若 `node` 不在 `PATH` 且调用未包在条件分支中，脚本立即以 127 退出，后续 memory/symlink 步骤全部跳过。
- **命中 plan**：决策 2 行 52–55、决策 5 行 90/98、文件改动表行 184：[plan.md:52](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/plan.md:52)、[plan.md:90](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/plan.md:90)、[plan.md:184](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/plan.md:184)。
- **能证伪的具体场景**：spec 声称 bootstrap 唯一环境前提是全局 `spectra` CLI，而未声明 Node helper 前提：[spec.md:93](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:93)。当前脚本的退出语义见 [sync-worktree-local-state.sh:13](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/sync-worktree-local-state.sh:13)。实测：

  ```text
  PATH=/usr/bin:/bin /bin/bash -c 'set -euo pipefail; node missing-helper.mjs; echo after'
  /bin/bash: node: command not found
  exit_status=127
  ```

  虽然当前全局 `spectra` 是 `#!/usr/bin/env node`，正常 Codex 成功腿通常已有 Node，但手工/default sync 原本没有该前提，而且 `spectra` 缺失失败腿也不能靠尚未启动的 Node helper记录状态。
- **建议修法**：明确二选一：要么修订 spec，把 `node` 列为入口硬前提；要么提供无 Node 的状态写入降级。无论如何，所有 helper 调用必须放进显式 `if/else`，确保失败可见但不触发 `set -e` 中断，并补“PATH 有 git/bash、无 node”的端到端测试。不能继续声称默认行为“完全不变”。

### C2. `spawnSync(timeout)` 不是硬超时，也不会清理进程树

- **问题描述**：plan 把 `spawnSync(..., {timeout: 50000})` 当成 50 秒硬上限和自动清理保证；这两个前提都不成立。
- **命中 plan**：决策 5 行 95–96、CLI 设计行 140–143、测试步骤 8：[plan.md:95](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/plan.md:95)、[plan.md:140](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/plan.md:140)、[plan.md:247](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/plan.md:247)。
- **能证伪的具体场景**：Node v24.14.0、darwin 实测：

  ```text
  # 子进程忽略 SIGTERM；timeout=200ms
  {"elapsedMs":2016,"errorCode":"ETIMEDOUT","signal":null,"status":0}
  ```

  即内部 200ms timeout 实际等待了约 2 秒。另一个 stub 启动孙进程，直接子进程在 203ms 被 SIGTERM 后，孙进程仍在 1 秒后向父进程发信号：

  ```text
  {"spawnReturnedMs":203,"errorCode":"ETIMEDOUT",
   "signal":"SIGTERM","grandchildSignaledParent":true}
  ```

  映射到真实方案：若 `spectra` launcher 捕获 SIGTERM，50 秒可以突破 SC-001 的 60 秒；若 launcher 启动 worker，入口返回后 worker 仍可能继续写 graph。SC 的硬预算见 [spec.md:145](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:145)。
- **建议修法**：改用异步 `spawn`，darwin/Linux 下建立独立进程组，deadline 到期先 TERM、短 grace 后对整个进程组 KILL。预留状态写入/清理时间，建议构建 deadline 不高于 45–48 秒。测试必须包含“忽略 TERM”和“启动后台孙进程”两个 stub，并断言总墙钟和孙进程均收口。

### C3. `checkFreshness` 不是 F217 四态的兼容实现，而是有意把 `dirty` 错标成 `ok`

- **问题描述**：spec 要求 freshness 通过 F217 四态模型现算；plan 却只比较 commit，把 `fresh` 和 `dirty` 都映射成 `ok`。等价性测试不是防漂移，而是在合同层永久允许这个差异。
- **命中 plan**：决策 5 行 108–121，尤其矩阵行 114–115：[plan.md:108](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/plan.md:108)、[plan.md:114](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/plan.md:114)。
- **能证伪的具体场景**：图的 `sourceCommit === HEAD`，但存在未提交的 `.ts` 修改。F217 返回 `dirty`，实现证据见 [source-commit.ts:180](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/src/panoramic/graph/source-commit.ts:180)；plan helper 返回 `ok`。`git status` 读取失败时，F217也保守返回 `dirty`，[source-commit.ts:181](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/src/panoramic/graph/source-commit.ts:181)，六格矩阵没有覆盖。该行为违背 [spec.md:85](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:85) 和回归护栏 [spec.md:136](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:136)。
- **建议修法**：生产路径必须复用一个真正的 canonical 实现。可选方案是调用已要求存在的全局 `spectra graph-quality --json`，或把 F217 freshness core 抽成零第三方 `.mjs`，由 TS 和 bootstrap helper 双方调用。输出必须保留 `fresh/dirty/stale/unknown-provenance`；若只想实现 commit stale 子集，应修改 spec，而不是继续称其为四态等价实现。

### C4. `bootstrapSource` 判定会在正常 rerun 和 snapshot-only copy 时写假 provenance

- **问题描述**：plan 将“已有 graph”直接归为 `local-build`，将“graph 或 snapshot 任一被复制”归为 `primary-copy`，都不代表 graph 的真实来源。
- **命中 plan**：数据合同判定顺序行 227–232：[plan.md:227](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/plan.md:227)。
- **能证伪的具体场景**：

  1. 首次从主仓 copy 图，状态为 `primary-copy`；第二次 sync 图已存在、无任何构建，plan 会覆盖成 `local-build`。
  2. worktree 有本地构建图但缺 snapshot；本次只从主仓补 snapshot，plan 行 228 会把图来源写成 `primary-copy`。
  3. graph JSON 解析失败时，CLI 的 `--assessable true` 与 live 解析结果如何协调未定义；helper 很可能直接异常退出，而不是落盘 `assessable:false`。

  这与字段语义 [spec.md:80](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:80)、异常语义 [spec.md:84](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:84) 矛盾。
- **建议修法**：分别记录 `graphCopiedThisRun`、`snapshotCopiedThisRun`、`buildAttempted`、`buildSucceeded`；snapshot 绝不能决定 graph 来源。对“本次未改变已有图”应保留上一份可信来源，或在 spec 中新增明确的 `preexisting/unchanged` 语义。JSON 读取要返回“缺失字段 / 文件不存在 / 解析失败”三种结果，解析失败仍须原子落盘非 ready 状态。

### C5. `.worktreeinclude` 安全子集漏掉了 spec 明确禁止的尾部 `/`

- **问题描述**：plan 的 Bash 六类拒绝、数据合同和 reason union 都没有 `trailing-slash`；仅有 `is-directory` 不能覆盖“不存在的目录式条目”。
- **命中 plan**：文件改动表行 184、数据合同行 205–212：[plan.md:184](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/plan.md:184)、[plan.md:205](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/plan.md:205)、[plan.md:212](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/plan.md:212)。
- **能证伪的具体场景**：实测：

  ```text
  git check-ignore -v --no-index '.env.local/'
  exit=0
  .gitignore:17:.env*    .env.local/
  ```

  `.env.local/` 满足 ignored 检查；路径尾斜杠又会使常规文件存在性检查表现为不存在，从而跳过目录检查。它因此可能通过 plan 描述的 validator，但被 [spec.md:69](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:69) 明确禁止。
- **建议修法**：将 `trailing-slash`、`not-ignored`、`not-regular-file` 纳入正式 reason union、Bash 校验和共同 golden matrix。

### C6. Bash 与 Node 是两套清单解析器，CRLF/BOM/EOF 等语义未定义

- **问题描述**：plan 说“同一纯函数双消费”只覆盖 vitest/repo:check；真正执行 copy 的 Bash 仍有独立解析实现，没有跨实现合同测试。
- **命中 plan**：决策 4 行 80、文件改动表行 173/184：[plan.md:80](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/plan.md:80)、[plan.md:173](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/plan.md:173)。
- **能证伪的具体场景**：当前环境禁止 `/tmp` 写入，`mktemp -d /tmp/f239-parser.XXXXXX` 实际返回 `Operation not permitted`，所以未伪造已完成临时文件测试。作为不写仓库的降级，我在 `/tmp` cwd 用同一字节流直接喂 Bash 循环，输出为：

  ```text
  entry=.env.local$'\r'
  entry=path.env\ \#\ inline\ comment
  entry=\ \ \#\ indented\ comment
  entry=$'\357\273\277'bom.env
  entry=last.env
  ```

  去掉 `read ... || [[ -n "$line" ]]` 后，最后一行 `last.env` 直接消失。仓库没有针对该文件强制 LF 的 `.gitattributes`：[.gitattributes:1](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/.gitattributes:1)。
- **建议修法**：先钉死 grammar：是否剥首行 BOM、是否剥单个 `\r`、是否拒绝前后空白/行内 `#`、无末尾换行必须接受。让同一份 golden byte fixtures 同时驱动 Node parser 和 Bash CLI 输出；不能只分别单测。

### C7. repo:check 第 14 族会让两个现有非 Git 沙箱测试直接回归

- **问题描述**：plan 要求 `.worktreeinclude` 缺失为 fail，并用 `git check-ignore`；现有 repo:check 集成沙箱既没有复制 `.worktreeinclude`，也没有初始化 Git。
- **命中 plan**：测试步骤 1/13、文件改动表行 188：[plan.md:240](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/plan.md:240)、[plan.md:252](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/plan.md:252)。
- **能证伪的具体场景**：

  - `spec-drift-repo-check-modes` 的复制清单不含该文件：[spec-drift-repo-check-modes.test.ts:50](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/tests/integration/spec-drift-repo-check-modes.test.ts:50)，却要求基线整体 `pass`：[同文件:140](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/tests/integration/spec-drift-repo-check-modes.test.ts:140)。
  - `repo-maintenance-sync-check` 同样只复制固定文件：[repo-maintenance-sync-check.test.ts:68](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/tests/integration/repo-maintenance-sync-check.test.ts:68)，并断言 repo:check pass：[同文件:155](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/tests/integration/repo-maintenance-sync-check.test.ts:155)。

- **建议修法**：文件改动表和任务必须纳入这两个集成测试；沙箱复制 `.worktreeinclude` 并 `git init`，或者给 validator 注入可测试的 `isIgnored` adapter。canonical 仓库缺文件仍应 fail，不能为迁就 fixture 将其静默 skip。

### C8. FR-011 canary 只能证明“没改”，不能证明“没读”，且测试很可能在无校验时也绿

- **问题描述**：内容/mtime 快照无法检测读取；plan 的样例输入又没有确保危险 source 真正存在，当前 `copy_path` 会因“source 不存在”自行 skip。
- **命中 plan**：决策 6 行 148–163、测试步骤 4：[plan.md:148](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/plan.md:148)、[plan.md:243](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/plan.md:243)。
- **能证伪的具体场景**：

  - `copy_path` 首先对 source 做 `-e` 元数据读取；不存在即打印“跳过”：[sync-worktree-local-state.sh:228](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/sync-worktree-local-state.sh:228)。测试的宽泛 `/跳过|警告/` 会把这个普通日志误当 containment 成功证据。
  - glob 参数始终被引号包住：[sync-worktree-local-state.sh:246](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/sync-worktree-local-state.sh:246)，所以 plan 只创建 `decoy.env` 并不能让 `*.env` 在无 validator 时展开，测试仍可能绿。
  - 脚本末尾本来就会读取、并可能写入 `$HOME/.claude/projects`：[sync-worktree-local-state.sh:369](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/sync-worktree-local-state.sh:369)。plan 恰好拒绝替换 HOME，因此无法声称“整个进程零仓库外读取”。

- **建议修法**：测试使用隔离 HOME；每类非法条目都创建其“若无校验便会被读取/复制”的精确 literal source；断言明确 reason code，而非宽泛“跳过”。零读取需 syscall audit、可注入 FS adapter，或把 SC 收窄为“非法条目不得调用 copy/read 函数”；mtime canary只能保留作零写入证据。

### C9. 测试步骤 3/9/10 的“先红”及 wiring 证明不成立

- **问题描述**：多个步骤在旧实现上不会红，因此不能证明新代码接线生效。
- **命中 plan**：测试步骤 3、9、10：[plan.md:242](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/plan.md:242)、[plan.md:248](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/plan.md:248)。
- **能证伪的具体场景**：

  - 步骤 3 只 rerun 现有三个 `.env.local` 用例；硬编码 `COPY_TARGETS` 本来就会通过它们，[现有测试:180](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/tests/unit/sync-worktree-local-state.test.ts:180)。
  - 步骤 9 仅改变两个 stale fixture 的 JSON shape；旧 sidecar 仍会让两个测试通过，[现有测试:325](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/tests/unit/sync-worktree-local-state.test.ts:325)。
  - 步骤 10 “移除 sidecar 断言”并不证明 sidecar 不再生成。

- **建议修法**：新增三类真正的红测试：

  1. 清单新增非 `.env.local` ignored 路径后应复制；清单移除 `.env.local` 后不得复制。
  2. 内嵌 commit stale、sidecar 刻意写成 current，仍必须 warning；反向场景内嵌 fresh、sidecar stale，不得误报。
  3. bootstrap 后明确断言 sidecar 不存在，并覆盖遗留 sidecar 清理。

### C10. F193 sidecar “完全移除”缺少现存文件迁移，且公开文档仍把它当现行合同

- **问题描述**：删除 writer/reader 不会删除各 worktree 已存在的 ignored sidecar；它仍是可查询且可能错误的第二份 provenance。
- **命中 plan**：决策 1 行 35–37、步骤 10、回滚方案行 283：[plan.md:35](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/plan.md:35)、[plan.md:249](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/plan.md:249)、[plan.md:283](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/plan.md:283)。
- **能证伪的具体场景**：当前 worktree 实际仍有该文件，值为 `8092d1a…`。全仓精确搜索：

  ```bash
  rg -n --hidden --glob '!.git/**' --fixed-strings '.graph-source-commit' .
  ```

  返回 **17 处 / 10 个文件**：运行时代码仅 sync 脚本，但还包括现行公开文档 [spectra-cli-reference.md:172](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/docs/spectra-cli-reference.md:172)、单测、F193 历史制品和 F239 文档。plan 的“唯一运行时消费者”成立，但“删除无外部影响”不成立。其回滚方案“sidecar 只读 + 新状态并存”也不满足 spec 要求的同步更新或取代。
- **建议修法**：在新状态成功原子落盘后，迁移性删除遗留 sidecar；dry-run 只报告。新增 seeded-legacy 清理测试。更新 `docs/spectra-cli-reference.md`；F193 spec/plan/tasks 可作为历史制品保留并标注 superseded，无需篡改历史。

### C11. 现有 `copy_if_absent_atomic` 只保证“发布不半写”，不保证真正 no-clobber

- **问题描述**：plan 直接复用该函数，但它采用“检查不存在 → 普通 `mv`”；两个进程可以同时通过第二次检查，后执行的 `mv` 默认覆盖先到达的目标。
- **命中 plan**：决策 2 复用理由行 51、批 3 行 265：[plan.md:51](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/plan.md:51)、[plan.md:265](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/plan.md:265)。
- **能证伪的具体场景**：竞态窗口正位于 [sync-worktree-local-state.sh:299](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/sync-worktree-local-state.sh:299) 到普通 `mv` [sync-worktree-local-state.sh:306](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/sync-worktree-local-state.sh:306)。post-commit 在第二次 `-e` 后生成本地图，随后 bootstrap 的普通 `mv` 仍会替换它。
- **建议修法**：用真正的原子 exclusive publish，例如同文件系统内 `link(temp, target)`，`EEXIST` 即保留目标，然后删除 temp；或使用经过 darwin/Linux 验证的 no-clobber primitive。加入 barrier 控制的双进程竞态测试。

## WARNING

### W1. 新状态文件的并发 temp 命名未定义

- **问题描述**：plan 只说 temp+rename，没有要求每个 writer 使用唯一临时名；如果照仓库现有 `writeAtomicJson` 的固定 `.tmp` 习惯实现，并发 writer 会互相覆盖/rename 掉同一 temp。
- **命中 plan**：决策 5 行 95、数据合同行 232、测试步骤 6：[plan.md:95](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/plan.md:95)、[plan.md:245](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/plan.md:245)。
- **能证伪的具体场景**：仓库现有 helper 使用固定 `${path}.tmp`：[atomic-write.ts:25](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/src/utils/atomic-write.ts:25)。若照搬，两个 status writer 中一个可能得到 `ENOENT`，不满足“后写覆盖”。
- **建议修法**：同目录使用 PID+随机值的唯一 temp，rename 前完整 fsync 非硬要求但可评估；新增真实并发 writer 测试，而不只测试单次原子写。

### W2. 决策 1 对 `spectra index` 的事实描述不准确

- **问题描述**：plan 声称 `spectra index` 也会更新 `graph.json.graph.sourceCommit`；当前 index 只写 `.spectra` snapshot。
- **命中 plan**：决策 1 行 32–33：[plan.md:32](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/plan.md:32)。
- **能证伪的具体场景**：index 构建并保存 UnifiedGraph snapshot 的路径见 [index.ts:156](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/src/cli/commands/index.ts:156)；全仓 `sourceCommit =` 只有 batch 两处和 graph command 的 null 写入。sidecar 移除的结论仍可由 batch/watch 路径支持，但该论据本身不实。
- **建议修法**：删除 `spectra index` 这一例，准确列出 `batch/graph-only/watch(runBatch)`。

### W3. 测试步骤 5 不是红测试，批次依赖说明也自相矛盾

- **问题描述**：allowlist 当前本来就是六项，新增 characterization test 应首跑为绿；plan 却总称“每个 FR 先红”。批 4 又先称依赖批 3，随后承认没有直接依赖。
- **命中 plan**：测试步骤 5、实现分批行 269：[plan.md:244](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/plan.md:244)、[plan.md:269](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/plan.md:269)。
- **能证伪的具体场景**：当前数组已经精确六项：[sync-worktree-local-state.sh:151](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/sync-worktree-local-state.sh:151)，所以正确 characterization test 不会红。
- **建议修法**：把序列标题改为“红测试或 characterization guard → 实现 → 回归”，并删除虚假的批 3→批 4依赖。

## INFO / 无法证伪的攻击方向

### I1. 没找到第二个可执行 sidecar 消费者

- **问题描述**：全仓搜索发现公开文档与测试引用，但没有第二个运行时代码消费者。
- **命中 plan**：决策 1 行 35。
- **具体场景**：`SOURCE_COMMIT_REL`、`check_graph_source_stale` 的可执行命中全部位于 [sync-worktree-local-state.sh:267](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/sync-worktree-local-state.sh:267) 与同文件函数。F193 8 个测试中，直接断言 sidecar 文件的只有首个用例；另两个 stale 用例依赖其语义。
- **建议修法**：保留“唯一运行时消费者”的表述，但删掉“无外部影响”，并落实 C10 的文档/遗留文件迁移。

### I2. Vitest 下 import `evaluateFreshness` 是可行的

- **问题描述**：此攻击方向无法证伪 plan。
- **命中 plan**：决策 5 行 110、测试步骤 7。
- **具体场景**：现有 [source-commit.test.ts:14](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/src/panoramic/graph/source-commit.test.ts:14) 已直接 import 同一 TS 模块及其 Java/Go 传递依赖；真实临时 Git fixture 已覆盖非 Git HEAD：[同文件:100](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/src/panoramic/graph/source-commit.test.ts:100)。M8 全量基线也已通过。
- **建议修法**：测试 import 路径沿用仓库惯例的 `.js` specifier；真正问题是 C3 的语义缩水，不是模块解析。

### I3. 已知 graph writer 不会让 reader 看到半个 JSON

- **问题描述**：针对“copy 时 JSON.parse 撞半文件”的狭义攻击，现有实现已处理。
- **命中 plan**：决策 5 的 live read、决策 6/W4。
- **具体场景**：bootstrap 先复制到 PID temp，再 rename：[sync-worktree-local-state.sh:294](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/sync-worktree-local-state.sh:294)；graph-only 经 `writeKnowledgeGraph` 调用原子写：[graph-builder.ts:529](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/src/panoramic/graph/graph-builder.ts:529)。reader 通常只会看到“无文件或完整文件”。
- **建议修法**：无需为半文件加锁，但仍须修 C4 的来源竞态、C11 的 no-clobber 竞态和 W1 的 status temp 冲突。

### I4. 8 个既有 F193 用例的直接迁移数量基本对上，但断言力度不足

- **问题描述**：sidecar 移除后直接变红的是首个 sidecar 断言和两个 stale 用例；plan 的步骤 9/10确实覆盖了这三类。其余五个在 helper 对 unknown/缺图保持 exit 0 时应继续通过。
- **命中 plan**：测试步骤 9/10、注意 1。
- **具体场景**：八个用例位于 [sync-worktree-local-state.test.ts:271](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/tests/unit/sync-worktree-local-state.test.ts:271) 至 [同文件:380](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/tests/unit/sync-worktree-local-state.test.ts:380)。
- **建议修法**：数量无需扩大，但按 C9 加入 poison-sidecar、明确 sidecar absent 和真实动态 manifest 断言。

## 工具使用反馈

本次用 `spec-driver-implement` 的 contract/plan-review 口径做只读审查，未启动实施阶段，也未修改仓库。Spectra MCP 在当前会话没有可调用入口；目标又主要是 Bash、MJS、测试与文档，因此用精确 `rg`、逐行读取和只读命令完成。唯一受限项是系统禁止创建 `/tmp` 文件，故 Bash parser 只能做不落盘的等价字节流实测，已明确披露，没有改写到 worktree。

## 总体判断

**修完 CRITICAL 后可以进入 tasks 阶段。**

不需要推翻六项核心方向，但必须重做决策 5 的 freshness/timeout 子方案，修正 `bootstrapSource` 状态机，补齐 `.worktreeinclude` grammar 与 repo:check fixture 合同，并把测试策略改成真正能先红、能证明接线、能覆盖竞态的版本。当前版本直接进入 tasks，极可能在 SC-001、SC-006、SC-007、SC-009 四个硬门禁上出现假绿或全量回归失败。

Codex session ID: 019fc22e-fca1-7502-b541-d857af8d298b
Resume in Codex: codex resume 019fc22e-fca1-7502-b541-d857af8d298b
