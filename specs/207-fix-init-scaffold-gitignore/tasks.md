---
description: "Task list for fix 207 — init 脚手架污染用户 repo git diff + .spec-driver-path 绝对路径泄漏"
---

# Tasks: 207-fix-init-scaffold-gitignore

**Input**: `specs/207-fix-init-scaffold-gitignore/plan.md`（技术依据）、`specs/207-fix-init-scaffold-gitignore/fix-report.md`（根因诊断）
**模式**: fix（精简任务清单，不按 User Story 组织，按变更依赖顺序排列）

## Format: `[ID] [P?] Description`

- **[P]**: 可并行（不同文件、无依赖）
- 每个任务描述含确切文件路径与验收标准

---

## Phase 1: 核心修复（共享库）

- [x] T001 新建 `plugins/spec-driver/scripts/lib/ensure-gitignore.sh`，实现 `ensure_spec_driver_gitignore <project_root>` 函数
  - 依据 plan.md §1.1 完整行为契约：4 条固定 ignore 条目（`.specify/.spec-driver-path`、`.specify/runs/`、`.specify/scorecards/`、`.specify/templates/`）
  - 精确整行匹配（`grep -qxF -- "$entry" "$gitignore_file"`）
  - 新建文件场景带注释头；追加场景不带注释头（幂等最简实现）
  - 追加前处理末尾无换行边界（先补 `\n` 再追加）
  - 非 git 目录也正常写入
  - 不使用裸露 `set -e` 连锁失败写法，函数内部用 `return` 传状态，始终返回 0（仅 `project_root` 为空或非目录时返回 1）
  - stdout 输出 `created:N` / `appended:N` / `ready:0` 三态之一
  - 赋予可执行权限 `chmod 755`
  - **验收标准**：文件存在、`bash -n` 语法检查通过、`chmod +x` 后可执行、手工 source 后调用 `ensure_spec_driver_gitignore <tmpdir>` 能正确输出 `created:4`

---

## Phase 2: 接入点（依赖 T001）

- [x] T002 `plugins/spec-driver/scripts/init-project.sh` 接入 `ensure-gitignore.sh`（依赖 T001）
  - 在 L48 附近 `source "${SCRIPT_DIR}/lib/init-project-output.sh"` 之后追加 `source "${SCRIPT_DIR}/lib/ensure-gitignore.sh"`
  - 新增 `ensure_gitignore_step()` 函数（按 plan.md §1.2 代码块，含 `INIT_RESULTS+=("gitignore:created:N"/"gitignore:injected:N"/"gitignore:ready"/"gitignore:unknown")` 分支及 `skip_error` 兜底）
  - 在 `run_init_checks()` 中插入调用位置：`init_specify_dir` 之后、`sync_specify_templates` 之前
  - **验收标准**：`bash -n init-project.sh` 语法通过；`run_init_checks` 函数体确认调用顺序为 `init_specify_dir → ensure_gitignore_step → sync_specify_templates → ...`

- [x] T003 [P] `plugins/spec-driver/scripts/lib/init-project-output.sh` 的 `print_init_text_result()` 新增 `gitignore` 分支（依赖 T001，与 T002 可并行——不同文件）
  - 按 plan.md §1.2 代码块新增 `gitignore)` case：`ready` / `created:*` / `injected:*` / `skip_error` 四态文本展示
  - `output_init_json()` 无需改动（`RESULTS` 数组自动带出）
  - **验收标准**：`bash -n init-project-output.sh` 语法通过；text 模式手工调用 `print_init_text_result "gitignore:created:4"` 能输出对应中文提示行

- [x] T004 `plugins/spec-driver/scripts/postinstall.sh` 静默接入 `ensure-gitignore.sh`（依赖 T001）
  - 在 `write_plugin_path()` 内，写入 `.spec-driver-path` 之后调用 `ensure_spec_driver_gitignore "$PROJECT_DIR"`
  - 判断 `lib/ensure-gitignore.sh` 存在再 `source`，调用处显式 `>/dev/null 2>&1 || true` 吞掉任何异常（防御 `set -euo pipefail` 顶部设置下的连锁失败）
  - 不新增任何 stdout 信号（postinstall 无 `INIT_RESULTS` 输出体系，须保持静默）
  - **验收标准**：`bash -n postinstall.sh` 语法通过；`grep -n "|| true"` 能定位到本次新增调用行；手工在临时目录 `CLAUDE_PROJECT_DIR=<tmpdir> bash postinstall.sh` 不产生非零退出码（`echo $?` 为 0）

**Checkpoint**：Phase 1-2 完成后，两个调用方均已具备 gitignore 自举能力，可进入测试编写阶段

---

## Phase 3: 自动化测试（依赖 T001-T004）

