# 修复规划 — spec-driver init 脚手架污染用户 repo git diff + 绝对路径泄漏

**模式**: fix（精简规划，非完整架构设计）
**依据**: `specs/207-fix-init-scaffold-gitignore/fix-report.md`（方案 A：落盘脚本同步注入 `.gitignore` 条目）

## 1. 变更清单

> **Codex 四轮修复更新（提交前对抗审查处置）**：本节原契约（仅写 `.gitignore` + stale 锁抢占）经 Codex 实测暴露 5 项缺陷，已按下列裁决重构。以下小节保留原始设计叙述并在关键处标注 **[四轮修订]**。

**四轮修订要点汇总**：
- **分层防线（C2）**：新增主防线 `ensure_spec_driver_git_exclude` 写 `.git/info/exclude`（Git 原生非 tracked 项目级 ignore，零 diff 污染）；`.gitignore` 降为兜底防线（团队共享配置，覆盖 worktree/非 git 场景）。两个入口薄壳化，共享内部实现 `_spec_driver_inject_entries <target_file> <with_header>`（避免 178 行 ×2 复制）。
- **锁的组合策略**：两个入口各自独立拿锁/放锁（`_spec_driver_acquire_lock` → 注入 → `rmdir`），**不做组合锁**——init 端「先 exclude 后 gitignore」是两次独立的持锁-释放序列，无死锁；实测组合调用 + 20 并发均正确。
- **symlink 防御（C1）**：`_spec_driver_inject_entries` 内 `-L` 检测**必须先于** `-f` 分支——dangling symlink 时 `[[ ! -f ]]` 为真会走创建分支、`>` 重定向跟随 symlink 在外部创建文件。命中 → `failed:0`。
- **删 stale 抢占（W1）**：删除 `_spec_driver_gitignore_mtime`、`SPEC_DRIVER_GITIGNORE_LOCK_STALE_SECS`、mtime/date/age/rmdir 重试整段——实测预置过期锁 + 20 并发时多进程同判 stale、rmdir 互删对方新锁 → ABA 重复注入。抢锁失败一律 `skipped:0`。孤儿锁残余风险（临界区内 SIGKILL → 永久 skip）经权衡接受（毫秒级窗口 + 只静默跳过，危害远小于 ABA），已在 lib 顶部注释写明取舍。
- **negation 冲突检测（W2）**：归一化视图中若存在 `!<entry>` 或 `!<entry>*` 前缀行（如 `!.specify/templates/**`）→ 该条目跳过不追加，尊重用户显式 un-ignore 意图，不计入 `appended:N`。
- **NUL 防御（W3）**：装载视图前检测目标文件含 NUL（`wc -c` 原始字节数 vs `LC_ALL=C tr -d '\0'` 后字节数）→ `failed:0`，文件不改动。
- **postinstall 收窄**：SessionStart hook **只调 exclude**，不再写用户 tracked 的 `.gitignore`（伦理面：hook 不应静默修改 tracked 文件）；非 git repo 时 exclude 自然 skip，hook 零动作零痕迹。

---

### 1.1 新增 `plugins/spec-driver/scripts/lib/ensure-gitignore.sh`（共享库）

单一职责：确保 Spec Driver 落盘产物的 4 条 ignore 规则就位，幂等、无副作用（已就位则不触碰文件）。**[四轮修订]** 提供两个入口 `ensure_spec_driver_gitignore`（写 `.gitignore`，兜底）与 `ensure_spec_driver_git_exclude`（写 `.git/info/exclude`，主防线，仅 `.git` 为目录时执行，否则 `skipped:0`），共享内部实现 `_spec_driver_inject_entries`。

**函数签名与行为契约**：

