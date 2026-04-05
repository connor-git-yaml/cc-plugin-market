# Feature Specification: 包装层 Source-of-Truth 收拢

**Feature Branch**: `077-wrapper-source-truth-consolidation`  
**Created**: 2026-04-05  
**Status**: Implemented  
**Input**: 落地 `076` 蓝图的第一步，在 spec-driver 范围内明确 wrapper / metadata / project override 的单一来源与校验合同。

## User Scenarios & Testing

### User Story 1 - Codex wrapper 拥有明确的 canonical source (Priority: P1)

作为仓库维护者，我希望 `plugins/spec-driver/skills/**` 明确成为 `.codex/skills/spec-driver-*/SKILL.md` 的 canonical source，这样升级或重构 Skill 时不会再依赖人工记忆同步。

**Independent Test**: 运行 `npm run codex:spec-driver:install`，检查生成后的 `.codex/skills/spec-driver-*/SKILL.md` 都带有 `Wrapper Source Contract` 头部，并指向正确的 source skill 与 contract 文件。

### User Story 2 - 包装层一致性可以被脚本化校验 (Priority: P1)

作为仓库维护者，我希望存在一个确定性的 validator，能检查 canonical source、Codex wrapper、Claude project overrides、plugin metadata 与 marketplace entry 是否保持一致。

**Independent Test**: 运行 `node plugins/spec-driver/scripts/validate-wrapper-sources.mjs --project-root . --json`，返回 `pass`；人为破坏一个 wrapper 合同头部后返回 `fail`。

### User Story 3 - 团队能一眼分清哪些文件该改、哪些文件该再生成 (Priority: P2)

作为协作者，我希望在 `README.md`、`plugins/spec-driver/README.md` 与 `AGENTS.md` 中看到精简但明确的 wrapper source-of-truth 约定，避免直接修改 `.codex/skills/**` 或误把 `.claude/commands/**` 当插件源。

**Independent Test**: 检查三份文档，确认都明确说明了 canonical source、generated wrapper 与 project override 的边界。

## Requirements

### Functional Requirements

- **FR-001**: `plugins/spec-driver/skills/**` MUST 成为 spec-driver Codex wrapper 的 canonical source
- **FR-002**: `.codex/skills/spec-driver-*/SKILL.md` MUST 由 `codex-skills.sh install` 再生成，而不是人工直接维护
- **FR-003**: 生成的 Codex wrapper MUST 带有显式 `Wrapper Source Contract` 头部，包含 canonical source、generator command、contract path 与“不要直接编辑”提示
- **FR-004**: 系统 MUST 提供 `validate-wrapper-sources.mjs` 校验 source skill、wrapper、Claude project overrides、plugin metadata 与 marketplace 的一致性
- **FR-005**: 仓库级 `check-plugin-sync.sh` MUST 接入 wrapper source-of-truth validator
- **FR-006**: `AGENTS.md`、仓库根 `README.md` 与 `plugins/spec-driver/README.md` MUST 明确 source-of-truth 约定
- **FR-007**: 产品级活文档与 product mapping MUST 纳入 `076` 蓝图与 `077` feature

## Success Criteria

- `plugins/spec-driver/contracts/wrapper-source-of-truth.yaml` 成为可执行合同
- `npm run codex:spec-driver:install` 生成的所有 spec-driver Codex wrappers 都包含 `Wrapper Source Contract`
- `node plugins/spec-driver/scripts/validate-wrapper-sources.mjs --project-root . --json` 返回 `pass`
- 相关集成测试、`lint`、`build` 全部通过
