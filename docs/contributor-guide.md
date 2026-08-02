# Contributor Guide — cc-plugin-market

本指南帮助新贡献者理解"改 X 文件需要做什么"。

## 改动场景速查

| 我要改… | 步骤 |
|---------|------|
| Agent prompt (`agents/*.md`) | 直接编辑 → `npm run repo:check` → 提交 |
| SKILL.md (`skills/*/SKILL.md`) | 直接编辑 → 测试对应模式 → `npm run repo:check` → 提交 |
| 共享规则 (`docs/shared/*.md`) | 编辑源文件 → `npm run docs:sync:agents` → 确认 CLAUDE.md/AGENTS.md 同步 → 提交 |
| 合同 (`contracts/*.yaml`) | 编辑 contract → `npm run release:sync` → `npm run release:check` → 提交 |
| 插件版本号 | 编辑 `contracts/release-contract.yaml` → `npm run release:sync` → 提交 |
| TypeScript 源码 (`src/`) | 编辑 → `npm run lint` → `npm run build` → `npm test` → 提交 |
| Codex wrapper (`codex-skills.sh`) | 编辑 `plugins/spec-driver/scripts/codex-skills.sh` → `npm run codex:spec-driver:install` → 提交 |
| `.claude/rules/*.md` | 直接编辑（Claude Code 增强，Codex 不受影响）→ 提交 |
| hooks.json | 编辑 `plugins/spec-driver/hooks/hooks.json` → 测试 Hook 脚本 → 提交 |

## 提交前检查清单

1. `npm run repo:check` — 全量校验（release contract、shared sections、wrapper sync 等）
2. `npm run repo:sync` — 如果改了 source-of-truth 文件
3. `git rebase master` — 开发分支必须 rebase 到最新 master

## 目录分类

| 目录 | 分类 | 编辑策略 |
|------|------|---------|
| `plugins/**` | canonical source | 直接编辑，commit 后触发 sync |
| `src/**` | canonical source | 直接编辑 |
| `.codex/**` | generated distribution | 不直接手改，通过安装脚本再生成 |
| `.claude/commands/**` | project override | 可编辑，优先级高于插件默认 |
| `.claude/rules/**` | Claude Code enhancement | 直接编辑（Codex 不受影响） |
| `docs/shared/**` | cross-platform source | 编辑后运行 `docs:sync:agents` |
| `contracts/**` | release metadata source | 编辑后运行 `release:sync` |
| `specs/<feature>/` | feature artifacts | 由 spec-driver 生成/维护 |
| `specs/products/_generated/` | machine outputs | 不手改，由脚本生成 |
| `.specify/**` | runtime state + project overlay | 不直接手改运行态（runs/），project-context.yaml 可编辑 |

## 常用命令

```bash
npm run repo:sync          # 全量同步（agent docs + release + skill mirrors）
npm run repo:check         # 全量校验
npm run release:sync       # 仅同步 release contract
npm run release:check      # 仅校验 release contract
npm run docs:sync:agents   # 仅同步 docs/shared → CLAUDE.md + AGENTS.md
npm run lint               # TypeScript 类型检查
npm run build              # 编译
npm test                   # 全量测试

# —— 图与门禁（M9 起）——
node dist/cli/index.js batch --mode graph-only   # 秒级零 LLM 建图（新 worktree 首选）
spectra graph-quality                            # 六指标图质量门（repo:check 内含）
npm run drift:check                              # spec↔代码锚 drift 检查（--strict 硬门）
npm run judge:doctor                             # 安装版判定器快照 vs 源码漂移诊断
npm run repo:sync && npm run repo:check          # 受控产物再生 + 全族校验（提交前）
```

> 多 worktree 并行开发约定（编号防撞 / 先 ship 先 push / `specs/src.spec.md` 再生噪声
> 排除出 commit）见 `CLAUDE.md` 分支同步与交付节——提交前先 `git fetch origin master`。
