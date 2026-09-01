# T063（= F239 T039）Codex managed worktree 只读验证报告

- 观测时间：2026-08-31 00:21:09 CST (+0800)
- 总体结论：**UNEXPECTED**
- 判定摘要：第 1 项 PASS；第 2a/2b 项 UNEXPECTED；第 3 项 PASS（限定观察）；第 4 项 PASS。
- 只读边界：未修改主仓库或 managed worktree；未执行 commit/push/stash/checkout；唯一写入为本报告 `/tmp/t063-report.md`。
- Codex 桌面客户端版本号：**【待用户填写】**

## 0. 环境

### 原始输出

```text
$ date '+%Y-%m-%d %H:%M:%S %Z (%z)'
2026-08-31 00:21:09 CST (+0800)
[exit 0]

$ codex --version
codex-cli 0.151.0
[exit 0]

$ pwd
/Users/connorlu/.codex/worktrees/1a26/cc-plugin-market
[exit 0]

$ git rev-parse --show-toplevel
/Users/connorlu/.codex/worktrees/1a26/cc-plugin-market
[exit 0]

$ git rev-parse --git-common-dir
/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.git
[exit 0]

$ git worktree list
/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market                                                   f7a65aa9 [master]
/Users/connorlu/.codex/worktrees/1a26/cc-plugin-market                                                        f7a65aa9 (detached HEAD)
/Users/connorlu/.codex/worktrees/df87/cc-plugin-market                                                        f7a65aa9 (detached HEAD)
/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/atomic-write-defects-fix-5606c8 f7a65aa9 [claude/compliance-evidence-ledger-0f0e5e]
/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/funny-driscoll-fc77bb           f7a65aa9 [claude/test-guard-asset-cleanup-6b29b3]
/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73        f7a65aa9 [claude/product-surface-consistency-sweep-ce620d]
/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/vigorous-mahavira-7de572        befa5d4d (detached HEAD)
[exit 0]

$ git rev-parse HEAD
f7a65aa90eb22f18b2fc9fa2420a36c7c1692456
[exit 0]
```

### 结论：PASS

当前会话位于 Codex managed worktree `/Users/connorlu/.codex/worktrees/1a26/cc-plugin-market`，detached HEAD 为 `f7a65aa90eb22f18b2fc9fa2420a36c7c1692456`；主仓库路径由 Git common dir 与 worktree list 一致定位为 `/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market`。CLI 版本为 0.151.0；桌面客户端版本需用户补填。

## 1. `.worktreeinclude` copy-if-absent

### 原始输出

```text
$ ls -la /Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.worktreeinclude
-rw-r--r--@ 1 connorlu  staff  11 Aug  3 00:05 /Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.worktreeinclude
[exit 0]

$ cat /Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.worktreeinclude
.env.local
[exit 0]

$ ls -la /Users/connorlu/.codex/worktrees/1a26/cc-plugin-market/.env.local
-rw-------@ 1 connorlu  staff  137 Aug 31 00:19 /Users/connorlu/.codex/worktrees/1a26/cc-plugin-market/.env.local
[exit 0]

$ ls -la /Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.env.local
-rw-------@ 1 connorlu  staff  137 May  5 19:57 /Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.env.local
[exit 0]

$ readlink /Users/connorlu/.codex/worktrees/1a26/cc-plugin-market/.env.local
[stdout 为空]
[exit 1]

$ diff <(cat /Users/connorlu/.codex/worktrees/1a26/cc-plugin-market/.env.local) <(cat /Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.env.local)
[stdout 为空]
[exit 0]
```

### 结论：PASS（限只读可观察状态）

- 主仓 `.worktreeinclude` 恰好只有 `.env.local` 一行。
- managed worktree 根存在 `.env.local`。
- `diff` 退出 0，说明两份内容逐字节一致；未回显 secret 内容。
- `ls -la` 类型位为 `-`，且 `readlink` 无输出并退出 1，说明 managed worktree 中该文件是常规文件，不是 symlink，符合“原生复制”的结果形态。
- 受“只观察、只读”约束，未通过预置目标后再次创建 worktree 的破坏性/变更性实验独立验证“不覆盖已存在目标”的完整 copy-if-absent 生命周期；当前结果与该语义一致。

