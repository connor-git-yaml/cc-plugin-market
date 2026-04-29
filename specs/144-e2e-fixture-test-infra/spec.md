---
featureId: "144"
featureName: "e2e-fixture-test-infra"
milestone: "M-103"
status: "specified"
---

# Feature 144: E2E Fixture 测试基础设施

## 1. 意图与背景

### 背景与动机

M-101 Postmortem L6 教训明确指出：Mock-only 单元测试无法发现真实 pipeline 中的集成 bug。现有 vitest 配置包含 `unit`、`integration`、`golden-master`、`self-hosting` 四个 project，但缺少一个在 CI 环境可稳定运行、不依赖真实 LLM 调用的**端到端 pipeline 测试**层。

当前 `tests/integration/` 中的测试部分依赖真实 API Key，导致：
1. CI 环境无法安全运行（密钥泄露风险）
2. 测试结果受 LLM 输出不确定性影响，无法稳定断言
3. pipeline 各阶段的数据流正确性缺乏系统性验证

本 Feature 为 Spectra batch pipeline 建立专用的 E2E Fixture 测试层：通过模块级 mock 拦截 `@anthropic-ai/sdk`，完整运行 `runBatch()` pipeline，并用预录 fixture 验证产物的**结构和字段**（不验证 LLM 生成内容）。

### 问题陈述

- **现状**：pipeline 端到端路径仅有 mock-only 单测覆盖，真实 batch 流程从未在 CI 中完整跑通
- **目标**：建立可在 CI 零成本运行、能捕获 pipeline 集成 bug 的 E2E 测试层
- **范围**：不修改生产代码，仅新增测试基础设施（vitest project + fixture + npm script）

---

## 2. 功能边界

### In Scope

- 新增 `e2e` vitest project，配置独立的测试目录 `tests/e2e/`
- 新增 `test:e2e` npm script
- 用 `vi.mock('@anthropic-ai/sdk')` 实现模块级 LLM mock，覆盖 Spectra batch pipeline 的 LLM 调用路径
- 新增 fixture 目录 `tests/fixtures/e2e/`，放置预录的测试项目结构
- 编写至少 1 个完整 E2E 测试：从 fixture 项目根目录调用 `runBatch()`，验证产物 `graph.json` 的结构字段
- 验证 `graph.json` 顶层结构：`{ graph: { schemaVersion, nodeCount }, nodes: [...], links: [...] }`
- 验证每个 node 必有 `id / kind / label / metadata` 字段
- 建立 fixture 目录约定，沿用 `tests/fixtures/` 的现有惯例

### Out of Scope

- 不验证 LLM 生成内容（摘要文本、语义描述等）
- 不新增或修改生产代码（`src/` 目录下的任何文件）
- 不覆盖所有 batch pipeline 变体（多语言、大型项目等），MVP 仅一个 fixture
- 不引入新的外部依赖（复用 vitest 现有能力）
- 不覆盖 `spectra diff` 或 `spectra generate` CLI 路径（仅 batch）
- 不修改现有 unit / integration / golden-master / self-hosting 四个 project 的配置

---

## 3. 技术方案

### 3.1 LLM Mock 拦截策略

由于 `src/batch/batch-orchestrator.ts` 的主干路径无 DI 注入槽，采用**模块级 mock**方案：

```
vi.mock('@anthropic-ai/sdk')
process.env.ANTHROPIC_API_KEY = 'test-key'
```

Mock 策略要点：
- `beforeAll` 中设置 `process.env.ANTHROPIC_API_KEY = 'test-key'`，防止 SDK 因缺少 key 而提前 throw
- mock 的 `messages.create` 返回预定义的结构化响应，格式与真实 Claude API 响应一致
- mock 响应内容可为固定字符串（如空摘要或占位符），仅需确保 pipeline 的后续解析步骤不 crash
- `afterAll` 中清理 `process.env.ANTHROPIC_API_KEY`，避免污染其他测试

### 3.2 Fixture 目录结构

沿用 `tests/fixtures/` 现有惯例，新增 E2E 专属子目录：

```
tests/
  fixtures/
    e2e/
      small-ts-project/          # MVP fixture：小型 TypeScript 项目
        src/
          index.ts               # 1-2 个简单 TS 文件，足以产生节点
          utils.ts
        tsconfig.json
        package.json
  e2e/
    batch-pipeline.e2e.test.ts   # E2E 测试文件
```

fixture 项目要求：
- 包含 2-5 个 TypeScript 文件，确保 batch pipeline 能产生至少 1 个有效 node
- 文件之间有至少 1 个 import 关系，确保 `links` 数组非空
- 不依赖外部 npm 包（避免在 CI 中需要 install）

### 3.3 vitest Project 配置

在 `vitest.config.ts` 的 `projects` 数组中新增：

```typescript
{
  test: {
    name: 'e2e',
    include: ['tests/e2e/**/*.e2e.test.ts'],
    testTimeout: 60_000,   // batch pipeline 比 unit 慢，60s 足够 small fixture
    setupFiles: ['tests/e2e/setup.ts'],  // 可选：集中放 env 清理逻辑
  },
}
```

