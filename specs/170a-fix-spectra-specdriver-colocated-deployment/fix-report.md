# 问题修复报告 — Feature 170a

## 问题描述

Spectra + Spec Driver 协同部署存在 3 个阻塞性 Bug，导致真实生产环境下 sub-agent 无法调用 MCP 工具、npm 全局安装的 spectra binary 缺少 Feature 155 工具、用户部署后无从 verify。

---

## Bug-1: NPM spectra-cli@4.1.1 不含 Feature 155 agent-context tools

### 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 用户全局安装的 spectra binary 为何不暴露 impact/context/detect_changes？ | npm 包版本 4.1.1 (2026-05-01 publish) 早于 Feature 155 ship 日期 (2026-05-06+) |
| Why 2 | Feature 155 ship 后为何没有重新发布 npm？ | npm publish 不在 git push master 的自动流程里；Feature 155 commit 后未单独触发 publish |
| Why 3 | 为何未被发现直到 Stage 7b？ | 本地开发走 `npx tsx src/mcp/server.ts` / `npm run dev`，绕过已发布包，本地测试通过 |
| Why 4 | `dist/mcp/agent-context-tools.js` 当前是否存在？ | dist/ 目录不存在（本 worktree 未跑 build），src/mcp/server.ts 已正确 import agent-context-tools |
| Why 5 | 为何未被自动化检测捕获？ | 没有 E2E 测试断言 npm 全局安装包的工具列表 |

**Root Cause**: Feature 155 ship 后未触发 npm publish，导致 npm 包停留在 4.1.1（缺工具）  
**Root Cause Chain**: 工具缺失 → npm 包过旧 → 未触发 publish → publish 不在交付 checklist → 无 E2E 验证覆盖

### 影响范围扫描

同源问题（需同步修复）：
| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `contracts/release-contract.yaml` | spectra.version | 4.1.1 | bump → 4.2.0 |
| `package.json` | version | 4.1.1 | release:sync 同步 |
| `plugins/spectra/.claude-plugin/plugin.json` | version | 4.1.1 | release:sync 同步 |

同步更新清单：
- 构建：跑 `npm run build` 确认 `dist/mcp/agent-context-tools.js` 生成
- 发布：`npm publish` 发布 spectra-cli@4.2.0
- 验证：`npm view spectra-cli versions` 含 4.2.0，临时 install 后检查工具列表

### 修复策略

**方案 A（推荐）**: bump version → 4.2.0 + build + npm publish

---

## Bug-2: Sub-agent frontmatter namespace mismatch

### 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | sub-agent 为何调不到 spectra MCP 工具？ | frontmatter 写 `mcp__spectra__context`，但 plugin 实际暴露 `mcp__plugin_spectra_spectra__context` |
| Why 2 | namespace 为何不一致？ | Claude Code plugin 系统自动生成 namespace 格式为 `mcp__plugin_{plugin-name}_{server-name}__*`；Feature 162 写 frontmatter 时用了简化名称 |
| Why 3 | Feature 162 为何用了简化名称？ | 开发时参考内部早期文档，namespace 生成规则后来才确定；本地 dev 测试用的直连 MCP 不走 plugin namespace |
| Why 4 | 为何 Stage 7b 才发现？ | 单元测试和 eval 脚本走 driver 顶层调用，不触发 sub-agent 的 frontmatter tools；只有真实 plugin 环境才能复现 |
| Why 5 | 为何无 guard 阻止错误 namespace 写入？ | 没有 lint/schema 验证 agent frontmatter 中的工具名格式 |

**Root Cause**: Feature 162 写 frontmatter 时用简化 namespace，与 Claude Code plugin 实际生成的 namespace 不符  
**Root Cause Chain**: 工具调不到 → namespace 不符 → 开发时用简化名 → plugin namespace 规则未在开发时明确 → 无 frontmatter 格式验证

### 影响范围扫描

同源问题（需同步修复）：
| 文件 | 工具名 | 修复动作 |
|------|--------|----------|
| `plugins/spec-driver/agents/plan.md` | `mcp__spectra__context`, `mcp__spectra__impact` | → `mcp__plugin_spectra_spectra__context`, `mcp__plugin_spectra_spectra__impact` |
| `plugins/spec-driver/agents/implement.md` | 同上 | 同上 |
| `plugins/spec-driver/agents/verify.md` | `mcp__spectra__detect_changes`, `mcp__spectra__impact` | → `mcp__plugin_spectra_spectra__detect_changes`, `mcp__plugin_spectra_spectra__impact` |
| `plugins/spec-driver/agents/spec-review.md` | `mcp__spectra__impact`, `mcp__spectra__context` | 同上 |
| `plugins/spec-driver/agents/quality-review.md` | 同上 | 同上 |

安全项：
- F162-169 eval cohort C 的 `buildGroupCPrompt` 走 driver 顶层调用，不经过 sub-agent frontmatter，不受影响
- `spec-driver SKILL.md` 不需要修改（🅰 方案）

同步更新清单：
- E2E 测试：断言 5 个文件 frontmatter 含正确 plugin namespace
- 文档：新增 spectra-mcp-integration.md 解释 namespace 规则

### 修复策略

**方案 A（推荐，🅰 方案）**: 修改 5 个 agent frontmatter，替换为正确 plugin namespace，不动 SKILL.md

---

## Bug-3: 缺协同部署文档

### 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 用户装完两个 plugin 后为何不知道怎么 verify？ | 没有 step-by-step onboarding 文档 |
| Why 2 | 为何没有写文档？ | Feature 162 聚焦工具链技术实现，文档属于"后续"被推迟 |
| Why 3 | 为何 README 没有体现？ | spec-driver README.md 只有产品功能介绍，缺集成部署章节 |
| Why 4 | Fork 用户改 plugin 名后为何会卡住？ | namespace 变化后 frontmatter 全部失效，无文档指引如何批量替换 |
| Why 5 | 为何没有故障排查指引？ | MCP plugin 失败（status:failed）的 debug 路径分散在多处，没有汇总 |

**Root Cause**: Feature 162 把文档作为 nice-to-have 推迟，导致 onboarding 路径完全缺失  
**Root Cause Chain**: 用户卡住 → 无 onboarding doc → 被推迟 → Feature 162 聚焦技术实现 → 无 doc gate

### 影响范围扫描

需新建：
- `plugins/spec-driver/docs/spectra-mcp-integration.md`
- `plugins/spec-driver/docs/customization.md`

需更新：
- `plugins/spec-driver/README.md`（加 Spectra MCP 集成章节）
- `specs/147-competitor-evaluation-platform/PUBLISH-REPORT.md`（§6 更新部署说明）

---

## 修复范围评估

受影响文件共 **10 个**（5 agent 文件 + 2 新 doc 文件 + release-contract + README + PUBLISH-REPORT），涉及 **3 个模块**（spectra npm 发布 / spec-driver agent frontmatter / 文档体系）。

规模在 fix 模式可处理范围内，继续 fix 模式。

---

## 整体修复策略（3 个 Phase）

1. **Phase 1（Bug-1）**: bump spectra version → 4.2.0 + build + npm publish
2. **Phase 2（Bug-2）**: 修改 5 个 agent frontmatter namespace
3. **Phase 3（Bug-3）**: 新增 docs + 更新 README + PUBLISH-REPORT

TDD 顺序：RED（E2E test scaffolding）→ GREEN（3 Phase 实施）→ REFACTOR（可选）

## Spec 影响

- 需更新：`contracts/release-contract.yaml`（版本号）
- 无需更新：现有 spec.md（bug fix 不改产品规格）
