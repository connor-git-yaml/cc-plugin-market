# TS/JS mini fixture 源码（F217 T041）

供 `tests/fixtures/graph-quality-ts-graph/`（F217 T043 pinned graph）的建图输入，
遵循 `specs/217-graph-quality-gates/plan.md` 决策 6 fixture 合同表（TS/JS 行）：

- `greeter-service.ts`：≥1 个 module 级自由函数（`formatGreeting`）+ ≥1 个 class
  含 ≥2 member（`GreeterService`：`greet` / `buildMessage` / `lastMessage`）+
  ≥1 个 interface（`GreetingOptions`）+ ≥1 个 type 声明（`GreetingResult`）；
  `greet` 调用 `buildMessage`（class 内方法间调用关系，驱动 `calls` 边非空）。
- `greeter-service.test.ts`：测试文件样本，符合 `TsJsLanguageAdapter.getTestPatterns()`
  （`/\.(test|spec)\.(ts|tsx|js|jsx)$/`）。

本目录不与 `tests/fixtures/multilang-project/` 复用（FR-024，MUST NOT）。

本文件（`README.md`）不参与建图扫描（非受支持源码扩展名），仅作说明文档。
