# F270 开工前基线（禁止把预存状态误判为本次引入的回归）

采集时间：2026-08-31 · HEAD = `f7a65aa9` · 分支 `claude/compliance-evidence-ledger-0f0e5e`

## 1. 测试基线

| 命令 | 结果 | 说明 |
|---|---|---|
| `npm run test:plugins` | **1585 tests / 1583 pass / 0 fail / 2 skipped** | 起点全绿。2 skipped 中含 `fix-compliance-judge-cli.test.mjs` 那份**仓库外真实会话回放**（硬编码 `~/.claude/projects/...`，本机不存在即 `t.skip()`）——这条 skip 是**结构性**的，不是本次引入 |
| `npm run repo:check` | 全 pass + **1 个预存 warning** | warning = `[graph-quality] 图产物已 stale（source-commit）`：图记录 `3871dc04` ≠ HEAD `f7a65aa9`。**先于本需求存在**，本需求不碰 `src/` 故不负责修复 |

> vitest 主套件未在本阶段重跑：本需求写入面限于 `plugins/spec-driver/**`（`.mjs`/`.sh`/`.json`），按增量验证策略属 Level 0–1。M10 体检（2026-08-31）记录 vitest 7894/0 全绿，作为参照基线；Phase 4.5 编排器独立验证时按实际改动面决定是否全量重跑。

## 2. 🔴 judge:doctor 已处于 drift 状态（**先于本需求存在**）

```
snapshotPath:     ~/.claude/plugins/cache/cc-plugin-market/spec-driver/4.4.0
resolutionSource: spec-driver-path-file
status:           drift
  [mismatch]          scripts/fix-compliance-judge.mjs
  [mismatch]          scripts/lib/fix-compliance-core.mjs
  [match]             scripts/lib/fix-compliance-execution-record.mjs
  [mismatch]          scripts/lib/fix-compliance-io.mjs
  [missingInSnapshot] scripts/lib/is-invoked-directly.mjs
  [match]             scripts/lib/simple-yaml.mjs
  [mismatch]          scripts/record-workflow-run.mjs
汇总: 4 mismatch / 2 match / 1 missingInSnapshot        (进程退出码 0)
```

**这条基线为什么重要**：

1. **本机当前生效的门禁不是 worktree 源码**，而是 `spec-driver/4.4.0` 这份已经落后的插件快照。F236 教训在本仓当下**正在发生**，不是历史。
2. `is-invoked-directly.mjs` 在快照里**根本不存在**（`missingInSnapshot`）——即快照比源码落后了整整一个模块。
3. 快照版本 **4.4.0**，而 G0-1 已发布 **4.5.0**：本机插件安装未跟随发布。
4. **验收含义**：本次改动完成后 `judge:doctor` **仍会报 drift**，而且会**多出**新增的账本模块条目。验收时**不得**把"doctor 报 drift"当作本次引入的问题；正确判据是「本次改动引入的文件在快照中的状态**相对本基线的增量**」，以及改动后是否按要求重新同步快照。
5. `judge:doctor` 报 drift 时**进程退出码为 0**（不阻断）。这一点在设计"修完必须 judge:doctor 并说明生效时点"的验收步骤时须知——它是**报告工具**不是门禁。

## 3. 两个不同的生效时点（F236 + 本次实测的区分）

| 变更载体 | 是否热加载 | 生效时点 | 取证 |
|---|---|---|---|
| `.claude/settings.local.json` 的 `hooks` 段 | ✅ **热加载** | 注入后**下一次工具调用**即生效（本次实测直证） | `research/harness-field-probe.md` §1.1 |
| 插件 `hooks/hooks.json` + `scripts/**`（走 `~/.claude/plugins/cache/.../<version>/` 快照） | ❌ **不热加载** | 需重装/同步插件快照；在此之前**本机跑的仍是旧快照** | 本文件 §2（当下即 drift） |

> **对本需求的直接后果**：新增的 PostToolUse 账本 hook 若通过**插件** `hooks.json` 分发，则在插件快照同步前**本机不生效**——因此"本机自验"必须显式区分「用 settings.local.json 临时挂载验证逻辑正确性」与「插件分发路径的真实生效」两件事，不能用前者的绿冒充后者。这一点必须写进 spec 的验收与 fix/verification 报告，否则会复刻 F236「以为在测新代码、实际跑旧快照」。

