# Feature Specification: Reverse-Spec Skill 与分发结构收敛

**Feature Branch**: `079-reverse-spec-skill-distribution-consolidation`  
**Created**: 2026-04-05  
**Status**: Implemented  
**Input**: 落地 `076` 蓝图中的 reverse-spec 侧收敛项，明确 `plugins/reverse-spec/skills/**`、`src/skills-global/**` 与 `skills/**` 的 source-of-truth 关系。

## User Scenarios & Testing

### User Story 1 - reverse-spec Skill 只有一个人工维护源 (Priority: P1)

作为仓库维护者，我希望 `plugins/reverse-spec/skills/**` 成为 reverse-spec Skill 的唯一人工维护源，这样更新 Skill 时不需要同时改三套目录。

**Independent Test**: 检查 `plugins/reverse-spec/contracts/skill-source-of-truth.yaml`，确认 canonical source 指向 `plugins/reverse-spec/skills/**`，并运行 validator 返回 `pass`。

### User Story 2 - 安装链路直接消费 canonical source (Priority: P1)

作为 CLI / init 使用者，我希望 `reverse-spec init` 和 postinstall 安装出来的 Skill 直接来自 canonical source，而不是旧的内联模板或漂移镜像。

**Independent Test**: 运行 `init` 或 `installSkills()`，确认目标 `.claude/skills/**/SKILL.md` 内容与 `plugins/reverse-spec/skills/**/SKILL.md` 完全一致。

### User Story 3 - 兼容镜像目录可再生成且可被脚本校验 (Priority: P2)

作为协作者，我希望 `src/skills-global/**` 与 `skills/**` 要么自动同步，要么显式报错，这样可以保留兼容目录但不再人工维护。

**Independent Test**: 运行 `npm run reverse-spec:sync:skills` 后，`src/skills-global/**` 与 `skills/**` 和 canonical source 一致；故意篡改镜像后，`npm run reverse-spec:check:skills` 返回 `fail`。

## Requirements

### Functional Requirements

- **FR-001**: `plugins/reverse-spec/skills/**` MUST 成为 reverse-spec Skill 的 canonical source
- **FR-002**: `src/skills-global/**` 与 `skills/**` MUST 退出人工维护路径，并由同步脚本再生成
- **FR-003**: `src/installer/skill-templates.ts` MUST 从 canonical source 文件加载内容，而不是维护内联模板常量
- **FR-004**: 系统 MUST 提供 reverse-spec skill source contract 与 validator，校验 canonical source、compatibility mirrors、plugin metadata 与 marketplace 同步
- **FR-005**: 仓库级 `check-plugin-sync.sh` MUST 接入 reverse-spec skill source validator
- **FR-006**: README、plugin README、AGENTS 与产品级活文档 MUST 明确 reverse-spec source-of-truth 约定
- **FR-007**: `package.json` 的发布清单与脚本 MUST 与新的分发结构保持一致

## Success Criteria

- reverse-spec Skill 只有 `plugins/reverse-spec/skills/**` 一个人工维护源
- `src/skills-global/**` 与 `skills/**` 可通过脚本再生成并受 validator 保护
- `reverse-spec init` / `installSkills()` 安装内容与 canonical source 保持一致
- 相关集成测试、`lint`、`build` 全部通过