文件命名约定：E2E 测试文件使用 `.e2e.test.ts` 后缀，与 `unit`（`.test.ts`）和 `integration`（`.test.ts`）在语义上区分。

---

## 4. 接口定义

### 4.1 新增 npm scripts

| script | 命令 | 说明 |
|--------|------|------|
| `test:e2e` | `vitest run --project e2e` | 仅跑 E2E 测试，CI 专用入口 |

现有 `test` script（`vitest run`，跑全部 project）保持不变；`test:e2e` 作为独立入口供 CI job 单独调用。

### 4.2 vitest.config.ts 变更

- **新增** `projects` 数组中的 `e2e` project 条目（见 3.3）
- **不修改** 其他四个 project 的配置
- **不修改** coverage 配置（E2E 测试不纳入覆盖率统计）

### 4.3 新增文件清单

| 文件路径 | 类型 | 说明 |
|----------|------|------|
| `tests/e2e/batch-pipeline.e2e.test.ts` | 测试文件 | E2E 主测试，含 LLM mock |
| `tests/fixtures/e2e/small-ts-project/src/index.ts` | fixture | 入口文件 |
| `tests/fixtures/e2e/small-ts-project/src/utils.ts` | fixture | 工具文件（被 index.ts import） |
| `tests/fixtures/e2e/small-ts-project/tsconfig.json` | fixture | TS 配置 |
| `tests/fixtures/e2e/small-ts-project/package.json` | fixture | 最小 package.json |

---

## 5. 验收标准

### SC-001：E2E 测试可在 CI 零 API Key 环境运行

**规模前提**：`small-ts-project` fixture（2-5 个文件，1 个 import 关系）

**验收条件**：在未设置 `ANTHROPIC_API_KEY` 环境变量的 CI 环境中，执行 `npm run test:e2e`，测试套件全部通过（零失败、零跳过）。

**不可接受**：测试因缺少 API Key 而 throw 或被 skip。

---

### SC-002：batch pipeline 完整执行不 crash

**规模前提**：`small-ts-project` fixture（2-5 个文件，1 个 import 关系）

**验收条件**：调用 `runBatch(fixtureProjectRoot, options)` 正常返回，不抛出任何 Error，不输出 `FATAL` 或 `Error:` 级别日志。

**不可接受**：pipeline 因 mock 响应格式错误、路径解析失败等原因中途 crash。

---

### SC-003：graph.json 顶层结构符合合约

**规模前提**：`small-ts-project` fixture（2-5 个文件，1 个 import 关系）

**验收条件**：`runBatch()` 产出的 `graph.json` 满足以下结构断言（使用 `expect().toMatchObject()` 或逐字段断言）：

```
{
  graph: {
    schemaVersion: <string>,
    nodeCount: <number>
  },
  nodes: <array>,
  links: <array>
}
```

**不可接受**：`graph` 顶层 key 缺失、`nodes` 或 `links` 字段不为数组。

---

### SC-004：每个 node 必有规定字段

**规模前提**：`small-ts-project` fixture（2-5 个文件，1 个 import 关系），产出 nodes 数量 ≥ 1

**验收条件**：`nodes` 数组中每个元素均包含 `id`、`kind`、`label`、`metadata` 四个字段，且 `id` 为非空字符串。

**不可接受**：任意 node 缺少上述四个字段中的任何一个。

---

### SC-005：nodeCount 与 nodes 数组长度一致

**规模前提**：`small-ts-project` fixture（2-5 个文件，1 个 import 关系）

**验收条件**：`graph.nodeCount === nodes.length`，确保 metadata 字段与实际数据不存在偏差。

**不可接受**：`nodeCount` 与 `nodes.length` 不相等。

---

### SC-006：test:e2e script 存在且可独立调用

**验收条件**：`package.json` 中存在 `test:e2e` script，执行 `npm run test:e2e` 仅运行 `e2e` project，不触发 `unit` / `integration` / `golden-master` / `self-hosting` 的任何测试。

---

### SC-007：不修改现有测试零回归

**验收条件**：在新增 E2E 测试基础设施后，执行 `npx vitest run`（全 project）的通过率与引入前持平，无新增失败。

---

## 6. 错误处理与边界场景

### 边界场景 1：mock LLM 响应格式错误导致 pipeline 解析 crash

- **场景**：`vi.mock('@anthropic-ai/sdk')` 返回的响应体缺少 `content[0].text` 字段
- **预期行为**：测试失败（SC-002 断言捕获），而不是测试本身 timeout 或进程 hang
- **处理策略**：在 mock 实现中明确返回符合 `Message` 类型结构的响应；参考真实 SDK 的 TypeScript 类型定义

### 边界场景 2：fixture 项目路径不存在

- **场景**：`runBatch()` 接收到错误的 fixture 路径
- **预期行为**：`runBatch()` 抛出可识别的错误（如 `ENOENT`），测试在 `expect` 阶段明确 catch 并 fail，不产生误报 pass
- **处理策略**：在 `beforeAll` 中用 `fs.existsSync()` 断言 fixture 目录存在，提前 fail 并给出明确错误信息

