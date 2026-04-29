---
feature_id: "144"
spec_version: "1.0"
plan_version: "1.0"
tasks_version: "1.0"
created_at: "2026-04-29"
total_tasks: 4
total_estimate_hours: 3
---

# Feature 144 — 任务清单：E2E Fixture 测试基础设施

**关联文档**：[spec.md](./spec.md) | [plan.md](./plan.md)

---

## T-001 创建 fixture 项目（`tests/fixtures/e2e/small-ts-project/`）

| 属性 | 内容 |
|------|------|
| **依赖** | 无 |
| **关联** | SC-004（nodes 字段完整性）、spec §3.2 |
| **产物** | `tests/fixtures/e2e/small-ts-project/src/index.ts`（import utils，导出 1 个函数）；`tests/fixtures/e2e/small-ts-project/src/utils.ts`（独立工具函数）；`tests/fixtures/e2e/small-ts-project/tsconfig.json`（最小化，指向 `src/`）；`tests/fixtures/e2e/small-ts-project/package.json`（最小化，无外部依赖） |
| **完成判据** | `ls tests/fixtures/e2e/small-ts-project/src/` 列出 `index.ts` 和 `utils.ts`；`index.ts` 中存在 `import` 语句引用 `utils.ts`；`tsconfig.json` 含 `"include": ["src"]` 或等效配置；`package.json` 不含任何 `dependencies` |
| **预估** | 0.5 小时 |
| **可并行** | 可与 T-002 并行（均无前置依赖） |
| **风险** | fixture 过于简单导致 `nodes.length === 0`；防御：两文件间至少 1 个 import 关系，保证 AST 解析出节点 |

---

## T-002 注册 vitest e2e project + `test:e2e` script

| 属性 | 内容 |
|------|------|
| **依赖** | 无 |
| **关联** | SC-001（CI 零 API Key 运行）、SC-006（script 存在且独立） |
| **产物** | `vitest.config.ts`（`projects` 数组末尾追加 e2e project，`testTimeout: 60_000`，`include: ['tests/e2e/**/*.e2e.test.ts']`）；`package.json`（`scripts` 新增 `"test:e2e": "vitest run --project e2e"`） |
| **完成判据** | `grep "e2e" vitest.config.ts` 有结果；`grep '"test:e2e"' package.json` 有结果；`npm run test:e2e --help 2>&1` 无 "unknown script" 错误（script 注册成功） |
| **预估** | 0.5 小时 |
| **可并行** | 可与 T-001 并行 |
| **风险** | 新增 project 影响现有四个 project 的 include 范围；防御：仅追加，不修改已有 project 条目；完成后运行 `npx vitest run --project unit` 确认零回归（SC-007 前置验证） |

---

## T-003 编写 E2E 测试文件（mock + runBatch + 断言）

| 属性 | 内容 |
|------|------|
| **依赖** | T-001、T-002 |
| **关联** | SC-001 ~ SC-005、spec §3.1、§3.3、§6 |
| **产物** | `tests/e2e/batch-pipeline.e2e.test.ts`（~80 行；含：`vi.mock('@anthropic-ai/sdk')` 顶层声明 + 符合 `Anthropic.Message` 类型的 mock 实现；`beforeAll` 设置 `ANTHROPIC_API_KEY = 'test-key'` + `fs.existsSync` fixture 路径断言；`afterAll` 删除 env + 清理临时输出目录；调用 `runBatch(fixtureProjectRoot, { outputDir: tmpDir })` + 读取 `graph.json`；断言 SC-003 顶层结构、SC-004 每个 node 字段、SC-005 nodeCount 一致性、`nodes.length >= 1`） |
| **完成判据** | `npm run test:e2e 2>&1` 全通过（零 fail，零 skip）；输出含 `batch-pipeline.e2e.test.ts` 通过记录；`grep "vi.mock" tests/e2e/batch-pipeline.e2e.test.ts` 有结果；`grep "ANTHROPIC_API_KEY" tests/e2e/batch-pipeline.e2e.test.ts` 同时含 set 和 delete 两处 |
| **预估** | 1.5 小时 |
| **可并行** | 串行（依赖 T-001 fixture 存在、T-002 project 注册）|
| **风险** | mock text 格式错误导致 pipeline parse crash（SC-002 失败）；防御：mock 返回最小合法 9 段式 spec JSON 占位符，实现前阅读 `src/core/single-spec-orchestrator.ts` 确认期望格式；若 crash，先单独断言 `await expect(runBatch(...)).resolves.toBeDefined()` 定位 crash 阶段 |

---

## T-004 验证 SC-001 ~ SC-007 全通过 + 零回归确认

| 属性 | 内容 |
|------|------|
| **依赖** | T-001、T-002、T-003 |
| **关联** | SC-001 ~ SC-007、spec §8 |
| **产物** | 无新文件；全部验收标准通过的确认记录 |
| **完成判据** | `npm run test:e2e 2>&1; echo "exit: $?"` 退出码 0，7 个断言全通过（SC-001 ~ SC-005 覆盖于测试用例；SC-006 由 script 可独立调用验证）；`npx vitest run 2>&1; echo "exit: $?"` 退出码 0，全五个 project 零 fail（SC-007）；`npm run build 2>&1; echo "exit: $?"` 退出码 0（类型检查零错误） |
| **预估** | 0.5 小时 |
| **可并行** | 串行（最终验证关卡） |
| **风险** | vitest.config.ts 新增 project 后 `testTimeout` 覆盖范围不符合预期；防御：确认 e2e project 的 `testTimeout: 60_000` 仅作用于 e2e，不覆盖其他 project |

---

## 汇总统计

| 维度 | 数值 |
|------|------|
| **总 Task 数** | 4 个 |
| **总预估工时** | 3 小时 |
| **可并行 Task 数** | 2 个（T-001 + T-002 可并行） |
| **高风险 Task** | T-003（mock 格式匹配） |
| **新增文件** | 5 个（4 个 fixture + 1 个测试文件） |
| **改动文件** | 2 个（vitest.config.ts、package.json） |

---

## 关键串行链路

```
T-001（fixture 文件）
T-002（vitest project 注册）
  → T-003（E2E 测试文件 + 断言） ← 关键风险节点
    → T-004（全量验证关卡）
```
