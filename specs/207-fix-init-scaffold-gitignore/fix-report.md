# 问题修复报告 — spec-driver init 脚手架污染用户 repo git diff + 绝对路径泄漏

## 问题描述

F206 GStack 拆解（H4）发现：spec-driver 在用户 repo 工作树落盘的 `.specify/` 脚手架（templates / scorecards / runs / project-context，均值 523 行/run）与 `.specify/.spec-driver-path`（内含本机绝对路径，如 `/Users/connorlu/...`）全部进入用户的 git diff / 交付 patch。SWE-bench 评测中 85 个 c3 run 的 patch 100% 被污染；极端案例 SWE-V008-sympy-contains r4 的 patch **唯一内容**就是泄漏绝对路径的脚手架文件（零修复内容）。

**约束**：不动 `scripts/eval-*.mjs`（评测 harness 红线），只改 spec-driver 产品侧。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 脚手架为何进了交付 patch？ | patch 由 `git diff` 生成；`.specify/` 下新落盘文件在用户 repo 中全部未被 ignore，作为 untracked/新增文件进入 diff |
| Why 2 | 为何未被 ignore？ | `init-project.sh` / `postinstall.sh` 落盘时只创建文件，从不注入任何 `.gitignore` 条目；第三方 repo 天然没有 `.specify` 相关 ignore 规则 |
| Why 3 | 脚本为何从不注入？ | 脚手架机制在开发仓库内设计，开发仓库 `.gitignore` 早已手工含这些条目（52-58 行），开发者视角"ignore 已就位"，未意识到这是**仓库私有配置**而非**产品自带能力** |
| Why 4 | 该假设为何在用户 repo 不成立？ | 插件分发模型是"任意第三方 repo 首次触发即落脚手架"，第三方 repo 不可能预先有 spec-driver 的 ignore 约定；且 `postinstall.sh` 作为 SessionStart hook **每次会话**都写 `.spec-driver-path`（绝对路径），比 init 更早、无条件触发 |
| Why 5 | 为何未被现有机制捕获？ | (a) `init-project.sh` / `postinstall.sh` 零自动化测试（tests/ 下 7 个 vitest 文件均不覆盖）；(b) dogfooding 全部在开发仓库进行，ignore 已就位 → 污染在开发者视野中不可见；(c) SWE-bench oracle 只测 FAIL_TO_PASS，不检查 patch 清洁度，直到 F206 GStack 人工拆解才暴露 |

**Root Cause**: `init-project.sh` / `postinstall.sh` 把"宿主 repo 已配好 `.specify` ignore 规则"当作隐式前提（该前提只在开发仓库为真），落盘脚手架与机器态文件时缺失 `.gitignore` 自举，导致所有第三方 repo 的 git diff 被脚手架与本机绝对路径污染。

**Root Cause Chain**: patch 污染/绝对路径泄漏 → `.specify/` 落盘文件未被 ignore → 落盘脚本无 gitignore 注入 → "ignore 已就位"的开发仓库隐式假设 → 分发到第三方 repo 后假设失效 → 初始化脚本零测试 + dogfooding 环境掩蔽 + 评测 oracle 不查 patch 清洁度。`[ROOT CAUSE REACHED at Why 3-4]`

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `plugins/spec-driver/scripts/init-project.sh` | `init_specify_dir`/`sync_specify_templates`/`sync_scorecard_defaults` (L77-158) | 落盘 templates(11 个)+scorecards+runs 目录，无 ignore 注入 | 新增幂等 `ensure_gitignore_entries()` 步骤，注入 4 条 ignore |
| `plugins/spec-driver/scripts/postinstall.sh` | `write_plugin_path` (L32-48) | 每次 SessionStart 写含绝对路径的 `.spec-driver-path`，无 ignore 注入 | 复用同一共享逻辑，写路径文件时同步确保 ignore 就位（postinstall 先于 init 触发，不能只修 init） |

### 类似模式（需评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| `plugins/spec-driver/scripts/record-workflow-run.mjs` | L150-151 | 写 `.specify/runs/*.json` | **安全**（被 `.specify/runs/` ignore 条目覆盖，无需改代码） |
| `plugins/spec-driver/scripts/goal-loop-cli.mjs` 等 | — | 读 `.specify/` 为主 | **安全**（不落新文件） |
| `ensure_project_context` (init-project.sh L160-188) | — | 复制 project-context.yaml 到用户 repo | **不 ignore**（产品定位为入库资产，团队共享；本仓库自身即入库。残余 diff 见"已知边界"） |

### 同步更新清单

- 调用方：`postinstall.sh`（source 共享 lib）；`init-project.sh` 的 `run_init_checks` 增加一步
- 测试：新增 vitest 测试（spawn bash 于临时目录验证：全新 repo 注入 / 幂等重跑 / 部分条目已存在 / 无 .gitignore 文件时创建）
- 文档：`plugins/spec-driver/README.md` 若有 `.specify` 结构说明则补 ignore 行为一句
- 发布：`contracts/release-contract.yaml` spec-driver 4.2.1 → 4.2.2（patch），跑 `npm run release:sync`

## 修复策略

### 方案 A（推荐）：落盘脚本同步注入 .gitignore 条目（自举式）

新增共享 bash 库 `plugins/spec-driver/scripts/lib/ensure-gitignore.sh`，由 `init-project.sh` 与 `postinstall.sh` 共同 source。行为：