### 边界场景 3：E2E 测试污染其他测试的 env

- **场景**：`process.env.ANTHROPIC_API_KEY = 'test-key'` 设置后未清理，影响同 worker 中的后续测试
- **预期行为**：无跨测试污染
- **处理策略**：在 `afterAll` 中 `delete process.env.ANTHROPIC_API_KEY`；或使用 vitest 的 `setupFiles` 集中管理

### 边界场景 4：nodes 数组为空（fixture 项目过于简单，未产生节点）

- **场景**：batch pipeline 成功运行但未解析出任何节点
- **预期行为**：SC-004 断言 trivially pass（空数组不违反"每个 node 必有规定字段"），但 SC-005 需要 `nodeCount === 0` 也通过
- **处理策略**：fixture 设计时确保至少 2 个有 import 关系的文件，令 `nodes.length >= 1`；在测试中加 `expect(nodes.length).toBeGreaterThan(0)` 断言

---

## 7. 实现计划（高层）

**Step 1：fixture 准备**
创建 `tests/fixtures/e2e/small-ts-project/`，包含 2-3 个最小 TypeScript 文件及配置文件。确保文件间有 import 关系，`tsconfig.json` 指向 `src/`。

**Step 2：vitest project 注册**
在 `vitest.config.ts` 的 `projects` 数组中追加 `e2e` project 配置；在 `package.json` `scripts` 中新增 `test:e2e`。

**Step 3：E2E 测试文件骨架**
创建 `tests/e2e/batch-pipeline.e2e.test.ts`，完成：`vi.mock('@anthropic-ai/sdk')` 声明、mock 实现（返回固定响应）、`process.env` 设置与清理。

**Step 4：pipeline 调用与断言**
在测试中调用 `runBatch(fixtureProjectRoot, { ... })`，读取产出的 `graph.json`，逐一执行 SC-003 ~ SC-005 的结构断言。

**Step 5：CI 验证与回归确认**
执行 `npm run test:e2e` 确认全通过；执行 `npx vitest run` 确认现有测试零回归（SC-007）。

---

## 8. 测试策略

### 测试层次划分

| 层次 | 目录 | mock 策略 | 验证目标 |
|------|------|-----------|---------|
| unit | `tests/unit/` | 函数级 mock | 单函数逻辑正确性 |
| integration | `tests/integration/` | 部分 mock | 模块间协作 |
| **e2e（本 Feature）** | `tests/e2e/` | 模块级 LLM mock | pipeline 端到端数据流 |
| golden-master | `tests/golden-master/` | 无 mock | 输出快照一致性 |

### 本 Feature 测试覆盖范围

- **E2E 测试覆盖**：`tests/e2e/batch-pipeline.e2e.test.ts`（本 Feature 新增）
- **不新增 unit 测试**：本 Feature 不修改生产代码，无需补充单元测试
- **不影响 golden-master**：golden-master 依赖真实 LLM 输出，不纳入本 Feature 范围

### mock 响应设计原则

- mock 返回的响应必须通过 SDK 的 TypeScript 类型检查（`Anthropic.Message` 类型）
- 响应 `content[0].type === 'text'`，`text` 为有效 JSON 字符串（符合 pipeline 期望的解析格式）
- 不在 mock 中硬编码具体节点数量，让 pipeline 自行从 fixture 代码中解析节点

---

## 9. 依赖关系

### 前置依赖

| 依赖项 | 状态 | 说明 |
|--------|------|------|
| `vitest` | 已有 | 现有 devDependency，无需新增 |
| `@anthropic-ai/sdk` | 已有 | production dependency，`vi.mock` 拦截 |
| `runBatch()` 函数签名 | 已有 | `src/batch/batch-orchestrator.ts` 导出 |
| `tests/fixtures/` 目录约定 | 已有 | 沿用 `multilang-project/` 的惯例 |

### 零新外部依赖

本 Feature 不引入任何新的 npm 依赖。所有能力（模块 mock、文件断言、测试组织）均通过 vitest 内置能力实现。

### 后续 Feature 依赖本 Feature

- 未来的 E2E 覆盖扩展（多语言 fixture、大项目 fixture）可直接复用本 Feature 建立的目录约定和 vitest project 配置
- golden-master 测试若需要拆分 CI job，可参考本 Feature 的 `--project` 调用模式

---

## 复杂度评估（供 GATE_DESIGN 审查）

| 维度 | 数值 / 状态 | 说明 |
|------|------------|------|
| **组件总数** | 2 | 新增 E2E vitest project + fixture 目录（均为测试基础设施，非生产组件） |
| **接口数量** | 2 | `test:e2e` npm script + vitest project 配置条目 |
| **依赖新引入数** | 0 | 零新 npm 依赖 |
| **跨模块耦合** | 否 | 不修改任何现有模块接口 |
| **复杂度信号** | 无 | 无递归结构、状态机、并发控制、数据迁移 |
| **总体复杂度** | **LOW** | 组件 < 3，接口 < 4，无复杂度信号 |

**判定依据**：组件 2 < 3，接口 2 < 4，无复杂度信号 → LOW。GATE_DESIGN 可自动放行，无需人工审查。
