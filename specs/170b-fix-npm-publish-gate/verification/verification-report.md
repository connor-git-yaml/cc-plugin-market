# F170b — 验证报告

## 验证时间

2026-06-01 01:02

## 变更清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `scripts/lib/namespace-consistency-core.mjs` | NEW | 从 plugin.json + .mcp.json 派生 namespace 并校验 agent frontmatter |
| `scripts/lib/repo-maintenance-core.mjs` | MODIFY | 新增 import + aggregateValidation 调用 namespace-consistency |
| `tests/unit/repo-check-namespace-guard.test.ts` | NEW | namespace guard 单元测试（10 tests）|
| `tests/e2e/feature-170a-*.test.ts` | MODIFY | 去 early-return 逃逸 + CORRECT_NAMESPACE 改为派生 |

## 验证结果

### 全量测试

```
Test Files  320 passed | 4 skipped (324 total)
Tests       3848 passed | 11 skipped | 20 todo (3879 total)
```

新增测试：
- `tests/unit/repo-check-namespace-guard.test.ts` — 10/10 pass
- `tests/e2e/feature-170a-*.e2e.test.ts` — 28/28 pass（含修改后的 L188）

### Build

```
tsc — 零错误
```

### repo:check

```
[repo-check] status=pass
- namespace-consistency:agent-frontmatter-plan: pass
- namespace-consistency:agent-frontmatter-implement: pass
- namespace-consistency:agent-frontmatter-verify: pass
- namespace-consistency:agent-frontmatter-spec-review: pass
- namespace-consistency:agent-frontmatter-quality-review: pass
（共 49 项检查，全 pass）
```

### release:check

```
Release contract valid (contracts/release-contract.yaml)
```

### Fail-loud 验证

故意改 plan.md namespace 为 `mcp__spectra__context`：
```
[repo-check] status=fail
- namespace-consistency:agent-frontmatter-plan: fail
errors: plan.md 含非期望 namespace 工具：mcp__spectra__context（期望前缀：mcp__plugin_spectra_spectra__）
```
✅ Fail-loud 守护正常工作

### E2E 逃逸修复验证

- L188 `if (!existsSync(docPath)) return;` 已改为正式 `expect(existsSync(docPath)).toBe(true)`
- CORRECT_NAMESPACE 从硬编码改为从 plugin.json + .mcp.json 动态派生
- 当前文件存在：28/28 pass（无回归）

## npm publish 状态

**待用户在 host shell 执行**（需 npm login）：

```bash
npm publish
npm view spectra-cli versions
npm view spectra-cli dist-tags
```

prepublishOnly 当前状态：
- `npm run release:check` — ✅
- `npm run repo:check` — ✅  
- `npm run build` — ✅
- `npx vitest run` — ✅ (3848 pass)

**prepublishOnly 不再阻塞，可执行 npm publish**。

## host shell 真机验收（2026-05-30 完成）

原始 CRITICAL（用户 `npm i -g spectra-cli` 拿到缺工具的 4.1.1 旧 binary）**已彻底闭合**：

- [x] `npm publish` — spectra-cli@4.2.0 已发布
- [x] `npm view spectra-cli versions` → `['4.1.1', '4.2.0']` ✅
- [x] `npm view spectra-cli dist-tags.latest` → `4.2.0` ✅
- [x] `npm i -g spectra-cli@4.2.0 && spectra --version` → `spectra v4.2.0` ✅
- [x] 全局 binary 注册 3 工具 — volta 实际安装路径 `~/.volta/tools/image/packages/spectra-cli/` 含 `dist/mcp/agent-context-tools.js`，确认注册 `impact / context / detect_changes` ✅

**排障小结**：publish 反复失败不是代码问题，是主仓库 checkout 卡在 170c 旧代码（7ef3ce8），`git pull --ff-only` 被一个 untracked eval JSON 文件碰撞静默挡住。清除阻塞 + ff 到 10aa2c4 + 主仓库真机 gate 全绿后，`npm login + npm publish` 成功。

**F170b CRITICAL（npm publish）+ F170e CRITICAL-2（cwd→projectRoot）系列彻底闭合。**