```bash
# ensure_spec_driver_gitignore <project_root>
#
# 参数：
#   project_root - 宿主项目根目录绝对路径
#
# 行为：
#   1. 目标条目固定 4 条（与开发仓库 .gitignore 52-58 行一致，顺序即注入顺序）：
#      .specify/.spec-driver-path
#      .specify/runs/
#      .specify/scorecards/
#      .specify/templates/
#   2. 对 <project_root>/.gitignore：
#      - 不存在 → 创建新文件，写入注释头 "# Spec Driver 本地缓存与运行态"
#        + 4 行条目（无论宿主是否为 git 仓库都执行，见 2.3）
#      - 存在 → 逐条做精确整行匹配（grep -qxF '<entry>' .gitignore）；
#        已存在的条目跳过，不存在的追加到文件末尾
#      - 若需要追加且原文件末尾无换行符，追加前先补一个 '\n' 再写新增块，
#        避免追加内容与最后一行文本粘连成同一行（边界见 §2 第 5 条）
#   3. 全部 4 条均已就位（新建或已存在合计覆盖）时，不做任何写操作，
#      文件 mtime 保持不变（幂等的可观测契约，测试据此断言）
#   4. 非 git 目录（无 .git/）也正常执行写入，不因此报错或跳过
#      （用户后续 git init 时 ignore 规则即刻生效，属主动预防）
#   5. 全程不使用 set -e 会中断调用方主流程的写法：函数内部用 return 传状态，
#      不直接 exit；调用方决定是否记录/吞掉失败。不使用 trap EXIT（会污染被 source
#      进 set -euo pipefail 调用方的退出钩子），锁释放用每个 return 前显式 rmdir。
#   6. 匹配采用 CRLF 归一化视图：以 `tr -d '\r' < .gitignore | grep -qxF -- "$entry"`
#      判定条目是否存在，使 Windows 编辑器产出的 CRLF 行尾 .gitignore 不被误判为缺失
#      而重复追加；但不改写原文件行尾（只影响匹配判定视图）。
#      匹配用 here-string（grep -qxF -- "$entry" <<< "$view"）而非管道喂 grep：调用方
#      多为 set -o pipefail，大 .gitignore（>64KB pipe buffer）且目标条目在文件前部时，
#      grep -q 匹配即退会令 printf 写端收 SIGPIPE，管道退出码被 pipefail 放大成整体失败
#      → 已存在条目误判缺失而重复追加；here-string 无管道，规避此 SIGPIPE 误判。
#   7. 并发安全：用 mkdir 原子锁（<project_root>/.specify/.ensure-gitignore.lock）包裹
#      "检查缺失 → 追加/创建" 整个临界区。抢锁失败时检查 stale（锁目录 mtime 距今
#      > 60s 视为持锁进程已死，rmdir 后重试一次 mkdir）；仍失败或未 stale → 静默跳过
#      本次注入（stdout: skipped:0，下次会话自然收敛）。锁父路径 .specify/ 由函数兜底
#      mkdir -p 确保存在（.specify/ 是 Spec Driver 自身域，不越界）。bash 3.2 兼容。
#
# 返回值（stdout，供调用方感知信号）：
#   打印一行结果到 stdout，格式为下列之一：
#     "created:N"    — .gitignore 是新建的，写入 N 条（N 固定为 4）
#     "appended:N"   — .gitignore 已存在，追加了 N 条（N 为 1-4）
#     "ready:0"      — 已存在，且 4 条全部就位（CRLF 归一化视图判定），未做任何写入
#     "failed:0"     — 写入失败（只读 FS / 磁盘满等），未产出有效 .gitignore
#     "skipped:0"    — 并发会话持锁，本次跳过检查（非 ready，下次会话补齐）
#   调用方按此 stdout 内容拼装 INIT_RESULTS 信号或静默丢弃（postinstall 场景）
#
# 退出码：
#   始终返回 0（不使功能性失败传播为致命错误，含 failed / skipped 两态）；
#   仅当 project_root 参数为空或非目录时返回 1（调用方须处理该边界，
#   但两个调用方在正常运行时 project_root 恒为合法目录，理论上不会命中）
ensure_spec_driver_gitignore() {
  ...
}
```

