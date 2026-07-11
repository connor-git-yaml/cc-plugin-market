---
feature: 209-fix-dataset-build-test-venv-flaky
mode: fix
phase: tasks
based_on: plan.md
---

# 修复任务清单 — F209 dataset-build 单测 venv 环境耦合 flaky

## T001 修改测试用例，注入不存在的 `--venv` 路径

- **文件**: `tests/unit/feature-187-dataset-build.test.ts`（L105-113 "单一一致标签" 用例）
- **动作**:
  1. 在 `spawnSync` 调用前新增局部变量 `const venvPath = path.join(dir, 'nonexistent-venv');`
  2. `spawnSync` 的 CLI 参数数组追加 `'--venv', venvPath`
  3. 同步修正 L108 注释（去掉"无 venv → fetch 阶段失败"环境假设表述，改为"显式注入不存在的 --venv"）
  4. 同步修正 L110 注释（"（无 venv）"改为"（venv 不存在）"）
- **验收标准**:
  - 三处断言语句本身不变：`expect(res.status).not.toBe(0)`、`expect(res.stderr).not.toMatch(/dataset 标签不一致/)`、`expect(res.stderr).not.toMatch(/未知 dataset tag/)`
  - `git diff` 仅涉及该测试文件、该用例范围内的行（1 个新变量声明 + spawnSync 参数追加 + 2 处注释调整）
  - 无生产源码改动（`scripts/lib/swebench-dataset-build.mjs` 不动）

## T002 隔离跑目标测试文件，确认功能正确且耗时降级

- **命令**: `npx vitest run tests/unit/feature-187-dataset-build.test.ts`
- **验收标准**:
  - 该文件全部用例通过（3 个 describe 块，共 9 个 it，零失败）
  - "单一一致标签"用例耗时从原先 ~4.1s 降至毫秒级（<200ms），可从 vitest 输出的单测耗时中直接确认

## T003 全量单测跑，验证零回归 + flaky 消除

- **命令**: `npx vitest run`
- **验收标准**:
  - 零失败（全仓库单测，含并行场景）
  - 目标测试文件在全量并行下不再因超时失败（此前 flaky 复现条件）

## T004 构建校验

- **命令**: `npm run build`
- **验收标准**: 零类型错误（本次改动限于 `.test.ts`，理论不影响构建，仍需过一遍确认）

## FR 覆盖映射

| 修复目标 | 对应任务 |
|---------|---------|
| 消除测试对本机 `scripts/.swebench-venv` 环境状态的依赖 | T001 |
| 验证功能正确性 + 耗时量级 | T002 |
| 验证并行场景下 flaky 已消除、零回归 | T003 |
| 构建零错误 | T004 |

## 执行顺序

T001 → T002 → T003 → T004（线性执行，无并行任务；改动面单文件单用例，无需拆分）