## 2. `AGENTS.override.md` 同层取代

### 2a. 文件层原始输出

```text
$ ls -la /Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/AGENTS.override.md
ls: /Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/AGENTS.override.md: No such file or directory
[exit 1]

$ ls -la /Users/connorlu/.codex/worktrees/1a26/cc-plugin-market/AGENTS.override.md
ls: /Users/connorlu/.codex/worktrees/1a26/cc-plugin-market/AGENTS.override.md: No such file or directory
[exit 1]

$ find /Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market -maxdepth 1 -name 'AGENTS*' -print
/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/AGENTS.md
[exit 0]

$ find /Users/connorlu/.codex/worktrees/1a26/cc-plugin-market -maxdepth 1 -name 'AGENTS*' -print
/Users/connorlu/.codex/worktrees/1a26/cc-plugin-market/AGENTS.md
[exit 0]

$ git -C /Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market check-ignore -v AGENTS.override.md
.gitignore:51:AGENTS.override.md	AGENTS.override.md
[exit 0]

$ git -C /Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market status --ignored --short -- AGENTS.override.md
[stdout 为空]
[exit 0]

$ diff /Users/connorlu/.codex/worktrees/1a26/cc-plugin-market/AGENTS.override.md /Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/AGENTS.override.md
diff: /Users/connorlu/.codex/worktrees/1a26/cc-plugin-market/AGENTS.override.md: No such file or directory
[exit 2]
```

### 2a 结论：UNEXPECTED

ignore 规则存在且 `git check-ignore` 成功，但在本次观测时，主仓根与 managed worktree 根都没有 `AGENTS.override.md`。这与任务输入“主仓库有”这一测试前提不符。由于源文件本身缺席，不能据此强判 Codex 的自动复制机制 FAIL；只能记录为 UNEXPECTED，且“是否同步过来”无法完成有效对照。

### 2b. 生效层原始观察

命令侧证据：

```text
$ rg -n --fixed-strings 'T063-OVERRIDE-MARKER-20260831' /Users/connorlu/.codex/worktrees/1a26/cc-plugin-market/AGENTS.override.md
rg: /Users/connorlu/.codex/worktrees/1a26/cc-plugin-market/AGENTS.override.md: IO error for operation on /Users/connorlu/.codex/worktrees/1a26/cc-plugin-market/AGENTS.override.md: No such file or directory (os error 2)
[exit 2]

$ rg -n --fixed-strings 'T063-OVERRIDE-MARKER-20260831' /Users/connorlu/.codex/worktrees/1a26/cc-plugin-market/AGENTS.md
[stdout 为空]
[exit 1]
```

会话 turn setup 的项目指令块原始识别信息（与用户消息分开观察）：

```text
# AGENTS.md instructions for /Users/connorlu/.codex/worktrees/1a26/cc-plugin-market
```

逐字记录实际自省结果：

```text
项目指令块中是否包含 T063-OVERRIDE-MARKER-20260831：否
加载的项目文件：AGENTS.md
判断依据：turn setup 的项目指令块标题明确写为 “AGENTS.md instructions ...”；其内容与 worktree 根 AGENTS.md 开头一致；项目指令块中无 marker。marker 只出现在本次用户任务文本中，不计作项目指令加载证据。
```

### 2b 结论：UNEXPECTED

本会话实际加载的是 `AGENTS.md`，没有加载带 marker 的 override。由于 2a 已证明观测时源/目标 override 都不存在，这一结果符合“override 缺席时回退 AGENTS.md”的语义，但没有验证到 F239 所要求的“override 存在时同层取代”。因此不强判 FAIL，记 UNEXPECTED。

## 3. Codex 0.149+ 指令文件沙箱可读性

### 原始输出

