---
feature_id: "144"
plan_version: "1.0"
created_at: "2026-04-29"
status: "ready"
---

# Feature 144 — 实施计划：E2E Fixture 测试基础设施

## 1. 实施策略

**总体思路**：纯测试基础设施改动，零生产代码修改。通过 `vi.mock('@anthropic-ai/sdk')` 模块级拦截，让 Spectra batch pipeline 在 CI 零 API Key 环境中完整跑通，并对产出的 `graph.json` 执行结构断言。

**核心约束**：mock 的 `messages.create()` 响应必须返回符合 `Anthropic.Message` 类型的对象，且 `content[0].text` 须为 pipeline 可解析的合法 JSON（spec 解析依赖 9 段式 spec JSON 格式）。若 text 为非法 JSON，pipeline 会在 parse 阶段 crash，导致 SC-002 失败。因此 mock 返回的 text 应是一个最小化合法的 9 段式 spec JSON 占位符，让 pipeline 继续向下跑而不崩溃。

**风险点**：
- mock 响应格式与 pipeline 实际期望的 text 格式不匹配 → 会导致 SC-002 断言捕获 crash
- `tests/fixtures/e2e/small-ts-project/` 过于简单导致 `nodes.length === 0` → SC-004 trivially pass 但不验证字段；需确保至少 2 个有 import 关系的 TS 文件

## 2. Step-by-step 实施顺序（对应 spec §7）

**Step 1：创建 fixture 项目**
在 `tests/fixtures/e2e/small-ts-project/` 下创建最小 TypeScript 项目：
- `src/index.ts`（import utils.ts，导出 1 个函数）
- `src/utils.ts`（独立工具函数，被 index.ts import）
- `tsconfig.json`（指向 `src/`，compilerOptions 最小化）
- `package.json`（最小化，`"type":"module"` 对齐主仓库，无外部依赖）

fixture 的 `tsconfig.json` 是必要的：`runBatch` 内部 `scanFiles` 会扫描项目结构，TS parser 需要 tsconfig 确定文件边界。

**Step 2：注册 vitest e2e project + npm script**
在 `vitest.config.ts` 的 `projects` 数组末尾追加：
```typescript
{
  test: {
    name: 'e2e',
    include: ['tests/e2e/**/*.e2e.test.ts'],
    testTimeout: 60_000,
  },
}
```
在 `package.json` `scripts` 中追加 `"test:e2e": "vitest run --project e2e"`。
`testTimeout` 设为 60s：batch pipeline 含文件扫描、图构建、LLM mock 调用多阶段，比单测慢一个量级，60s 在 small fixture 下足够且有余量。

**Step 3：编写 E2E 测试文件骨架**
创建 `tests/e2e/batch-pipeline.e2e.test.ts`：
- 文件顶部 `vi.mock('@anthropic-ai/sdk', ...)` 声明（hoisting 要求必须在顶层）
- `beforeAll`：设置 `process.env.ANTHROPIC_API_KEY = 'test-key'`；用 `fs.existsSync` 断言 fixture 目录存在
- `afterAll`：`delete process.env.ANTHROPIC_API_KEY`

**Step 4：pipeline 调用与断言**
调用 `runBatch(fixtureProjectRoot, { outputDir: tmpOutputDir })` 并：
- 断言返回值不 throw（SC-002）
- 读取 `graph.json`，断言顶层结构（SC-003）
- 遍历 `nodes` 数组，断言每个 node 有 `id / kind / label / metadata`（SC-004）
- 断言 `graph.nodeCount === nodes.length`（SC-005）
- 断言 `nodes.length >= 1`（防止空 fixture 误 pass）

`outputDir` 指向临时目录（`os.tmpdir() + '/spectra-e2e-' + Date.now()`），`afterAll` 中清理，避免污染仓库。

**Step 5：CI 验证与回归确认**
执行 `npm run test:e2e` 全通过（SC-001 ~ SC-006）；执行 `npx vitest run` 确认现有四个 project 零回归（SC-007）。

## 3. 关键决策点

| 决策 | 结论 | 理由 |
|------|------|------|
| mock text 格式 | 最小化 9 段式 spec JSON 占位符（含必要 key，值为空字符串/空数组） | pipeline 的 spec 解析步骤依赖特定 JSON 格式；空字符串或 `{}` 会导致 parse crash |
| `testTimeout` | 60_000 ms | batch pipeline 含多阶段处理，比 unit 慢；small fixture 2-5 文件，60s 有充足余量 |
| fixture 的 `tsconfig.json` | 必须包含 | `runBatch` 内部 scanFiles 和 TS AST parser 需要 tsconfig 确定编译范围 |
| 临时输出目录 | `os.tmpdir()` + 时间戳子目录 | 避免 graph.json 落在仓库目录被误提交；测试后 `afterAll` 清理 |

## 4. 风险缓解

| 风险 | 现象 | 缓解措施 |
|------|------|---------|
| mock 响应格式错误 | pipeline parse crash，SC-002 断言失败 | mock 返回最小合法 9 段式 spec JSON；实现时参考 `src/core/single-spec-orchestrator.ts` 的解析逻辑确认期望格式 |
| fixture 过简，nodes 为空 | SC-004 trivially pass，不验证字段 | fixture 设计 2 文件 + 1 import 关系；测试中加 `expect(nodes.length).toBeGreaterThan(0)` |
| env 污染 | `ANTHROPIC_API_KEY` 泄漏到其他测试 | `afterAll` 中 `delete process.env.ANTHROPIC_API_KEY`；e2e project 独立 worker（vitest 默认隔离） |
| pipeline crash 路径不确定 | 某阶段 throw 但 mock 已设置 | `beforeAll` 中 `fs.existsSync` 提前验证 fixture 路径；`expect(runBatch(...)).resolves.toBeDefined()` 捕获 reject |

## 5. Codebase Reality Check

| 目标文件 | LOC | 修改类型 | 已知 debt |
|---------|-----|---------|---------|
| `vitest.config.ts` | 67 | 新增 e2e project 条目（~5 行） | 无 |
| `package.json` | ~100 | 新增 1 条 script | 无 |
| `tests/e2e/batch-pipeline.e2e.test.ts` | 新建 | ~80 行 | N/A |
| `tests/fixtures/e2e/small-ts-project/*` | 新建 | ~30 行（4 文件） | N/A |

**前置清理**：无需要。所有目标文件均为新建或小幅追加，不触发清理规则。

## 6. Impact Assessment

- **影响文件数**：2 改动（vitest.config.ts、package.json）+ 5 新建（测试/fixture 文件）= 7 个
- **跨包影响**：无，变更仅在 `tests/` 和根配置文件，不触及 `src/`、`plugins/`
- **数据迁移**：无
- **API/契约变更**：无（不修改任何公共接口）
- **风险等级**：**LOW**（影响文件 < 10，无跨包影响，无迁移，无契约变更）

**无需分阶段**：LOW 风险，单阶段实现即可。
