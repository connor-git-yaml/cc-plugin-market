# 修复规划 — Feature 170a

## 修复目标

修复 Spectra + Spec Driver 协同部署的 3 个阻塞性 Bug，实现"装两个 plugin 后 sub-agent 2 步开箱即用调到 MCP 工具"的产品承诺。

## TDD 顺序（M7 强制约束）

### Commit 1 — RED phase

新增 `tests/e2e/feature-170a-spectra-spec-driver-integration.test.ts`，包含 3 个用户故事的断言：
- US-1: spectra-cli 4.2.0 暴露 impact/context/detect_changes（通过检查 src/mcp/server.ts 注册 + build 后 dist/mcp/agent-context-tools.js 存在）
- US-2: 装两个 plugin 后 sub-agent 无需额外配置即可调用 mcp__plugin_spectra_spectra__context
- US-3: 5 个 agent frontmatter 全部包含正确 plugin namespace

跑 vitest 应全 FAIL (RED)。

### Commit 2 — GREEN phase

按顺序实施 3 个 Phase：

**Phase 1: NPM 发布同步（Bug-1）**

1. `contracts/release-contract.yaml`: spectra.version 4.1.1 → 4.2.0，spec-driver.version 4.1.0 → 4.2.0
2. `npm run release:sync` 同步到 plugin.json / marketplace.json / package.json
3. `npm run build` 确认 dist/mcp/agent-context-tools.js 生成
4. `npm publish` 发布 spectra-cli@4.2.0（需 npm login）

⚠️ Stop-loss: npm publish 失败不阻塞 Phase 2/3，标 follow-up ticket

**Phase 2: Sub-agent frontmatter 修复（Bug-2，方案 🅰）**

修改 5 个文件（仅 frontmatter tools 列表，不动正文）：

```
plugins/spec-driver/agents/plan.md
plugins/spec-driver/agents/implement.md
plugins/spec-driver/agents/verify.md
plugins/spec-driver/agents/spec-review.md
plugins/spec-driver/agents/quality-review.md
```

替换规则：
- `mcp__spectra__context` → `mcp__plugin_spectra_spectra__context`
- `mcp__spectra__impact` → `mcp__plugin_spectra_spectra__impact`
- `mcp__spectra__detect_changes` → `mcp__plugin_spectra_spectra__detect_changes`

严格不动：SKILL.md、产品代码、eval scripts

**Phase 3: 文档化（Bug-3）**

新建文件：
- `plugins/spec-driver/docs/spectra-mcp-integration.md`（部署指引 + 故障排查 + RFC follow-up）
- `plugins/spec-driver/docs/customization.md`（fork 用户 sed/awk 一键替换）

更新文件：
- `plugins/spec-driver/README.md`（加 "Spectra MCP 集成" 章节）
- `specs/147-competitor-evaluation-platform/PUBLISH-REPORT.md`（§6 标注 2 步开箱即用）

### Commit 3 — VERIFY + Codex Review

跑验证：
- `npx vitest run` — 3 个 E2E 测试全 pass + 现有 3708 不回归
- `npm run build` — 零错误
- `npm run repo:check` — 零错误
- `npm run release:check` — 零错误

Codex 对抗审查 → 修复所有 critical

## 回归风险评估

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| frontmatter 改后 eval cohort C 失败 | 低 | 高 | cohort C 走 driver 顶层，不经 sub-agent frontmatter |
| npm publish 失败 | 中 | 中 | Phase 2/3 独立推进，不被阻塞 |
| release:sync 同步不完整 | 低 | 低 | release:check 会 catch |

## 最小化变更原则

- 不改 SKILL.md（🅰 方案核心约束）
- 不改产品代码（仅 frontmatter + docs）
- 不改 eval scripts
- spec/plan 改动仅限 feature 目录本身