```text
$ ls -la /Users/connorlu/.codex/worktrees/1a26/cc-plugin-market/AGENTS.md
-rw-r--r--@ 1 connorlu  staff  24316 Aug 31 00:19 /Users/connorlu/.codex/worktrees/1a26/cc-plugin-market/AGENTS.md
[exit 0]

$ sed -n '1,12p' /Users/connorlu/.codex/worktrees/1a26/cc-plugin-market/AGENTS.md
# Spectra / spec-driver — Codex 适配约定

本文件定义在 Codex 中运行本仓库能力时的统一约束，目标是在不牺牲现有功能语义的前提下保持双端兼容（Claude Code + Codex）。

## 1. 入口映射

- `spectra` 能力优先走 CLI：单模块 `spectra generate`、批量 `spectra batch`、漂移 `spectra diff`
- Spec Driver Codex 包装技能：`npm run codex:spec-driver:install` 或 `bash plugins/spec-driver/scripts/codex-skills.sh install`

## 2. Spec Driver 兼容执行

`plugins/spec-driver/skills/*/SKILL.md` 主流程不变；缺少 `Task tool` 时回退为内联子代理调用，读取 `agents/<phase>.md`，并行组回退串行并标注 `[回退:串行]`。模型选择：`--preset → agents.{id}.model → preset 默认`，通过 `model_compat` 做运行时映射。
[exit 0]

$ sed -n '1,12p' /Users/connorlu/.codex/worktrees/1a26/cc-plugin-market/AGENTS.override.md
sed: /Users/connorlu/.codex/worktrees/1a26/cc-plugin-market/AGENTS.override.md: No such file or directory
[exit 1]
```

### 结论：PASS（限定观察）

- `AGENTS.md` 可由当前会话直接读取，未遇到 `Operation not permitted`、sandbox denial 或其他权限阻拦。
- turn setup 成功向本会话注入项目指令，没有出现可见的 setup/fail-loud 报错。
- `AGENTS.override.md` 的读取失败原样为 `No such file or directory`，属于文件缺席（ENOENT），不是沙箱阻拦。
- 因 override 缺席，本次没有实际覆盖到“发现了 override 但受限环境不可读”的 #39653 触发形态；这里只能确认 AGENTS.md 路径可读、turn setup 未报错。

## 4. 环境记录

### 原始输出

环境所需四项已在“0. 环境”完整给出：

```text
Codex 桌面客户端版本号：【待用户填写】
codex --version：codex-cli 0.151.0
managed worktree：/Users/connorlu/.codex/worktrees/1a26/cc-plugin-market
HEAD：f7a65aa90eb22f18b2fc9fa2420a36c7c1692456
git worktree list：见“0. 环境”原始输出
```

### 结论：PASS

所有可由代理读取的环境字段均已记录；桌面客户端版本号无法从 `codex --version` 等同推出，按要求留占位由用户填写。

## F239 / T039 对照与不符清单

### 原始 spec/task 输出

```text
$ nl -ba specs/239-worktree-local-state/tasks.md | sed -n '261,263p'
   261	- [ ] T039 [批5][手工验证] **Codex 桌面客户端行为人工验证**（spec Non-Goals 已声明不入自动化门禁）：在真实 Codex 桌面应用中为本仓库创建一个 managed worktree，验证 (a) `.worktreeinclude` 中列出的 copy 类文件（`.env.local`）被 Codex 原生复制（copy-if-absent 语义）；(b) 若本地存在已被 ignore 的 `AGENTS.override.md`，该文件确实取代 `AGENTS.md` 生效
   262	  - 文件：无（人工操作记录）
   263	  - 完成判据：两项行为均被人工观察确认并记录结论（含 Codex 客户端版本号），若观察结果与 spec 边界声明不符需回报主编排器评估影响
[exit 0]

$ nl -ba specs/239-worktree-local-state/spec.md | sed -n '54,60p'
    54	- **Given** 开发者在 Codex 桌面应用中为某仓库新建一个 managed worktree 并开始新 chat
    55	- **When** Codex 按官方机制自动处理 `.worktreeinclude`（copy-if-absent 语义复制 ignored 文件）与 `AGENTS.override.md`（若本地存在且已被 ignore 则取代 `AGENTS.md`），随后 setup 阶段调用本仓库提供的 bootstrap 入口
    56	- **Then**：
    57	  - `.worktreeinclude` 中列出的 copy 类文件（含 secret）被 Codex 原生复制到新 worktree（本 feature 不编写代码控制 Codex 这一步的执行，只保证清单内容符合安全子集且格式合规）
    58	  - bootstrap 入口按 FR-010 定义的双腿验收执行，并写出与场景 A 一致 schema 的结构化状态记录，不静默宣称 ready
    59	  - 若本地存在已被 ignore 的 `AGENTS.override.md`，本地私有指令生效
    60
[exit 0]

$ nl -ba specs/239-worktree-local-state/spec.md | sed -n '92,93p'
    92	- **FR-007（AGENTS.override.md 必须处于 ignored 前提）**：`.gitignore` 必须新增规则使 `AGENTS.override.md` 被 git 忽略。验收包含：`git check-ignore AGENTS.override.md` 命令必须成功（退出码 0）；且必须有断言确认 `AGENTS.override.md` 字符串不出现在 `.worktreeinclude` 内容中（因为官方机制会自动复制该文件，无需、也不应重复列入清单）。
    93	- **FR-008（byte budget 校验：按 active 文件、按 max 不按 sum）**：必须新增可重复运行的字节数校验手段（脚本或测试断言），对**每一个在仓库根目录可能成为 Codex 同层 active 文件的候选**分别校验其字节数 ≤ 32768（Codex `project_doc_max_bytes` 默认值）：即 `AGENTS.md` 与（若存在）`AGENTS.override.md` 各自独立校验，取二者中的较大值与预算比较，而非将二者字节数相加——因为 `AGENTS.override.md` 存在时是同层**取代** `AGENTS.md`（官方“二选一”语义），而非叠加读取。若未来仓库出现 nested 目录下的 `AGENTS.md`/`AGENTS.override.md`（当前仓库经实测确认只有仓库根一份，无 nested），该校验手段需要按 root→cwd 路径累计计算，这一前瞻性要求本 feature 只需留下扩展点，不需要在无 nested 文件的当前状态下实现累计逻辑。当前实测基线：`AGENTS.md` = 23346 bytes（占预算 71.2%，余量 9422 bytes），`AGENTS.override.md` 尚不存在。
[exit 0]
```

### 与声明不符/无法闭环之处

1. **测试输入前提不符（UNEXPECTED）**：任务明确称主仓库有 ignored `AGENTS.override.md`，但实测主仓根不存在该文件；只有 ignore 规则存在。
2. **T039 第二项未得到所需观察（UNEXPECTED）**：managed worktree 中无 override，项目指令块无 marker，实际加载 `AGENTS.md`。这不足以验证“override 存在时自动复制并取代”这一条件语义。
3. **没有证据证明 Codex 语义本身违反 F239**：因为 spec 的 override 语句是“若本地存在”的条件式，而实测时源文件不存在；当前回退到 `AGENTS.md` 反而与 override 缺席时的选择逻辑一致。故不把该现象强判 FAIL。
4. **`.worktreeinclude` 路径未发现声明不符**：`.env.local` 存在、逐字节一致、且为常规文件；只读限制下未独立做目标预存在时的“不覆盖”实验。

## 最终判定

**UNEXPECTED；本轮证据不足以将 T063/T039 记为完成。** 第 1 项满足只读可观察判据；第 2 项的必要 fixture（主仓 ignored override 文件及 marker）在观测时不存在，因此既不能确认自动复制/同层取代，也不能将产品行为判 FAIL。应由主线程确认 override 为何在 managed worktree 创建时/本次观测时缺席，补齐同一新建 worktree 场景后重跑第 2 项，并补填 Codex 桌面客户端版本号。按任务要求，本报告不更新 `tasks.md`。

## 只读完整性复核

```text
$ git -C /Users/connorlu/.codex/worktrees/1a26/cc-plugin-market status --short
[stdout 为空]
[exit 0]

$ git -C /Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market status --short
[stdout 为空]
[exit 0]
```

复核结论：managed worktree 与主仓库最终状态均为 clean，本次未改动任何仓库文件。

## 工具使用反馈

- Spectra MCP：本次未使用；任务仅需固定路径的只读文件/会话观察，无需结构化代码图上下文。
- Spec Driver：本次未运行；这是已挂账人工验证，且硬约束禁止修改仓库制品。
- 流程反馈：无工具缺陷结论。实际阻断来自测试 fixture 前提（主仓 override 文件缺席），不应归因于 Spectra / Spec Driver。
