# Feature 082: Repo Sync 与运行态边界硬化

**创建日期**: 2026-04-06
**状态**: Implemented
**类型**: FEATURE

## 1. 背景

`076` 已完成 `077–081` 的主干结构收敛，但仓库仍缺一条稳定的维护主链：

- 没有统一的 `repo:sync / repo:check` 入口
- `.codex/`、`.claude/`、`.specify/` 的边界主要靠文档约定，没有 repo 级 validator
- `check-plugin-sync.sh` 仍承载过多 Bash 校验逻辑

这会让维护者在修改 source-of-truth、包装层、shared docs、release contract 与产品生成产物时，仍需要记住多条离散命令，且难以确认仓库是否真正处于一致状态。

## 2. 目标

1. 提供 repo 级统一同步入口 `repo:sync`
2. 提供 repo 级统一校验入口 `repo:check`
3. 用 contract 明确 `.codex/`、`.claude/`、`.specify/` 的受控边界
4. 将 `check-plugin-sync.sh` 收敛为 Node 校验链路的薄壳调用
5. 在满足原蓝图目标后正式收口 `076`

## 3. 范围

### In Scope

- 新增 repo maintenance core 与 CLI 入口
- 新增 runtime boundary contract 与 validator
- 将现有 sync/check 子链路接入统一入口
- 更新 AGENTS/CLAUDE 的共享维护约定
- 关闭 `076-codebase-rationalization-blueprint`

### Out of Scope

- 重写 `init-project.sh` / `codex-skills.sh` 的全部 Bash 逻辑
- 引入新的产品能力或新的 Plugin 模式
- 重新设计 `specs/products/**` 聚合结构

## 4. 交付物

- `contracts/runtime-boundary-contract.yaml`
- `scripts/repo-sync.mjs`
- `scripts/repo-check.mjs`
- `scripts/lib/repo-maintenance-core.mjs`
- `scripts/lib/runtime-boundary-core.mjs`
- `scripts/validate-runtime-boundaries.mjs`
- `docs/shared/agent-repo-maintenance.md`
- 新的 integration tests

## 5. 验收标准

1. `npm run repo:sync` 能串起现有核心同步链路
2. `npm run repo:check` 能在一次运行中覆盖 shared docs、marketplace/plugin metadata、wrapper/skill source-of-truth、release contract 与 runtime boundary
3. `scripts/check-plugin-sync.sh` 不再内联复杂业务校验
4. `.specify/runs/`、`.specify/.spec-driver-path`、`.claude/settings.local.json` 的运行态边界有 contract 和测试保护
5. `076` 蓝图更新为已完成状态，并记录本次 follow-up 收口