- [x] T005 新建 `plugins/spec-driver/tests/ensure-gitignore.test.mjs`（**node:test 风格**，spawn bash 于 `fs.mkdtempSync` 临时目录）
  - **测试链路事实**：plugin 测试走 `node --test "plugins/spec-driver/tests/**/*.test.mjs"`（`npm run test:plugins`），**vitest 不收** `plugins/**/*.mjs`。故用例文件用 `node:test` 的 `describe/it`，验证命令用 `npm run test:plugins` 或 `node --test <file>`
  - 依据 plan.md §3 完整覆盖 10 个用例（原 7 + 二轮新增 3）：
    1. 全新注入：无 `.gitignore` → 创建含 4 行条目 + 注释头，stdout 含 `created:4`
    2. 幂等重跑：连续调用两次 → 第二次 stdout 为 `ready:0`，文件 mtime 两次调用间保持不变
    3. 部分已存在：预写 2 条目标条目 + 无关行 → 追加缺失 2 条，已存在条目不重复（`grep -c` 计数为 1），stdout 含 `appended:2`
    4. 无 `.gitignore`（非 git 目录）：不执行 `git init` 也无 `.gitignore` → 仍正常创建，验证不依赖 `.git/` 存在
    5. 末尾无换行：预写不含尾随换行的 `.gitignore` 内容 → 追加后原行与新行分行清晰，原内容未被污染
    6. postinstall 路径同步注入：spawn `postinstall.sh`（设置 `CLAUDE_PROJECT_DIR` 指向临时目录，预先 touch `${HOME}/.claude/.spec-driver-installed` 规避首次安装横幅分支）→ 断言 `.gitignore` 同步生成/更新且 `.spec-driver-path` 仍正常写入
    7. init-project.sh 端到端：spawn `init-project.sh --json` 于临时目录 → 解析 JSON `RESULTS` 数组 → 断言含 `gitignore:created:4` 或对应变体信号
    8. 精确匹配非误判（spec-W1）：预写宽松变体 `.specify/runs/debug.log` → `.specify/runs/` 仍追加，stdout `appended:4`
    9. 并发安全（quality-CRITICAL-1）：10 并发 spawn 同目录 → await 全退出 → 每条目 `grep -cxF` 恰 1（断终态，不 flaky）+ 锁已释放
    10. CRLF 行尾（quality-W1）：预写 CRLF 4 条目 → stdout `ready:0` 且文件字节不变
  - **验收标准**：`npm run test:plugins`（或 `node --test plugins/spec-driver/tests/ensure-gitignore.test.mjs`）10 用例全绿

---

## Phase 4: 发布同步（依赖 T001-T004 实现落地，可与 T005 并行——不同关注面）

- [x] T006 [P] `contracts/release-contract.yaml` 版本 bump：`products.spec-driver.version` `4.2.1` → `4.2.2`
  - `productMappingDescription` 前置追加 plan.md §4 给定的摘要段落（中文，遵循现有版本历史累加书写风格）
  - **验收标准**：`yaml` 语法有效（可用 `node -e "require('yaml').parse(require('fs').readFileSync('contracts/release-contract.yaml','utf8'))"` 或等效校验）；`version` 字段确认为 `4.2.2`

- [x] T007 执行 `npm run release:sync`，同步受控字段（依赖 T006）
  - 观察是否覆盖 `plugins/spec-driver/scripts/postinstall.sh` 内 `PLUGIN_VERSION="4.2.1"` 字面量
  - **验收标准**：`git diff` 核实 `postinstall.sh` 的 `PLUGIN_VERSION` 是否已同步为 `4.2.2`；若未覆盖，手改该行为 `PLUGIN_VERSION="4.2.2"`

---

## Phase 5: 全量验证与收尾（依赖 Phase 1-4 全部完成）

- [x] T008 全量验证命令清单（依赖 T001-T007）：
  ```bash
  # 0. shell 语法检查
  bash -n plugins/spec-driver/scripts/lib/ensure-gitignore.sh
  bash -n plugins/spec-driver/scripts/init-project.sh

  # 1. 新增测试通过（node:test，vitest 不收 .mjs）
  node --test plugins/spec-driver/tests/ensure-gitignore.test.mjs

  # 2. 全量 plugin 回归 + TS 单测
  npm run test:plugins
  npx vitest run

  # 2a. bash 3.2 冒烟（macOS 系统 bash）
  /bin/bash -c 'set -euo pipefail; source plugins/spec-driver/scripts/lib/ensure-gitignore.sh; d=$(mktemp -d); ensure_spec_driver_gitignore "$d"'

  # 3. 构建
  npm run build

  # 4. 仓库同步一致性
  npm run repo:sync
  npm run repo:check

  # 5. 发布字段同步与校验
  npm run release:sync
  npm run release:check

  # 6. 手工冒烟：模拟第三方 repo 首次使用
  tmpdir=$(mktemp -d) && cd "$tmpdir" && git init -q
  bash <worktree_root>/plugins/spec-driver/scripts/init-project.sh --json | jq '.RESULTS'
  # 期望：RESULTS 含 "gitignore:created:4"
  git status --porcelain
  # 期望：.specify/.spec-driver-path、.specify/runs/、.specify/scorecards/、.specify/templates/
  #       均不出现在 untracked 列表
  ```
  - **验收标准**：以上全部命令零失败退出码；手工冒烟的 `git status --porcelain` 不含四条目标路径

