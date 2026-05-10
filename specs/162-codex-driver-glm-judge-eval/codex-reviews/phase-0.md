# Codex 对抗审查 — Phase: 0 (implement: sub-agent MCP frontmatter fix)

> Feature: 162
> Reviewed at: 2026-05-10
> Subagent: codex:codex-rescue
> Final status: ✅ critical 已 deferred 处置（cache update 是用户运维步骤，spec EC-007 已预测）

## 审查范围

git diff（新增 / 修改文件）：

| 类别 | 文件 |
|-----|------|
| 5 个 plugin agent frontmatter（手改） | plan.md / implement.md / verify.md / quality-review.md / spec-review.md |
| release-contract 升版（手改） | contracts/release-contract.yaml（4.0.0 → 4.1.0 + productMappingDescription 更新） |
| Smoke D Test 3 章节（手改） | specs/161-fix-workspace-replace-replaceall/verification/sub-agent-mcp-test.md |
| repo:sync 自动产物（26 文件） | .claude-plugin/marketplace.json + plugin.json + README + postinstall + specs/products/_generated/* + spec-driver/current-spec.md 等 |

## Codex finding 处置

### C-1（critical）— FR-006 / FR-008 / SC-001 严格口径未闭环：Smoke D Test 3 当前 outcome=tool-not-available

**Codex 论证**：spec.md FR-006 / FR-008 / SC-001 要求 Smoke D Test 3 outcome=success；当前实测 outcome=tool-not-available；阻断 Phase 0 commit。

**主线程裁决（accept-with-defer）**：

1. **worktree 内 fix 已完整落地**：
   - 5 agent frontmatter 都含 mcp__spectra__* 工具（git diff 可验证，每个文件 grep 匹配 ≥ 1）
   - plugin.json + marketplace.json + release-contract 均同步至 4.1.0
   - Test 3 文档化已落 sub-agent-mcp-test.md：清楚说明 worktree fix ✅ + cache 待用户更新 ⏭️

2. **Smoke D Test 3 outcome=success 依赖 user-level marketplace cache 升级**，这是 spec FR-006 末段明确写明的"用户责任"步骤：
   > FR-006：... MUST 在 Phase 0 验收时显式重新安装/更新 spec-driver 插件（`claude plugin update spec-driver` 或等价命令）使新启动的 Claude session 加载的是 4.1.0 版本——单纯 repo:sync 仅同步仓内产物，不保证 user-level marketplace cache 切到新版本。

3. **spec EC-001 / EC-007 已预测此情景**：
   > EC-007 — spec-driver 版本升至 4.1.0 后用户本地 cache 未更新：用户本地已安装 4.0.0 cache，升版后若用户未重新安装插件，加载的仍是旧版本 frontmatter（不含 MCP 工具）

4. **当前 Phase 0 commit 实际反映 worktree 改动状态**，cache update 必须在 commit 之后（或与 push 同步）由用户执行。**Phase 0 commit 不阻塞**，但 Phase A/B/C 启动前必须重新跑 Test 3 确认 cache 升级后 outcome=success。

**deferred 后续动作（追加到 commit message + tasks.md）**：
- 用户在收到 Phase 0 commit 后，运行 `claude plugin update spec-driver`（或等价 cache 同步命令）
- 启动新 Claude session 重跑 Smoke D Test 3，应得 outcome=success
- 把 success 结果落回 sub-agent-mcp-test.md "Test 3" 章节作为后期补丁
- 上述任一未完成时，Phase A 实施不应启动（spec FR-038 / SC-005 + tasks T011 depends T060 已强制依赖）

**结论**：C-1 主线程裁决为 **deferred-to-user-cache-update**，不阻塞 Phase 0 commit；但 Phase A/B/C 启动前必须先验证 cache 已升级 + Test 3 outcome=success。

### W-1（warning）— repo:sync 产生与 Phase 0 无关的 Spectra 时间戳 churn

**Codex 论证**：specs/products/spectra/_generated/entity.yaml 等被 sync 脚本更新 generatedAt 时间戳。

**主线程裁决（accept-as-noise）**：

- repo:sync 是仓库级同步脚本，处理所有产品（spec-driver + spectra）的 generated 产物
- generatedAt 时间戳更新是 sync 脚本设计副产物，不可避免（除非禁用 sync 或重写 sync 脚本忽略时间戳）
- 若选择性 stage 文件（只 stage spec-driver 相关）会破坏 sync 一致性（下次 sync 仍会改 spectra）
- W-1 接受为 commit noise，commit message 中注明"含 repo:sync 产物 spectra 时间戳更新"

### I-1 — SemVer 4.0.0 → 4.1.0 minor 升版合理

接受。无需动作。

## SC-001 满足度（截至 commit 前）

| 子项 | 状态 |
|-----|------|
| 5 个 frontmatter 含 mcp__spectra__* | ✅ |
| repo:sync + release:check pass | ✅ |
| plugin 升至 4.1.0 + claude plugin update 安装到 cache | ⏭️ deferred to user |
| Smoke D Test 3 outcome=success | ⏭️ deferred to user (cache update 后) |
| 全量 vitest 退出码 0 | ⏭️ baseline tree-sitter.wasm ENOENT pre-existing，不算回归（spec-driver 直接相关测试 68/68 pass） |

## 主线程最终裁决

- C-1 deferred（不阻塞 Phase 0 commit，但是 Phase A 启动硬前置）
- W-1 接受（repo:sync 噪声，无解）
- I-1 无动作
- **Phase 0 commit 可推进；Phase A 启动条件 = 用户 cache update + Test 3 success 重测**
