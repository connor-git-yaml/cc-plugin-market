# F170b — 修复任务

## 任务列表

### T1: RED — namespace guard 测试脚手架

**文件**: `tests/unit/repo-check-namespace-guard.test.ts`（新建）

测试内容：
- 调用 `repo-check.mjs` 逻辑（或提取出 checkNamespaceConsistency 函数），期望输出包含 `namespace-consistency` 检查项
- 断言当 frontmatter 包含正确 namespace 时检查 pass
- 断言当 frontmatter 包含旧 namespace `mcp__spectra__` 时检查 fail（fail-loud）
- 使用 fixture（临时文件）而非真实 agents/ 文件

**验收**: `npx vitest run tests/unit/repo-check-namespace-guard.test.ts` — 在 GREEN 实施前预期 FAIL（因函数未存在）

---

### T2: RED — 修 E2E early-return + 派生 CORRECT_NAMESPACE

**文件**: `tests/e2e/feature-170a-spectra-spec-driver-integration.e2e.test.ts`

变更：
1. 第 35 行 `CORRECT_NAMESPACE` 常量：改为从 `plugins/spectra/.claude-plugin/plugin.json` + `plugins/spectra/.mcp.json` 动态读取派生
2. 第 188 行：去掉 `if (!existsSync(docPath)) return;`，改为 `expect(existsSync(docPath)).toBe(true)`（文件不存在时 FAIL 而非 silent pass）

**验收**: 
- 当前文件存在时：28 tests pass（不影响现有状态）
- 故意删文件后：该 test FAIL（不再 silent pass）

---

### T3: GREEN — repo:check 新增 namespace-consistency 检查

**文件**: `scripts/repo-check.mjs`

变更：
- 在脚本末尾新增 `checkNamespaceConsistency()` 函数
- 读取 `plugins/spectra/.claude-plugin/plugin.json` → name
- 读取 `plugins/spectra/.mcp.json` → 第一个 mcpServers key
- 派生 expectedNamespace = `mcp__plugin_${name}_${serverKey}__`
- 扫描 `plugins/spec-driver/agents/*.md`（plan, implement, verify, spec-review, quality-review）
- 对每个含 `tools:` frontmatter 的 agent 文件：
  - 断言包含 `expectedNamespace` 前缀的工具
  - 断言不含旧 namespace `mcp__spectra__` 前缀的工具（除非 expectedNamespace 本身包含 spectra）
- 输出检查项：`namespace-consistency:agent-frontmatter-{agentName}: pass/fail`
- 将函数添加到 main check 流程

**验收**:
- `npm run repo:check` 输出含 `namespace-consistency:*` 检查项，全部 pass
- T1 的 unit test PASS（GREEN 实施后）
- 故意将某 agent frontmatter 改为 `mcp__spectra__context` → 检查 FAIL

---

### T4: 全量验证

1. `npx vitest run` — 全量 pass
2. `npm run build` — 零错误
3. `npm run repo:check` — 含新 namespace-consistency 检查，全 pass
4. `npm run release:check` — pass
5. 故意破坏测试（改 agent frontmatter 错误 namespace）→ repo:check FAIL，改回 → PASS
6. 记录 Codex 对抗审查结果

---

### T5: npm publish（host shell，用户执行）

在 T1-T4 全部 pass 后：
1. 提交 RED + GREEN commit
2. Push 到 fix/170b-npm-publish-gate 分支
3. Rebase 到 master
4. 在 host shell 执行 `npm publish`（需 npm login）
5. 验证 `npm view spectra-cli versions` 含 4.2.0
6. 验证 `npm view spectra-cli dist-tags.latest` = 4.2.0
7. （可选）`npm i -g spectra-cli@4.2.0 && spectra mcp-server` 验证 tools/list 含 3 个 agent-context 工具

## 依赖关系

- T1 → T3（unit test 等待 GREEN 实施）
- T2 独立（可与 T1 并行）
- T3 → T4
- T4 → T5（全量验证通过后才 publish）
