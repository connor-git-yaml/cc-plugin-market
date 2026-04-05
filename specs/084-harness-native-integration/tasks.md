# Feature 084 — 任务分解

## 执行顺序

依据 plan.md 推荐序：M4 -> M1 -> M2 -> M3 -> M5

---

## M4: 文档瘦身

- [ ] T-001 [P0] 提取行为约定到 docs/shared 源文件
  - 逐条梳理 CLAUDE.md 和 AGENTS.md 中手写的行为约定（约 11 条），提取到 `docs/shared/agent-behavior-rules.md`
  - 建立瘦身前行为约定清单（checklist），用于 NFR-3 逐条对比验证
  - **原子性**：新建 `docs/shared/agent-behavior-rules.md` + 行为约定清单写入 commit message 或 PR 描述
  - **依赖**：无前置依赖
  - **验证**：`cat docs/shared/agent-behavior-rules.md | wc -l` 确认文件存在且内容非空；`npm run repo:check`

- [ ] T-002 [P0] 升级 sync-agent-docs 脚本支持 behavior-rules 同步
  - 在 `scripts/sync-agent-docs.mjs` 的 `sectionConfigs` 中新增 `behavior-rules` 条目，指向 `docs/shared/agent-behavior-rules.md`
  - 确保同步区块标记格式与现有条目一致
  - **依赖**：T-001
  - **验证**：`node scripts/sync-agent-docs.mjs && git diff --exit-code CLAUDE.md AGENTS.md`（幂等性：第二次执行无变更）；`npm run repo:check`

- [ ] T-003 [P0] 瘦身 CLAUDE.md：删除 auto-generated 区块 + 插入同步引用
  - 删除 Active Technologies、Project Structure、Recent Changes 等自动生成区块
  - 保留平台专属配置 + 共享同步区块引用（含新增的 behavior-rules 区块）
  - 瘦身后 <=100 行
  - **原子性**：CLAUDE.md 编辑 + `npm run docs:sync:agents` 执行确保同步区块正确
  - **依赖**：T-002
  - **验证**：`wc -l CLAUDE.md`（<=100）；`npm run docs:sync:agents && git diff --exit-code`（幂等）；`npm run repo:check`

- [ ] T-004 [P0] 瘦身 AGENTS.md：删除 auto-generated 区块 + 插入同步引用
  - 删除 auto-generated 技术清单区块
  - 保留 Codex 专属配置 + 共享同步区块引用（含 behavior-rules 区块）
  - 瘦身后 <=100 行
  - **原子性**：AGENTS.md 编辑 + `npm run docs:sync:agents` 执行确保同步区块正确
  - **依赖**：T-002
  - **验证**：`wc -l AGENTS.md`（<=100）；`npm run docs:sync:agents && git diff --exit-code`（幂等）；`npm run repo:check`

- [ ] T-005 [P0] NFR-3 瘦身零遗漏验证
  - 对比 T-001 建立的行为约定清单，逐条确认每条规则在瘦身后的 CLAUDE.md 或 AGENTS.md 中（通过同步区块或平台专属段落）仍可找到
  - 输出逐条对比表（可作为 commit message 附录或临时文件）
  - **依赖**：T-003, T-004
  - **验证**：逐条 diff 表中无遗漏项；`npm run repo:check`

---

## M1: Hooks 扩展

- [ ] T-006 [P0] 新增 PreToolUse Hook 脚本 + hooks.json 注册
  - 创建 `plugins/spec-driver/hooks/pre-tool-use-guard.sh`：检测活跃工作流（`specs/*/tasks.md` 含未完成任务）且目标路径在 `src/` 下时 exit 2 阻断；无活跃工作流时 exit 0
  - 在 `hooks.json` 新增 PreToolUse 条目，matcher 为 `Edit|Write`
  - **原子性**：脚本文件 + hooks.json 修改在同一任务
  - **依赖**：无前置依赖（可与 M4 并行，但建议在 T-005 之后顺序执行）
  - **验证**：`bash plugins/spec-driver/hooks/pre-tool-use-guard.sh` 在无 tasks.md 时 exit 0；`cat plugins/spec-driver/hooks/hooks.json | python3 -m json.tool`（JSON 语法合法）；`npm run repo:check`