**实现要点**：
- 复用现有 `plugins/spec-driver/.gitignore`（开发仓库自身）52-58 行的条目文案作为唯一事实来源的字面量（写死在函数内，无需外部读取，避免引入新的路径依赖）
- 精确匹配用 CRLF 归一化视图 `tr -d '\r' < "$gitignore_file" | grep -qxF -- "$entry"`（`-F` 纯字符串、`-x` 整行匹配，避免 `.specify/runs/` 被 `.specify/runs/xxx` 之类的宽松匹配误判为已存在，也避免正则特殊字符如 `.` 被误解释；`tr -d '\r'` 使 CRLF 行尾文件不被误判为缺失，且不改写原文件）
- 锁释放策略：函数体保持扁平（不用子 shell，避免丢失 `missing[]` 数组状态），每个 `return` 前显式 `rmdir "$lock_dir" 2>/dev/null || true`；因每处写入均以 `|| { rmdir; return 0; }` 守护，`set -euo pipefail` 下不会有命令在临界区中途 abort 导致锁泄漏
- mtime 跨平台读取：先试 `stat -c %Y`（GNU/Linux）再试 `stat -f %m`（BSD/macOS），任一成功即用；均失败时保守跳过不抢占 stale 锁
- 追加块统一带一次性小节头 `# Spec Driver 本地缓存与运行态（自动注入，可手动调整顺序）` ，但**小节头本身不参与幂等匹配**（不检测是否已有该注释行，只在本次确有新增条目时追加一次；避免重复运行在文件中堆出多个相同注释头——本次若追加了 1 条也会带注释头，需在测试里明确断言"多次运行不重复插入注释头"这一点，若做不到就直接不加注释头，仅追加纯条目行，保证幂等最简单可靠）。**决策：为降低幂等实现复杂度和测试面，注释头只在"创建新文件"场景写入；"追加到已存在文件"场景不写注释头，只追加纯条目行**，防止重复追加同一注释导致的边界复杂度

### 1.2 `plugins/spec-driver/scripts/init-project.sh` 接入点

- `source` 位置：紧邻现有 `source "${SCRIPT_DIR}/lib/init-project-output.sh"`（L48）之后追加一行 `source "${SCRIPT_DIR}/lib/ensure-gitignore.sh"`
- 新增步骤函数 `ensure_gitignore_step()`：

```bash
ensure_gitignore_step() {
  local result
  result="$(ensure_spec_driver_gitignore "$PROJECT_ROOT")" || {
    INIT_RESULTS+=("gitignore:skip_error")
    return 0
  }

  case "$result" in
    created:*)
      INIT_RESULTS+=("gitignore:created:${result#created:}")
      ;;
    appended:*)
      INIT_RESULTS+=("gitignore:injected:${result#appended:}")
      ;;
    ready:*)
      INIT_RESULTS+=("gitignore:ready")
      ;;
    *)
      INIT_RESULTS+=("gitignore:unknown")
      ;;
  esac
}
```

- 在 `run_init_checks()`（L294-304）中插入调用位置：放在 `init_specify_dir` 之后、`sync_specify_templates` 之前（先有目录结构 → 立刻补 ignore → 再落盘会被 ignore 覆盖的模板/scorecards，语义顺序自然）：

```bash
run_init_checks() {
  init_specify_dir
  ensure_gitignore_step        # 新增
  sync_specify_templates
  sync_scorecard_defaults
  ensure_project_context
  check_constitution
  check_config
  check_gate_policy
  detect_spec_driver_skills
  show_effective_config
}
```

- `plugins/spec-driver/scripts/lib/init-project-output.sh` 的 `print_init_text_result()` 新增 `gitignore` 分支（text 模式展示），`output_init_json()` 无需改动（`gitignore:*` 会随 `RESULTS` 数组自动带出）：

```bash
    gitignore)
      if [[ "$value" == ready ]]; then
        echo -e "  ✅ .gitignore 已含 Spec Driver 忽略规则"
      elif [[ "$value" == created:* ]]; then
        echo -e "  ✅ 已创建 .gitignore 并写入 Spec Driver 忽略规则"
      elif [[ "$value" == injected:* ]]; then
        local n="${value#injected:}"
        echo -e "  ✅ 已向 .gitignore 追加 ${n} 条 Spec Driver 忽略规则"
      elif [[ "$value" == skip_error ]]; then
        echo -e "  ⚠️  ${YELLOW}.gitignore 注入失败，已跳过（不影响初始化）${NC}"
      fi
      ;;
```

