# F194 工具链验证记录（T005 步骤 1/2 独立产物，整改 spec-review FR-05 WARNING）

## 运行环境

- worktree: `.claude/worktrees/xenodochial-lumiere-96aa7f`，分支 `194-fix-python-adapter-gitignore`
- 基底：rebase 至 origin/master `a78285f`（含 F182 a56346c）后的 commit `fix(194)`

## 步骤 1 — 针对性单测（多轮）

```
npx vitest run tests/unit/file-scanner.test.ts tests/adapters/python-adapter.test.ts tests/unit/batch-orchestrator-gitignore.test.ts
→ Test Files 3 passed (3) / Tests 67 passed (67)
```

实现完成（65）→ Codex W2 返工补 2 条剪枝用例（67）→ 质量审查修订（mock 类型/path.resolve 简化）→ 编号改 194 后复跑：四个时点均全绿。

## 步骤 2 — 全量验证

| 轮次 | 时点 | vitest | build (tsc) | repo:check | release:check |
|------|------|--------|-------------|------------|---------------|
| R1 | rebase 前（基底 3925df5） | 4251 passed / 0 failed（352 files + 4 skipped） | 零类型错误 | 全 pass | — |
| R2 | rebase 后（基底 a78285f 含 F182） | 4262 passed / **1 failed** | 零类型错误 | 57 项全 pass | contract valid |
| R3 | R2 复跑 | **4263 passed / 0 failed**（354 files + 4 skipped） | — | — | — |

**R2 单例失败判定为环境性 flaky**：R3 连续复跑零失败；失败用例名未被日志窗口捕获，但本 fix 的 67 条针对性测试在全部轮次中均通过；worktree 环境存在已知 E2E 偶发（先例：watch-command.test.ts chokidar/fsevents flaky）。R1↔R2 的 tests 总数差（4251→4262/4263）来自 rebase 引入的 F182 新增测试。

## 步骤 2.5 — 自动再生产物污染检查

R1 后 `git status` 检出 `specs/src.spec.md` 被全量 vitest 再生 → `git checkout --` 恢复 ✓（Codex Phase 2 审查 I1 预言命中）；commit 使用显式路径 add。

## 步骤 3/4 — rebase 后行为复验

- micrograd / nanoGPT：capture 复跑与 after-*.json 逐字节 diff **零差异** ✓（F182 合入不影响三处 walk 行为）
- 合成项目 /tmp/f193-repro：moduleCount=1、moduleSources=["pkg/core.py"] ✓