- [ ] T-007 [P1] 新增 PostToolUse Hook 脚本 + hooks.json 注册
  - 创建 `plugins/spec-driver/hooks/post-tool-use-format.sh`：对 JS/TS 文件执行 `npx prettier --write`，非 JS/TS 文件静默 exit 0
  - 在 `hooks.json` 新增 PostToolUse 条目，matcher 为 `Edit|Write`
  - **原子性**：脚本文件 + hooks.json 修改在同一任务
  - **依赖**：T-006（hooks.json 连续修改，避免冲突）
  - **验证**：`bash plugins/spec-driver/hooks/post-tool-use-format.sh` 无参数时 exit 0；JSON 语法合法；`npm run repo:check`

- [ ] T-008 [P1] 新增 Stop Hook 脚本 + hooks.json 注册
  - 创建 `plugins/spec-driver/hooks/stop-task-check.sh`：读取当前 feature 的 tasks.md，检查未完成任务并输出提醒（非阻断，exit 0）
  - 在 `hooks.json` 新增 Stop 条目（prompt 类型）
  - **原子性**：脚本文件 + hooks.json 修改在同一任务
  - **依赖**：T-007（hooks.json 连续修改）
  - **验证**：`bash plugins/spec-driver/hooks/stop-task-check.sh` 无 tasks.md 时 exit 0；JSON 语法合法；`npm run repo:check`

- [ ] T-009 [P1] 新增 Worktree 生命周期 Hook 脚本 + hooks.json 注册
  - 创建 `plugins/spec-driver/hooks/worktree-lifecycle.sh`：create 模式复制 `specs/{current-feature}/` 到 worktree；remove 模式检查未提交变更并警告
  - 在 `hooks.json` 新增 WorktreeCreate 和 WorktreeRemove 条目
  - **原子性**：脚本文件 + hooks.json 修改在同一任务
  - **依赖**：T-008（hooks.json 连续修改）
  - **验证**：`bash plugins/spec-driver/hooks/worktree-lifecycle.sh` 无参数时 exit 0；hooks.json 包含 6 条 Hook 定义（SessionStart + 5 新增类）；`npm run repo:check`

- [ ] T-010 [P0] NFR-1 / NFR-5 Hook 健壮性验证
  - 验证所有 4 个新增 Hook 脚本在无 `specs/*/tasks.md` 时均 exit 0
  - 验证 PreToolUse Hook 执行时间 <200ms（`time bash pre-tool-use-guard.sh`）
  - **依赖**：T-006 ~ T-009
  - **验证**：逐一执行 4 个脚本确认 exit code 为 0；`npm run repo:check`

---

## M2: `.claude/rules/` 路径规则

- [ ] T-011 [P1] 创建 docs/shared 规则源文件（3 个）
  - 新建 `docs/shared/agent-rules-tests.md`：测试规范（命名、覆盖率、mock 策略）
  - 新建 `docs/shared/agent-rules-specs.md`：spec 写作规范（格式、术语、模板引用）
  - 新建 `docs/shared/agent-rules-plugins.md`：插件开发规范（目录结构、SKILL.md 格式、版本约定）
  - 每个文件 <20 行
  - **依赖**：T-005（文档瘦身完成后，避免同步冲突）
  - **验证**：`ls docs/shared/agent-rules-*.md | wc -l`（3 个文件）；`npm run repo:check`