### 1.3 `plugins/spec-driver/scripts/postinstall.sh` 接入点

- 在 `write_plugin_path()`（L32-48）内，写入 `.spec-driver-path` 之前或之后调用共享函数，**静默执行**（SessionStart hook 场景不产出用户可见噪声，仅失败时走 stderr 警告，与现有 `write_plugin_path` 的告警风格一致）：

```bash
write_plugin_path() {
  if [[ ! -d "$PLUGIN_DIR/scripts" ]]; then
    echo "[警告] spec-driver 插件目录无效: $PLUGIN_DIR，跳过路径写入" >&2
    return 0
  fi

  mkdir -p "$PROJECT_DIR/.specify" 2>/dev/null || true

  if [[ -d "$PROJECT_DIR/.specify" ]]; then
    echo -n "$PLUGIN_DIR" > "$PROJECT_DIR/.specify/.spec-driver-path"

    # 确保 .gitignore 已就位，避免绝对路径泄漏进用户 git diff（207 fix）
    if [[ -f "$SCRIPT_DIR/lib/ensure-gitignore.sh" ]]; then
      source "$SCRIPT_DIR/lib/ensure-gitignore.sh"
      ensure_spec_driver_gitignore "$PROJECT_DIR" >/dev/null 2>&1 || true
    fi
  else
    echo "[警告] 无法创建 $PROJECT_DIR/.specify/ 目录，跳过路径写入" >&2
  fi
}
```

- 关键约束：`postinstall.sh` 顶部已 `set -euo pipefail`；调用处显式 `|| true` 吞掉任何非零退出，防止 gitignore 注入的任何异常（如极端情况下 `.gitignore` 不可写）导致整个 SessionStart hook 失败进而打断所有会话
- 不新增 `INIT_RESULTS` 或任何 stdout 信号（postinstall 没有该输出体系，且要求"静默"）

## 2. `.gitignore` 注入精确行为规格

| 场景 | 输入 | 期望行为 | 期望 stdout |
|------|------|----------|-------------|
| 全新注入 | 项目无 `.gitignore` | 创建文件，写注释头 + 4 行条目 | `created:4` |
| 幂等重跑 | `.gitignore` 已含全部 4 条（顺序任意） | 不写文件，mtime 不变 | `ready:0` |
| 部分已存在 | `.gitignore` 含其中 1-3 条 | 追加缺失条目到文件末尾，不重复已存在的 | `appended:N`（N=缺失数） |
| 无 `.gitignore`（非 git 目录） | 目录没有 `.git/` 也没有 `.gitignore` | 照常创建 `.gitignore`（不因非 git 目录跳过） | `created:4` |
| 末尾无换行边界 | 已存在的 `.gitignore` 最后一行无尾随 `\n` | 追加前先插入换行，新增条目独立成行，不与最后一行文本粘连 | `appended:N` |
| 精确匹配非误判 | `.gitignore` 已有 `.specify/runs/debug.log` 之类的宽松变体 | 不视为 `.specify/runs/` 已存在（整行不等），仍追加 `.specify/runs/` | 视具体 case 而定，按整行精确比较 |
| **[四轮] symlink（含 dangling）** | 目标文件为 symlink | 一律不写（不跟随 symlink 写外部） | `failed:0` |
| **[四轮] 含 NUL 字节** | 目标文件含 `\0` | 拒写，文件不改动 | `failed:0` |
| **[四轮] negation 尊重** | 已有 `!.specify/templates/`（或 `!...**`） | `.specify/templates/` 跳过不追加，其余照常 | `appended:N`（不含被尊重项） |
| **[四轮] 孤儿锁** | 预置残留锁目录 | 不 stale 抢占，直接跳过（反 ABA） | `skipped:0` |
| **[四轮] git_exclude 主防线** | `.git` 为目录 | 写 `.git/info/exclude`（无注释头） | `created:N`/`appended:N`/`ready:0` |
| **[四轮] git_exclude worktree/非 git** | `.git` 为文件或缺失 | 跳过（由 `.gitignore` 覆盖） | `skipped:0` |