---

---

## Phase 6: Codex 四轮对抗审查修复（提交前审查处置，5 项实测复现）

- [x] T009 处置 Codex 对抗审查发现（依赖 T001-T008）：
  - **C1 symlink 防御**：`_spec_driver_inject_entries` 内 `-L` 检测先于 `-f` 分支，symlink（含 dangling）一律 `failed:0` 不跟随写外部
  - **C2 分层防线**：新增 `ensure_spec_driver_git_exclude` 写 `.git/info/exclude`（主防线，非 tracked 零 diff）；抽公共 helper `_spec_driver_inject_entries`；init 先 exclude 后 gitignore（各自独立锁，无死锁）；`git_exclude:*` 信号 + init-project-output.sh 补 case；postinstall 收窄为**只调 exclude**
  - **W1 删 stale 抢占**：删除 `_spec_driver_gitignore_mtime`/`SPEC_DRIVER_GITIGNORE_LOCK_STALE_SECS`/mtime 重试整段，抢锁失败一律 `skipped:0`（根除 ABA），lib 注释写明取舍
  - **W2 negation 检测**：`!<entry>` / `!<entry>*` 前缀命中则跳过不追加
  - **W3 NUL 防御**：含 NUL 文件 `failed:0` 不改动
  - 测试同步：18 用例（原 11 保留，用例 6 改断 exclude 生成 + .gitignore 不动，新增 symlink/negation/NUL/exclude 注入+幂等/exclude 非 git skipped/init 双信号/孤儿锁 skipped）
  - 制品修订：plan.md §1.1/§2/§5 + fix-report.md 修复策略/已知边界；contract productMappingDescription 加 exclude 主防线一笔（`release:sync` 已跑）
  - **验收标准**：`node --test ensure-gitignore.test.mjs` 18/18 绿；`npm run test:plugins` 307/307；`npx vitest run` 5067 pass；冒烟 A（git repo→双信号+4 路径 check-ignore 命中）/ B（预 track gitignore + postinstall→零 M .gitignore）/ C（非 git→gitignore:created:4 + git_exclude:skipped）全过；ABA 复现（孤儿锁+20 并发）全 skipped 零写入；`build`/`release:check`/`repo:check` 零失败

---

## 依赖关系图

```
T001（共享库）
  ├─→ T002（init-project.sh 接入，含 run_init_checks 顺序）
  ├─→ T003（init-project-output.sh text 分支，与 T002 并行）
  └─→ T004（postinstall.sh 静默接入）
       │
T001-T004 ─→ T005（vitest 7 用例）
T001-T004 ─→ T006 ─→ T007（发布同步，与 T005 并行）
       │
T005 + T007 ─→ T008（全量验证收尾）
```

## FR 覆盖映射（对齐 plan.md 变更清单）

| 变更点（plan.md 出处） | 对应 Task |
|---|---|
| §1.1 新建 `lib/ensure-gitignore.sh` | T001 |
| §1.2 `init-project.sh` 接入 + `run_init_checks` 顺序 | T002 |
| §1.2 `init-project-output.sh` text 分支 | T003 |
| §1.3 `postinstall.sh` 静默接入（`|| true` 防御） | T004 |
| §3 测试方案（7 用例） | T005 |
| §4 `release-contract.yaml` 版本 bump + `productMappingDescription` | T006 |
| §4 `release:sync` + `postinstall.sh` `PLUGIN_VERSION` 字面量核对 | T007 |
| §6 验证方案（vitest / build / repo:sync+check / release:sync+check / 手工冒烟） | T008 |

## 范围边界（不生成的任务）

- 不改动 `scripts/eval-*.mjs`（评测 harness 红线，见 fix-report.md 约束）
- 不做 `.spec-driver-path` 移出工作树的架构级迁移（plan.md 方案 B，留作后续 feature）
- 不处理 `.specify/project-context.yaml` 与 `specs/NNN-*/` 制品的 ignore（plan.md「已知边界」明确排除）
