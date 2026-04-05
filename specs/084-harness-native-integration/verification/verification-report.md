# Feature 084 — 验证报告

## 编排器独立验证结果

| 命令 | 结果 |
|------|------|
| `npm run lint` (tsc --noEmit) | ✅ PASS |
| `npm run build` (tsc) | ✅ PASS |
| `npm run repo:check` | ✅ 38/38 PASS（含新增 behavior-rules 检查项） |
| `npm test` | ⚠️ 57 failures — 全部为 tree-sitter.wasm worktree 环境缺失，与 084 无关 |

## 验收标准逐项核查

| AC | 标准 | 结果 |
|----|------|------|
| 1 | hooks.json 包含 6 类 Hook | ✅ SessionStart + PreToolUse + PostToolUse + Stop + WorktreeCreate + WorktreeRemove |
| 2 | PreToolUse 阻断 src/ 编辑 | ✅ exit 2 + 错误提示 |
| 3 | .claude/rules/ 下 3 个路径规则 | ✅ tests.md + specs.md + plugins.md，docs/shared/ 有等价源 |
| 4 | 14 个 Agent .md 含 YAML frontmatter | ✅ 14/14 |
| 5 | CLAUDE.md <=100 行 | ✅ 84 行 |
| 5 | AGENTS.md <=100 行 | ✅ 98 行 |
| 6 | 行为约定零遗漏 | ✅ 11 条规则完整保留于 docs/shared/agent-behavior-rules.md |
| 7 | docs:sync:agents 幂等 | ✅ 第二次执行 0 updated |
| 8 | CI/CD workflow 语法合法 | ✅ |
| 9 | Hook 脚本无 tasks.md 时 exit 0 | ✅ 4/4 脚本全部 exit 0 |

## 已知问题

- test 环境中 tree-sitter wasm 文件在 worktree 不存在（node_modules 不完整），导致 Go/Java/Python adapter 测试失败。此为 worktree 环境配置问题，非 084 引入。