**幂等契约的可测断言**：连续调用两次 `ensure_spec_driver_gitignore`，第二次必须返回 `ready:0` 且文件 mtime（`stat -f %m` / `stat -c %Y`）与第一次调用后一致。

## 3. 测试方案

新增 `plugins/spec-driver/tests/ensure-gitignore.test.mjs`（**node:test 风格**，spawn bash 于 `fs.mkdtempSync` 临时目录），参照现有 plugin 测试的临时目录 helper 风格（`createTempDir` / `cleanupTempDir` 模式）。

> **测试链路事实**：plugin 测试走 `node --test "plugins/spec-driver/tests/**/*.test.mjs"`（即 `npm run test:plugins`），vitest **不收** `plugins/**/*.mjs` 文件。本用例文件用 `node:test` 的 `describe/it`（非 vitest），运行/验证命令统一用 `npm run test:plugins` 或 `node --test <file>`。

用例清单：

1. **全新注入**：临时目录无 `.gitignore` → 调用 → 断言文件被创建，含 4 行条目 + 注释头，stdout 含 `created:4`
2. **幂等重跑**：对同一临时目录连续调用两次 → 断言第二次 stdout 为 `ready:0`，且文件内容与 mtime 在两次调用间不变（第一次调用后记录 mtime，验证第二次调用后 mtime 相等）
3. **部分已存在**：预先写入含 2 条目标条目 + 若干无关行的 `.gitignore` → 调用 → 断言追加了缺失的 2 条，已存在的 2 条不重复出现（`grep -c` 计数为 1），stdout 含 `appended:2`
4. **无 `.gitignore`（非 git 目录）**：临时目录不执行 `git init`，也无 `.gitignore` → 调用 → 断言仍正常创建 `.gitignore`（验证不依赖 `.git/` 存在）
5. **末尾无换行**：预写 `.gitignore` 内容为不含尾随换行的字符串（如 `printf '%s' 'node_modules/'` 无 `\n`）→ 调用 → 断言追加后原有行与新增行分行清晰（用逐行 `grep -xF` 断言每条独立成行，且原 `node_modules/` 行内容未被污染）
6. **postinstall 路径同步注入**：spawn `postinstall.sh`（设置 `CLAUDE_PROJECT_DIR` 指向临时目录，避免污染真实 `HOME/.claude/.spec-driver-installed` 标记走首次安装分支，可额外预先 touch 该 marker 规避首次安装横幅输出）→ 断言临时目录下 `.gitignore` 同步生成/更新，且 `.spec-driver-path` 文件仍正常写入（验证两者互不影响）
7. **init-project.sh 端到端**：spawn `init-project.sh --json` 于临时目录 → 解析 JSON 输出 `RESULTS` 数组 → 断言含 `gitignore:created:4` 或对应变体信号
8. **精确匹配非误判**（spec-W1）：预写含宽松变体 `.specify/runs/debug.log` 的 `.gitignore` → 调用 → 断言 `.specify/runs/` 仍被追加，stdout `appended:4`，宽松变体原行保留
9. **并发安全**（quality-CRITICAL-1）：10 个并发 spawn 调用同一临时目录 → await 全部退出 → 断言 4 条目每条 `grep -cxF` 计数恰为 1（只断言终态唯一性，不断言过程，保证不 flaky）+ 锁目录已释放
10. **CRLF 行尾**（quality-W1）：预写 CRLF 行尾的 4 条目 `.gitignore` → 调用 → 断言 stdout `ready:0` 且文件字节未被改动（mtime + 内容不变）

**测试运行方式**：`npm run test:plugins`（走 `node --test`，纳入现有 plugin 全量套件）；单文件跑 `node --test plugins/spec-driver/tests/ensure-gitignore.test.mjs`。vitest 不收 `.mjs` plugin 测试。

