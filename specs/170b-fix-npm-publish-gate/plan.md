# F170b — 修复规划

## 目标

以最小变更完成三件事：
1. 实施 namespace guard（repo:check 新检查项）
2. 修 E2E 逃逸（去 early-return + 派生 CORRECT_NAMESPACE）
3. 确保 prepublishOnly 不再 block，让用户可 npm publish 4.2.0

## 变更范围（最小化）

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `tests/unit/repo-check-namespace-guard.test.ts` | NEW | namespace guard TDD 测试 |
| `tests/e2e/feature-170a-...test.ts` | MODIFY | 去 early-return + 派生 CORRECT_NAMESPACE |
| `scripts/repo-check.mjs` | MODIFY | 新增 namespace-consistency 检查项 |

## 架构选择

**namespace guard 实现方式**：
- 在 `repo-check.mjs` 中新增 `checkNamespaceConsistency()` 函数
- 读取 `plugins/spectra/.claude-plugin/plugin.json` → name 字段
- 读取 `plugins/spectra/.mcp.json` → mcpServers 第一个 key
- 派生期望 namespace：`mcp__plugin_{name}_{serverKey}__`
- 扫描 `plugins/spec-driver/agents/*.md` frontmatter 中的 tools 列表
- 断言每个 agent 的 tools 包含正确 namespace 前缀，不包含旧 namespace

**派生公式**：
```
plugin.json name = "spectra"
.mcp.json server key = "spectra"  
→ expected_namespace = "mcp__plugin_spectra_spectra__"
```

**E2E CORRECT_NAMESPACE 派生**：
- 在测试顶部读取 plugin.json + .mcp.json
- 动态构建 CORRECT_NAMESPACE 常量
- 如果文件缺失，测试直接 fail（不再 silent pass）

## 回归风险评估

- 低风险：namespace guard 是纯读文件检查，不修改任何功能代码
- 低风险：E2E 修改是收紧断言，不会引入新的假阳性
- 零风险：不修改 src/ 下任何文件

## 修复验证方案

1. `npx vitest run tests/unit/repo-check-namespace-guard.test.ts` — GREEN
2. `npx vitest run tests/e2e/feature-170a-*.test.ts` — 28 tests pass
3. `npm run repo:check` — 新增 namespace-consistency 检查项 pass
4. 故意改错 1 个 agent frontmatter → namespace-consistency FAIL（验证 fail-loud）
5. `npm run build && npx vitest run` — 全量 pass
6. `npm run release:check` — pass
7. Host shell: `npm publish` → `npm view spectra-cli versions` 含 4.2.0

## 不变量

- 不修改 src/ 任何文件（feature 155 代码已存在）
- 不修改 agents/*.md（namespace 已正确）
- 不修改 prepublishOnly 脚本（当前已可通过，无需改动）