- [ ] T-012 [P1] 创建 .claude/rules/ 路径规则文件（3 个）+ 同步脚本更新
  - 新建 `.claude/rules/tests.md`（匹配 `tests/**`）、`rules/specs.md`（匹配 `specs/**`）、`rules/plugins.md`（匹配 `plugins/**`）
  - 每个 rules 文件内容从对应 `docs/shared/agent-rules-*.md` 提取
  - 在 `sync-agent-docs.mjs` 的 `sectionConfigs` 中新增 3 个 rules 对应条目，确保 Codex 降级路径也能在 AGENTS.md 中看到规则
  - **原子性**：3 个 rules 文件 + sync 脚本更新 + AGENTS.md 同步区块标记插入必须在同一任务
  - **依赖**：T-011, T-002
  - **验证**：`ls .claude/rules/*.md | wc -l`（3 个文件）；`npm run docs:sync:agents && git diff --exit-code`（幂等）；`npm run repo:check`

---

## M3: Agent Frontmatter

- [ ] T-013 [P1] 为 14 个 Agent .md 添加 YAML frontmatter
  - implement.md、plan.md 设为 `effort: high`
  - clarify.md、checklist.md 设为 `effort: low`
  - 其余 10 个（analyze.md、constitution.md、product-research.md、quality-review.md、spec-review.md、specify.md、sync.md、tasks.md、tech-research.md、verify.md）设为 `effort: medium`
  - 所有 agent 的 `model` 默认 `sonnet`，`tools` 按角色最小化配置
  - frontmatter 不含 hooks / mcpServers / permissionMode
  - **依赖**：T-012（规则就绪后补齐）
  - **验证**：`for f in plugins/spec-driver/agents/*.md; do head -1 "$f"; done`（全部以 `---` 开头）；验证 14 个文件均包含 model + tools + effort 字段；`npm run repo:check`

---

## M5: CI/CD 集成

- [ ] T-014 [P2] 新增 claude-code-action 审查 workflow
  - 创建 `.github/workflows/claude-review.yml`
  - 配置 `on: pull_request`，使用 `anthropics/claude-code-action@v1`
  - 传入 `secrets.ANTHROPIC_API_KEY`，执行 `repo:check`
  - advisory 模式：结果以 PR comment 输出，不阻断 merge
  - **依赖**：T-010, T-012, T-013（其他模块稳定后再接入）
  - **验证**：`python3 -c "import yaml; yaml.safe_load(open('.github/workflows/claude-review.yml'))"`（YAML 语法合法）；`npm run repo:check`

---

## 最终验收

- [ ] T-015 [P0] 全量验收检查
  - hooks.json 包含 SessionStart / PreToolUse / PostToolUse / Stop / WorktreeCreate / WorktreeRemove 共 5 类（6 条）Hook
  - `.claude/rules/` 下 3 个路径规则文件，每个在 `docs/shared/` 有等价源
  - 14 个 Agent .md 均包含合法 YAML frontmatter
  - CLAUDE.md <=100 行，AGENTS.md <=100 行
  - 瘦身前后行为约定零遗漏（NFR-3）
  - `npm run docs:sync:agents` 幂等执行无变更（NFR-4）
  - 所有 Hook 脚本无 tasks.md 时 exit 0（NFR-1）
  - `.github/workflows/claude-review.yml` 语法合法
  - **依赖**：T-005, T-010, T-012, T-013, T-014
  - **验证**：`npm run repo:check`；逐项核对 spec.md 验收标准 1~9

---

## Architecture Guard

- [ ] AG-001 不引入 TypeScript 运行时代码 — 本 Feature 全部变更限于配置文件（JSON/YAML）、Markdown 和 Bash 脚本，不新增或修改 `src/` 下任何 TypeScript 源码
- [ ] AG-002 hooks 脚本不包含编排决策逻辑 — Hook 脚本仅执行门禁检查（PreToolUse）、格式化（PostToolUse）、完整性提醒（Stop）、生命周期操作（Worktree），不包含 spec-driver 编排流程的业务决策
- [ ] AG-003 瘦身后行为约定零遗漏 — CLAUDE.md / AGENTS.md 瘦身前后逐条对比，所有行为规则在 `docs/shared/` 源文件或平台专属段落中完整保留，无任何规则丢失