## 4. 发布同步

- `contracts/release-contract.yaml`：`products.spec-driver.version` `4.2.1` → `4.2.2`（patch：修复性变更，无行为破坏、无新增 API）
- `productMappingDescription` 前置追加一段摘要（中文，遵循现有版本历史累加书写风格）：

  > Spec Driver v4.2.2（Feature 207 修复）— init-project.sh / postinstall.sh 落盘脚手架与机器态文件（`.specify/templates` `.specify/scorecards` `.specify/runs` `.specify/.spec-driver-path`）新增自举式 `.gitignore` 注入（共享库 `lib/ensure-gitignore.sh`，幂等 + 非 git 目录安全 + 静默容错），修复第三方 repo 首次使用时脚手架与本机绝对路径污染 git diff / 交付 patch 的问题（SWE-bench 评测中 85 个 c3 run 100% 命中）。

- 同步命令：`npm run release:sync`（生成/同步 `plugin.json` 版本号等受控字段）
- `plugins/spec-driver/scripts/postinstall.sh` 内 `PLUGIN_VERSION="4.2.1"` 字面量需同步改为 `4.2.2`（`release:sync` 是否覆盖此文件需在执行后用 `git diff` 核实；若未覆盖需手改，避免版本号漂移）

## 5. 回归风险评估

`init-project.sh` 是**所有** skill（feature/story/implement/fix/resume/sync/doc/refactor）初始化的必经路径；`postinstall.sh` 是 **SessionStart hook**，每次新会话无条件触发，失败会打扰所有用户所有会话。这是本次改动风险最集中的两个面。

**防御要求**：

1. **`postinstall.sh` 侧**：新增调用必须以 `|| true` 收尾，任何 `.gitignore` 写入异常（权限不足、磁盘满、符号链接死循环等）都不得使 hook 以非零码退出（顶部 `set -euo pipefail` 会让未捕获的错误直接杀死整个 hook 脚本，进而可能影响 Claude Code SessionStart 事件本身的用户体验，视 Claude Code 对 hook 失败的处理策略而定，保守起见必须防御）
2. **`init-project.sh` 侧**：`ensure_gitignore_step()` 同样吞掉 `ensure_spec_driver_gitignore` 的非零返回，只记录 `gitignore:skip_error` 信号，不 `exit`；防止极端环境（如只读文件系统的 CI 沙箱）下整个初始化流程被这一步拖垮
3. **共享库内部**：`ensure-gitignore.sh` 函数体不使用会触发 `set -e` 连锁失败的裸露命令组合（如管道中间环节失败），关键写入操作显式检查返回值
4. **顺序风险**：`ensure_gitignore_step` 插入在 `init_specify_dir` 之后、`sync_specify_templates` 之前——若未来有人调整 `run_init_checks` 顺序，需注意 `.gitignore` 注入本身不依赖 `sync_specify_templates`/`sync_scorecard_defaults` 是否已跑（4 条 ignore 规则是硬编码字面量，非从模板读取），因此顺序调整风险低，但仍建议保持当前顺序以维持"先立规矩再落盘"的直觉
5. **幂等性是最大回归防线**：由于 `postinstall.sh` 每次会话都跑，若幂等判断有误（例如 `grep -qxF` 换成宽松匹配导致每次都误判为"未就位"而反复追加），会在用户 `.gitignore` 中造成重复行堆积——测试用例 2（幂等重跑）和用例 3（部分已存在）是防止此类回归的核心断言，必须严格覆盖
6. **不影响既有 `INIT_RESULTS` 消费方**：新增的 `gitignore:*` 信号是数组追加项，不改变现有信号的 key/value 格式，`output_init_json()` 无需改动，向后兼容；但如果编排器或其他脚本对 `INIT_RESULTS` 做了顺序位置假设（而非按 key 查找），需确认无此类脆弱消费方（初步判断：`init-project-output.sh` 是遍历数组逐项 `case` 匹配 key，不依赖位置，安全）