## 4. 工具链取证（供 plan 消费，避免验收时踩空）

### 4.1 `validate-codex-hooks` **未接入** `repo:check`，且 `--target` 不能对 canonical 文件用

- 无参运行直接返回「无法判定: 必须给出 `--target <path>` 或 `--codex-home <dir>`」，**进程退出码 0**（是报告工具，不是门禁）。
- `grep` 确认 `scripts/repo-check.mjs` / `repo-sync.mjs` **均无**对它的引用 → 它是**手工工具**，改 `hooks.json` 后 CI 与 `repo:check` 都不会自动校验。（这与卡面 P1-K「六套 validate/status CLI 无一接入 `repo:check`」的记载一致。）
- 🔴 **对 `--target` 语义的实测**：直接对 canonical `plugins/spec-driver/hooks/hooks.json` 跑，结论是 **fail**，且把我方 6 个事件全部识别为「第三方事件」、「我方 owned 事件(0)」：

  ```
  [codex-hooks] 结论: fail
  [codex-hooks] 我方 owned 事件(0): (无)
  [codex-hooks] 第三方事件(6): SessionStart, PreToolUse, PostToolUse, Stop, WorktreeCreate, WorktreeRemove
  [codex-hooks] FAIL product/product-event-missing  event=SessionStart|PreToolUse|PostToolUse|Stop
  [codex-hooks] FAIL product/product-handler-missing event=… (Stop 两条)
  [codex-hooks] WARNING schema/unknown-event-name    event=WorktreeCreate|WorktreeRemove
  ```

  **归因**：owned 识别依赖 handler `command` 里的**脚本路径形态**，而 canonical 文件里写的是**未展开**的 `bash ${CLAUDE_PLUGIN_ROOT}/hooks/xxx.sh`；Codex 侧注册后该变量**已展开为绝对路径**（F264 实测事实），届时才匹配得上 `OWNED_HOOK_SCRIPT_SUFFIXES`。

  > **对 FR-037 验收的直接含义**：**不得**用「对 canonical `hooks.json` 跑 `--target` 是否 pass」作为验收判据——它在改动前的**基线本来就是 fail**。正确做法是用 `--codex-home <隔离目录>` 对**真实安装产物**跑（F264 的验收即如此）。若 plan 写成前者，会得到一个与本次改动无关的红，并可能被误当作回归。
  > ⚠️ 上述 `--target` 行为属**实测观察**，未核对该 flag 的设计意图文档；plan 阶段若要依赖它，须先读实现确认。

### 4.2 GATE 暂停的实时信号：`record-workflow-run` 不可用

`record-workflow-run.mjs` 的 `gatePauses`（`:24/:85-86/:151/:173/:333`）属 `workflow-run-summary` 事件，是**流程结束时一次性写入**的汇总。本机 `.specify/runs/2026-08.jsonl` 实测取值恒为 `[]`。
→ GATE 暂停**发生当时不落盘**，故**不能**作为判定器的实时信号（详见 `spec.md` 附录 A-4 的裁决）。

### 4.3 账本落盘位置已验证安全

`.specify/runs/` 整目录被 `.gitignore:55` 忽略，`git check-ignore` 对三个候选路径（`.fix-compliance-state/x.json`、`.fix-compliance-ledger/sess.jsonl`、`ledger/a.jsonl`）**全部命中**。账本落此目录不会误入库。
现有两种可参照的布局：① `.fix-compliance-state/<sanitizedSessionId>.json`（按 session 分文件，**无 TTL**，合规时 `resetBlockState` 删）；② `.specify/runs/YYYY-MM.jsonl`（按月滚动）。
→ 供 spec `[NEEDS CLARIFICATION] #2`（账本隔离与清理策略）在 plan 阶段裁决时参考。

## 5. 环境事实

- Claude Code **2.1.220**（PATH 上 `~/.local/share/claude/versions/2.1.220`）；另有 volta 下 **2.1.215** 并存但不生效 → 任何"本机行为"结论须钉在 `readlink -f $(which claude)` 那一份。
- Codex **0.144.6**。
- `claude --print`（headless）**不可用**：OAuth session expired，需用户在交互式终端 `claude /login` 才能恢复 F245 式 headless 基线。
- Node **v24.14.0**。