- 注入 4 条（与开发仓库 `.gitignore` 52-58 行验证过的模式一致）：
  - `.specify/.spec-driver-path`（机器绝对路径 → 隐私/可移植，F193 同思路）
  - `.specify/runs/`（本地运行态）
  - `.specify/scorecards/`（插件默认品复制，可再生）
  - `.specify/templates/`（插件默认品复制，可再生）
- **幂等**：逐条精确行匹配，已存在则跳过；全部就位则不触碰文件（mtime 不变）
- `.gitignore` 不存在则创建（带注释头标明 Spec Driver 管理段）
- 非 git 目录也照常写（无害 + 后续 `git init` 即生效）
- `init-project.sh` 的 `INIT_RESULTS` 增加 `gitignore:injected:N` / `gitignore:ready` 信号；`postinstall.sh` 静默执行（hook 场景不产出噪声）

**效果**：patch 污染从均值 523 行 → 仅 `.gitignore` 4 行追加（且该 4 行是任何使用 spec-driver 的 repo 本就该有的正确配置，语义合理）；绝对路径彻底退出 diff/patch。

#### 方案 A 增强（Codex 四轮对抗审查处置）

Codex 提交前实测暴露：用户 repo 的 `.gitignore` 几乎都被 track，注入 4 行产生 `M .gitignore` 仍进 patch。故追加 **主防线 `.git/info/exclude`**（Git 原生非 tracked 项目级 ignore，写它零 diff 污染）：

- 新增入口 `ensure_spec_driver_git_exclude`（仅 `.git` 为目录时执行；worktree/submodule 的 `.git` 为文件 → skip，由 `.gitignore` 覆盖；非 git repo → skip）。
- `.gitignore` 降为兜底防线（覆盖 worktree/非 git 场景 + 团队共享）。
- **postinstall（SessionStart hook）只写 exclude**，不再改用户 tracked 的 `.gitignore`（伦理面：hook 不应静默改 tracked 文件）；非 git repo 时 exclude 自然 skip，hook 零动作零痕迹。
- 内部实现抽公共 helper `_spec_driver_inject_entries`，两入口薄壳共享；新增 symlink（含 dangling）/NUL/negation 三重防御；删除 stale 锁抢占改为「抢锁失败一律 skip」根除 ABA 竞态。

**增强后效果**：本机 diff（含 SWE-bench patch 场景）零 `.specify` 脚手架残留 + postinstall 零 tracked 文件改动。实测普通 git repo `init` 后 4 条脚手架路径全部 `git check-ignore` 命中；预 track `.gitignore` 的 repo 跑 postinstall 后 `git status` 零输出。

### 方案 B（备选）：把 .spec-driver-path 移出 repo 工作树（如 `~/.spec-driver/state/<project-hash>/`）

彻底消除落盘，但属架构级改动：7 个 SKILL.md + README 的路径发现 bash 片段全部要改成 hash 索引方案，纯 prompt 环境下复杂度显著上升，且有"repo 被 rsync 到别机后 state 失联"等新边界。不符合 fix 最小化原则，留作后续 feature 评估（可与方案 A 叠加，非互斥）。

## 已知边界（残余 diff，非本 fix 范围）

1. `.specify/project-context.yaml`（若 init 自动创建，~模板体量）：产品定位为入库资产，不 ignore。
2. `specs/NNN-*/` 流程制品（fix-report/plan/tasks）：spec-driven 的核心产出，产品哲学即入库；SWE-bench patch 是否该含它属评测收集策略问题，不在产品侧处理（评测 harness 是红线不动）。
3. 已被用户 commit 的存量污染文件：`.gitignore` 对已 track 文件无效，需要用户自行 `git rm --cached`（破坏性操作，脚本不自动做）。
4. **[四轮] init 场景 `.gitignore` 4 行残余**：`init-project.sh`（显式初始化）仍写 `.gitignore`（团队共享配置），会产生 4 行追加的正当残余（语义正当，非污染）；主防线 `.git/info/exclude` 保证脚手架文件本身零 diff。
5. **[四轮] worktree/submodule（`.git` 为文件）exclude 跳过**：不解析 `.git` 指针文件的 gitdir（解析复杂 + exclude 共享主仓库），该场景由 `.gitignore` 路径覆盖，留作已知边界。
6. **[四轮] 孤儿锁永久 skip**：进程在临界区内被 SIGKILL 会残留孤儿锁，使该 repo 后续注入永久 skip（无自愈）；这是删除 stale 抢占（换取根除 ABA 重复写入）的已接受代价，临界区为毫秒级窗口、命中概率极低、只造成静默跳过（主流程零影响）。
7. **[五轮] 非 git 目录场景 `.spec-driver-path` 无 ignore 保护**：`postinstall.sh`（SessionStart hook）在非 git 目录仍会落盘 `.specify/.spec-driver-path`（路径发现机制本职，7 个 SKILL 依赖），但非 git 场景无 `.git` 目录 → exclude 注入 skip，`.gitignore` 又不由 hook 写 → 该文件此刻无 ignore 保护。实际暴露窗口极窄 = 用户后来 `git init` 且从未跑过任何 spec-driver 流程；一旦跑 `init-project`（或任何显式初始化）即被 `.gitignore` 注入的 `.specify/.spec-driver-path` 条目覆盖，绝对路径不会进 diff。非 git 场景本身无 git diff 概念，无污染面。

## Spec 影响

- 需要更新的 spec：无既有 spec 记载 init 脚手架行为（`specs/products/spec-driver/current-spec.md` 由 sync 流程聚合，本次 fix 制品会在下次 sync 时进入）。