7. **通用检查项（quality-INFO）**：幂等追加类脚本（向既有文件补写规则的自举逻辑）必须验证 **CRLF 兼容**（匹配用归一化视图，避免 Windows 行尾误判为缺失而重复追加）与 **并发安全**（多进程/多会话同时触发时用原子锁保护临界区，终态每条目唯一），不能仅验证"顺序调用两次幂等"这一单线程口径。`postinstall.sh` 每次会话触发 + `init-project.sh` 所有 skill 必经，二者叠加即构成天然并发面。

**最大回归风险一句话**：`postinstall.sh` 是每次会话都跑的 SessionStart hook，若共享库的 gitignore 写入逻辑在极端文件系统状态下抛出未捕获异常，会在 `set -euo pipefail` 下杀死整个 hook 并影响所有用户的会话启动体验。

### [四轮修订] Codex 对抗审查处置后的补充回归防线

8. **postinstall 收窄的伦理正确性**：hook 只写 `.git/info/exclude`（非 tracked），实测预 track `.gitignore` 的 repo 跑 postinstall 后 `git status --porcelain` 零输出（无 `M .gitignore`）——SessionStart hook 不再静默修改用户 tracked 文件。这是本轮把 `.gitignore` 注入从 hook 收窄到 `init-project.sh`（显式初始化）的核心动机。
9. **反 ABA 并发正确性**：删除 stale 锁抢占后，实测「预置孤儿锁 + 20 并发」→ 全部 `skipped:0`、零写入；「无预置锁 + 20 并发」→ 每条目恰 1 行、锁正常释放。ABA 竞态（多进程 rmdir 互删新锁后重复注入）已根除。代价是孤儿锁永久 skip（临界区内 SIGKILL 的毫秒级窗口），经权衡接受并在 lib 注释写明。
10. **主防线覆盖验证**：实测普通 git repo 跑 `init-project.sh` 后，4 条脚手架路径 `git check-ignore` 全部命中（经 `.git/info/exclude`）；残留 untracked 仅 `.gitignore`（团队共享，语义正当）与 `.specify/project-context.yaml`（入库资产，已知边界）；`.spec-driver-path` 绝对路径泄漏彻底消除。

## 6. 验证方案

```bash
# 0. 语法检查（shell 脚本）
bash -n plugins/spec-driver/scripts/lib/ensure-gitignore.sh
bash -n plugins/spec-driver/scripts/init-project.sh

# 1. 新增测试通过（node:test，非 vitest）
node --test plugins/spec-driver/tests/ensure-gitignore.test.mjs

# 2. 全量 plugin 回归（vitest 不收 plugins/**/*.mjs，须用 test:plugins）
npm run test:plugins
# 其余 TS 单测仍走 vitest
npx vitest run

# 2a. bash 3.2 冒烟（macOS 系统 bash）
/bin/bash -c 'set -euo pipefail; source plugins/spec-driver/scripts/lib/ensure-gitignore.sh; d=$(mktemp -d); ensure_spec_driver_gitignore "$d"'

# 3. 构建
npm run build

# 4. 仓库同步一致性
npm run repo:sync
npm run repo:check

# 5. 发布字段同步
npm run release:sync
npm run release:check

# 6. 手工冒烟：在临时目录模拟第三方 repo 首次使用
tmpdir=$(mktemp -d) && cd "$tmpdir" && git init -q
bash /Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-shtern-98333e/plugins/spec-driver/scripts/init-project.sh --json | jq '.RESULTS'
# 期望：RESULTS 含 "gitignore:created:4"；.gitignore 已生成且含 4 条目
git status --porcelain
# 期望：.specify/.spec-driver-path、.specify/runs/、.specify/scorecards/、.specify/templates/ 均不出现在 untracked 列表
```

## 7. Spec 影响

无既有 spec 记载 init 脚手架行为；本次 fix 制品（plan.md + tasks.md + 实现）在下次 `/spec-driver:spec-driver-sync` 时会被聚合进 `specs/products/spec-driver/current-spec.md`，与 fix-report.md 结论一致，不额外处理。
