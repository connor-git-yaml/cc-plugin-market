---
feature: 025-multilang-adapter-layer
title: 任务清单
status: Draft
created: 2026-03-17
spec: spec.md
plan: plan.md
---

# 任务清单: 语言适配器抽象层（LanguageAdapter）

## 概述

按 plan.md 中的 5 步增量实施顺序组织任务。每步独立可测试、可回滚。

**总任务数**：40 个
**预估新增代码**：~780 行（源码）+ ~650 行（测试）
**关键约束**：零行为变更 · 零新增运行时依赖 · 现有 42 个测试文件全部通过

---

## Phase 1: Setup（基础设施准备）

> 对应 plan.md Step 1 前置工作：确认现有代码结构，建立测试基线，创建目录骨架。

- [x] T001 [P] 确认现有 42 个测试文件全部通过，记录基线通过数作为回归对比依据
  - 执行：`npm test && npm run lint`
  - 输出：测试通过报告（控制台输出）

- [x] T002 [P] 使用 grep 全局梳理所有 `switch.*language`、`=== 'typescript'`、`=== 'javascript'` 出现位置，建立改造待办清单（tech-research.md §5.3 风险 1 缓解）
  - 涉及文件：`src/` 目录全局搜索

- [x] T003 [P] 创建 `src/adapters/` 目录骨架（空目录 + .gitkeep 或直接在 T004 中创建文件）
  - 输出路径：`src/adapters/`

- [x] T004 [P] 创建 `tests/adapters/` 目录骨架
  - 输出路径：`tests/adapters/`

---

## Phase 2: Foundational（LanguageAdapter 接口 + Registry + 接口层测试）

> 对应 plan.md Step 1：纯新增，零改动现有代码。

### 2.1 接口定义

- [x] T005 [US1,US2,US5] 新增 `src/adapters/language-adapter.ts`：定义 `LanguageAdapter` 接口（含 `id`、`languages`、`extensions`、`defaultIgnoreDirs`、`analyzeFile`、`analyzeFallback`、`buildDependencyGraph?`、`getTerminology`、`getTestPatterns` 所有字段和方法）
  - 文件路径：`src/adapters/language-adapter.ts`
  - 覆盖 FR：FR-001, FR-002, FR-003, FR-004, FR-005, FR-006

- [x] T006 [US1,US2] 在 `src/adapters/language-adapter.ts` 中定义辅助类型：`LanguageTerminology`、`TestPatterns`、`AnalyzeFileOptions`、`DependencyGraphOptions`
  - 文件路径：`src/adapters/language-adapter.ts`
  - 覆盖 FR：FR-005, FR-006

### 2.2 Registry 实现

- [x] T007 [US2,US5] 新增 `src/adapters/language-adapter-registry.ts`：实现 `LanguageAdapterRegistry` 单例类，含 `getInstance()`、`resetInstance()`、`register()`、`getAdapter()`、`getSupportedExtensions()`、`getDefaultIgnoreDirs()`、`getAllAdapters()` 七个方法
  - 文件路径：`src/adapters/language-adapter-registry.ts`
  - 关键实现：`getAdapter()` 使用 `path.extname(filePath).toLowerCase()` 转小写后查 Map（O(1)，大小写不敏感）
  - 关键实现：`register()` 对每个扩展名检查冲突，冲突时抛出含冲突扩展名和占用适配器 id 的 `Error`
  - 关键实现：`resetInstance()` 将静态 `instance` 设为 `null`
  - 覆盖 FR：FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013

### 2.3 导出入口（空壳）

- [x] T008 新增 `src/adapters/index.ts`：仅导出接口、类型、Registry（`bootstrapAdapters()` 在 T014 中完善）
  - 文件路径：`src/adapters/index.ts`
  - 参考 data-model.md §8 导出清单

### 2.4 Registry 单元测试

- [x] T009 [P] 新增 `tests/adapters/language-adapter-registry.test.ts`：编写 Registry 单元测试（约 10 个用例）
  - 文件路径：`tests/adapters/language-adapter-registry.test.ts`
  - 测试场景：
    - 单例保证：连续两次 `getInstance()` 返回 `===` 同一引用
    - `resetInstance()` 后 `getInstance()` 返回新实例
    - 新实例 `getAllAdapters()` 返回空数组
    - 新实例 `getAdapter(anyFile)` 返回 null
    - 注册适配器后 `getAdapter('.ts 文件')` 返回正确适配器
    - 扩展名大小写不敏感：`getAdapter('Foo.TS')` 返回正确适配器
    - 无扩展名文件 `getAdapter('Makefile')` 返回 null
    - 冲突注册抛出 Error（含冲突扩展名和原适配器 id）
    - `getSupportedExtensions()` 返回所有已注册扩展名
    - `getDefaultIgnoreDirs()` 聚合所有适配器的忽略目录
  - 覆盖 FR：FR-007~FR-013；覆盖 US5 验收场景 1；覆盖 Edge Cases（无扩展名返回 null、单例保证、resetInstance）
  - 每个测试用例前后执行 `LanguageAdapterRegistry.resetInstance()`（registry-lifecycle.md §3）

- [x] T010 验证门：运行 `npm test` 确认新增测试全部通过，现有 42 个测试文件不受影响

---

## Phase 3: US1 — TS/JS 用户无感知升级（TsJsLanguageAdapter 封装）

> 对应 plan.md Step 2：提取现有 TS/JS 逻辑到适配器，零行为变更。

### 3.1 TsJsLanguageAdapter 实现

- [x] T011 [US1] 新增 `src/adapters/ts-js-adapter.ts`：实现 `TsJsLanguageAdapter` 类，声明 `id = 'ts-js'`、`languages`、`extensions`（`.ts/.tsx/.js/.jsx` 四种）、`defaultIgnoreDirs`（`node_modules/dist/build/coverage/.next/.nuxt`）
  - 文件路径：`src/adapters/ts-js-adapter.ts`
  - 覆盖 FR：FR-014, FR-015, FR-021

- [x] T012 [US1] 在 `TsJsLanguageAdapter` 中实现 `analyzeFile()`：委托调用 `ast-analyzer.ts` 内部的 TS/JS 分析函数（不修改 `ast-analyzer.ts`，仅做委托包装）
  - 文件路径：`src/adapters/ts-js-adapter.ts`
  - 关键约束：与 `ast-analyzer.analyzeFile()` 行为完全一致（FR-016）
  - 覆盖 FR：FR-016

- [x] T013 [US1] 在 `TsJsLanguageAdapter` 中实现 `analyzeFallback()`：委托调用 `tree-sitter-fallback.ts` 内部的正则降级函数（不修改原文件）
  - 文件路径：`src/adapters/ts-js-adapter.ts`
  - 关键约束：与 `tree-sitter-fallback.analyzeFallback()` 行为完全一致（FR-017）
  - 覆盖 FR：FR-017

- [x] T014 [US1] 在 `TsJsLanguageAdapter` 中实现 `buildDependencyGraph()`：委托调用 `dependency-graph.ts` 的 `buildGraph()`，进行 options 字段名映射（`configPath` → `tsConfigPath`）
  - 文件路径：`src/adapters/ts-js-adapter.ts`
  - 覆盖 FR：FR-018

- [x] T015 [US1] 在 `TsJsLanguageAdapter` 中实现 `getTerminology()`：返回静态 TS/JS 术语对象（`codeBlockLanguage: 'typescript'`，与当前 `context-assembler.ts` 硬编码值一致）
  - 文件路径：`src/adapters/ts-js-adapter.ts`
  - 覆盖 FR：FR-019

- [x] T016 [US1] 在 `TsJsLanguageAdapter` 中实现 `getTestPatterns()`：返回 TS/JS 测试文件匹配模式（`filePattern: /\.(test|spec)\.(ts|tsx|js|jsx)$/`，与当前 `secret-redactor.ts` 正则一致；`testDirs: ['__tests__', 'tests', 'test', '__mocks__']`，与 `dependency-graph.ts` `excludePatterns` 一致）
  - 文件路径：`src/adapters/ts-js-adapter.ts`
  - 覆盖 FR：FR-020

- [x] T017 更新 `src/adapters/index.ts`：新增 `TsJsLanguageAdapter` 导出；实现 `bootstrapAdapters()` 函数（幂等，注册 `TsJsLanguageAdapter` 到 Registry；`getAllAdapters().length > 0` 时跳过）
  - 文件路径：`src/adapters/index.ts`
  - 覆盖 FR：FR-033

### 3.2 TsJsLanguageAdapter 单元测试

- [x] T018 [P] 新增 `tests/adapters/ts-js-adapter.test.ts`：编写 TsJsLanguageAdapter 静态属性单元测试（约 6 个用例）
  - 文件路径：`tests/adapters/ts-js-adapter.test.ts`
  - 测试场景：
    - `id` 为 `'ts-js'`
    - `extensions` 集合包含且仅包含 `.ts/.tsx/.js/.jsx`
    - `languages` 包含 `'typescript'` 和 `'javascript'`
    - `defaultIgnoreDirs` 包含 `node_modules` 等 6 个目录
    - `getTerminology().codeBlockLanguage` 为 `'typescript'`
    - `getTestPatterns().filePattern` 正确匹配 `.test.ts`、`.spec.jsx` 等
  - 覆盖 FR：FR-014, FR-015, FR-019, FR-020, FR-021

- [x] T019 新增 `tests/adapters/ts-js-adapter-equivalence.test.ts`：编写 TsJsLanguageAdapter 行为等价性测试（约 4 个用例）
  - 文件路径：`tests/adapters/ts-js-adapter-equivalence.test.ts`
  - 测试场景：
    - 对同一 `.ts` 文件，`adapter.analyzeFile()` 与直接调用 `ast-analyzer.analyzeFile()` 产出完全一致的 CodeSkeleton
    - 对同一 `.js` 文件，同上
    - `adapter.analyzeFallback()` 与直接调用 `tree-sitter-fallback.analyzeFallback()` 产出完全一致
    - `adapter.buildDependencyGraph()` 与直接调用 `dependency-graph.buildGraph()` 产出完全一致
  - 覆盖 FR：FR-016, FR-017, FR-018；覆盖 SC-002（等价性验证）

- [x] T020 验证门：运行 `npm test` 确认全量通过，等价性测试无 diff

---

## Phase 4: US2 — 语言适配器开发者注册新语言（编排器路由接入）

> 对应 plan.md Step 4a-f：将编排器和各工具层改为通过 Registry 路由。

### 4.1 file-scanner 参数化（Step 4a）

- [x] T021 [US2,US3] 修改 `src/utils/file-scanner.ts`：`ScanOptions` 新增可选 `extensions?: Set<string>` 字段；`SUPPORTED_EXTENSIONS` 改为从 `LanguageAdapterRegistry.getInstance().getSupportedExtensions()` 动态获取（当 `options.extensions` 存在时优先使用）
  - 文件路径：`src/utils/file-scanner.ts`
  - 覆盖 FR：FR-027, FR-029

- [x] T022 [US3] 修改 `src/utils/file-scanner.ts`：`DEFAULT_IGNORE_DIRS` 改为 `UNIVERSAL_IGNORE_DIRS`（`.git`、`coverage`）+ Registry 聚合的适配器忽略目录合并
  - 文件路径：`src/utils/file-scanner.ts`
  - 覆盖 FR：FR-028

- [x] T023 [US3] 修改 `src/utils/file-scanner.ts`：`ScanResult` 新增可选 `unsupportedExtensions?: Map<string, number>` 字段；在 `scanFiles()` 中收集不支持的文件扩展名统计，结束前若 `unsupportedExtensions.size > 0` 则向 `stderr` 输出 `warn` 级聚合提示（格式：`⚠ 跳过 N 个 .ext 文件（不支持的语言）`）
  - 文件路径：`src/utils/file-scanner.ts`
  - 覆盖 FR：FR-027；覆盖 US3 验收场景 1、2；覆盖 Edge Cases（混合语言目录）

### 4.2 ast-analyzer 路由改造（Step 4b）

- [x] T024 [US2] 修改 `src/core/ast-analyzer.ts`：`analyzeFile()` 内部逻辑改为先通过 `Registry.getAdapter(filePath)` 获取适配器，再调用 `adapter.analyzeFile()`；如果 Registry 返回 null，抛出 `UnsupportedFileError`（复用现有错误类型）；移除内部 `SUPPORTED_EXTENSIONS`、`getLanguage()`、`isSupportedFile()` 常量/函数；保持 `analyzeFile()` 公共 API 签名不变
  - 文件路径：`src/core/ast-analyzer.ts`
  - 关键约束：对 TS/JS 文件，改造后输出与改造前完全一致（FR-035）
  - 覆盖 FR：FR-030；覆盖 Edge Cases（Registry 无适配器时明确报错 FR-034）

### 4.3 dependency-graph 路由改造（Step 4c）

- [x] T025 [US2] 修改 `src/graph/dependency-graph.ts`：`buildGraph()` 保留公共 API 签名不变；内部改为通过 Registry 获取支持 `buildDependencyGraph` 的适配器列表，委托调用；测试文件排除模式从 `adapter.getTestPatterns()` 获取（替换硬编码的 TS/JS 扩展名过滤正则）
  - 文件路径：`src/graph/dependency-graph.ts`
  - 关键约束：当前仅 TsJsLanguageAdapter 提供此方法，行为不变
  - 覆盖 FR：FR-031

### 4.4 编排器参数化（Step 4d）

- [x] T026 [US2,US3] 修改 `src/core/single-spec-orchestrator.ts`：错误消息从 `'目标路径中未找到 TS/JS 文件'` 改为 `'目标路径中未找到支持的源文件'`；其他逻辑通过 ast-analyzer 的 Registry 路由透明获得（ast-analyzer 内部已路由）
  - 文件路径：`src/core/single-spec-orchestrator.ts`
  - 覆盖 FR：FR-032；覆盖 US3 验收场景 2

- [x] T027 [US2] 修改 `src/batch/batch-orchestrator.ts`：`buildGraph()` 调用保持不变（dependency-graph.ts 内部已通过 Registry 路由，此处无需显式修改；确认无需改动或做微调）
  - 文件路径：`src/batch/batch-orchestrator.ts`
  - 覆盖 FR：FR-031

### 4.5 消费端最小改造（Step 4e，Q1 选项 C）

- [x] T028 [US1] 修改 `src/core/context-assembler.ts`：`formatSkeleton()` 中代码块标记从硬编码 `` ```typescript `` 改为 `` ```${skeleton.language} ``；`formatSnippets()` 中同理处理（通过闭包或新增参数传入 language，不改变 `assembleContext()` 公共签名）
  - 文件路径：`src/core/context-assembler.ts`
  - 关键约束：TS/JS 文件的 `skeleton.language` 为 `'typescript'`，输出与改造前一致（FR-035）
  - 覆盖 FR：FR-035（消费端参数化）

- [x] T029 [US1] 修改 `src/core/secret-redactor.ts`：`isTestFile()` 改为从 Registry 获取所有适配器的 `getTestPatterns()`，合并 `filePattern` 后匹配（替换硬编码的 TS/JS 正则）
  - 文件路径：`src/core/secret-redactor.ts`
  - 关键约束：TsJsLanguageAdapter 的 `TestPatterns.filePattern` 与原硬编码正则完全一致，TS/JS 输出不变
  - 覆盖 FR：FR-035（消费端参数化）

- [x] T030 [US1] 修改 `src/diff/semantic-diff.ts`：代码块标记改为从 `skeleton.language` 动态获取（替换硬编码的 `` ```typescript ``）
  - 文件路径：`src/diff/semantic-diff.ts`
  - 关键约束：TS/JS skeleton 输出不变
  - 覆盖 FR：FR-035（消费端参数化）

### 4.6 CLI / MCP 启动注册（Step 4f）

- [x] T031 [US1,US2] 修改 `src/cli/index.ts`：在 `main()` 函数顶部、命令调度前调用 `bootstrapAdapters()`
  - 文件路径：`src/cli/index.ts`
  - 覆盖 FR：FR-033

- [x] T032 [US1,US2] 修改 `src/mcp/server.ts`：在 `createMcpServer()` 顶部调用 `bootstrapAdapters()`
  - 文件路径：`src/mcp/server.ts`
  - 覆盖 FR：FR-033

- [x] T033 验证门：运行 `npm test` 确认全量通过，零 diff（重点关注 file-scanner、ast-analyzer 相关测试）

---

## Phase 5: US3 — 非支持语言文件友好提示

> Phase 4 已完成提示机制实现（T023），本 Phase 补充针对性测试验证。

- [x] T034 [P,US3] 在 `file-scanner` 相关测试文件中新增混合语言目录测试用例（约 3 个用例）：
  - 涉及文件：现有 `tests/utils/file-scanner.test.ts`（或对应测试文件）
  - 测试场景：
    - 混合目录（含 `.ts` 和 `.py` 文件），`.py` 被跳过，`unsupportedExtensions.get('.py')` 为正确计数
    - 混合目录，`ScanResult.files` 仅含 `.ts` 文件（符合 US3 验收场景 1）
    - 仅含不支持语言文件的目录，`ScanResult.files` 为空
  - 覆盖 FR：FR-027；覆盖 US3 所有验收场景；覆盖 Edge Cases（混合扩展名）

---

## Phase 6: US4 — CodeSkeleton 数据模型前向兼容

> 对应 plan.md Step 3：纯扩展，前向兼容。

- [x] T035 [P,US4] 修改 `src/models/code-skeleton.ts`：
  - `LanguageSchema` 从 2 值扩展到 10 值（新增 `python/go/java/rust/kotlin/cpp/ruby/swift`）
  - `ExportKindSchema` 从 7 值扩展到 12 值（新增 `struct/trait/protocol/data_class/module`）
  - `MemberKindSchema` 从 5 值扩展到 8 值（新增 `classmethod/staticmethod/associated_function`）
  - `filePath` 正则从 4 扩展名放宽到 20 扩展名
  - 文件路径：`src/models/code-skeleton.ts`
  - 覆盖 FR：FR-022, FR-023, FR-024, FR-025, FR-026

- [x] T036 [P,US4] 新增 `tests/models/code-skeleton-compat.test.ts`：编写 CodeSkeleton 兼容性测试（约 8 个用例）
  - 文件路径：`tests/models/code-skeleton-compat.test.ts`
  - 测试场景：
    - 旧值 `language: 'typescript'` parse 成功
    - 旧值 `language: 'javascript'` parse 成功
    - 新值 `language: 'python'` parse 成功
    - 新值 `language: 'go'` parse 成功
    - 非法值 `language: 'unknown'` parse 失败（ZodError）
    - 旧值 `kind: 'function'` parse 成功
    - 新值 `kind: 'struct'` parse 成功
    - 旧版 filePath `'src/foo.ts'` 通过新正则验证
    - 新语言 filePath `'src/main.py'` 通过新正则验证
  - 覆盖 FR：FR-022~FR-026；覆盖 US4 所有验收场景；覆盖 SC-004

- [x] T037 验证门：运行 `npm test` 全量通过，特别关注现有 `tests/models/code-skeleton.test.ts`

---

## Phase 7: US5 — Registry 扩展名冲突检测

> 冲突检测已在 T007（Registry 实现）和 T009（Registry 测试）中实现，本 Phase 确认端到端验证覆盖完整。

- [x] T038 [US5] 确认 `tests/adapters/language-adapter-registry.test.ts` 中冲突测试覆盖所有必要场景：
  - `TsJsLanguageAdapter` 已注册 `.ts` 时，尝试注册另一个声明 `.ts` 的适配器，抛出 Error
  - Error 消息含冲突扩展名（`.ts`）和原适配器 id（`'ts-js'`）
  - 冲突注册失败后，Registry 状态不受污染（部分成功的扩展名是否回滚 — 根据 plan.md 实现决策记录）
  - 覆盖 FR：FR-009；覆盖 US5 验收场景 1

---

## Phase 8: Polish & Cross-Cutting（全面验收与收尾）

> 对应 plan.md Step 5：端到端验证 + Golden-Master 测试。

### 8.1 Mock 适配器集成验证（SC-003）

- [x] T039 [US2] 在 `tests/adapters/` 中新增集成测试（或扩展等价性测试文件），编写 Mock 适配器验证（约 3 个用例）：
  - 文件路径：`tests/adapters/ts-js-adapter-equivalence.test.ts`（扩展）或新建 `tests/adapters/registry-integration.test.ts`
  - 测试场景：
    - 编写 `MockLanguageAdapter`，声明支持 `.mock` 扩展名
    - 注册后 `registry.getAdapter('example.mock')` 返回该适配器（US2 验收场景 1）
    - `file-scanner` 扫描含 `.mock` 文件的目录，`.mock` 文件出现在 `ScanResult.files`（US2 验收场景 2）
    - 编排器路由 `.mock` 文件时调用 mock 适配器的 `analyzeFile`，而非 ts-morph 逻辑（US2 验收场景 3）
  - 覆盖 SC-003；覆盖 US2 所有验收场景；覆盖 FR-030

### 8.2 依赖审计与测试数量审计

- [x] T040 [P] 执行验收审计清单：
  - 依赖审计（SC-005）：确认 `package.json` 的 `dependencies` 字段在 Feature 前后完全一致
  - 测试数量审计（SC-007）：统计新增单元测试用例数 >= 20 个
  - 运行完整测试套件并确认：全部 42+ 个测试文件通过，零跳过，零失败（SC-001）
  - 执行 `npm run lint` 确认代码风格合规

---

## 依赖关系与并行说明

### 串行依赖链（必须按序）

```
T001~T004（Setup）
  → T005~T008（接口定义）
    → T009~T010（Registry 测试）
      → T011~T017（TsJsLanguageAdapter）
        → T018~T020（适配器测试）
          ┌→ T021~T023（file-scanner，Step 4a）
          ├→ T024（ast-analyzer，Step 4b）
          ├→ T025（dependency-graph，Step 4c）
          ├→ T026~T027（编排器，Step 4d）
          └→ T028~T032（消费端 + CLI/MCP，Step 4e/4f）
            → T033（验证门）
              → T034（US3 补充测试）
              → T035~T037（CodeSkeleton 扩展，Step 3）
                → T038（US5 冲突确认）
                  → T039~T040（全面验收）
```

> 注意：plan.md 建议 Step 3（CodeSkeleton 扩展）在 Step 2 之后，但在 Step 4 之前执行。实际上 T035-T037 可以在 T020 之后、T033 之前并行进行，因为 CodeSkeleton 扩展是纯增量操作，不影响 Step 4 的路由改造。

### 可并行任务（标注 [P]）

| 并行组 | 任务 | 说明 |
|--------|------|------|
| 组 A | T001, T002, T003, T004 | Setup 阶段全部可并行 |
| 组 B | T009, T018, T019 | 测试编写可与实现交叉进行（TDD 风格） |
| 组 C | T021~T025 | Step 4a-4c 三个改造可并行（均依赖 T017 完成） |
| 组 D | T034, T035~T037 | 补充测试可并行进行 |
| 组 E | T040 | 审计任务可并行于最后一轮全量测试 |

---

## FR 覆盖映射表

确保 spec.md 中 FR-001 ~ FR-036 100% 覆盖。

| FR | 描述摘要 | 覆盖任务 |
|----|---------|---------|
| FR-001 | LanguageAdapter 接口定义（含所有能力字段） | T005 |
| FR-002 | 接口声明 analyzeFile 文件分析能力 | T005 |
| FR-003 | 接口声明 analyzeFallback 降级分析能力 | T005 |
| FR-004 | 接口声明可选 buildDependencyGraph 能力 | T005, T006 |
| FR-005 | 接口声明 getTerminology 语言术语映射 | T005, T006 |
| FR-006 | 接口声明 getTestPatterns 测试文件匹配模式 | T005, T006 |
| FR-007 | Registry 按文件扩展名查找适配器 | T007 |
| FR-008 | Registry 支持注册适配器（扩展名→实例映射） | T007 |
| FR-009 | Registry 注册时检测扩展名冲突 | T007, T038 |
| FR-010 | Registry 提供查询所有已注册扩展名 | T007 |
| FR-011 | Registry 聚合所有适配器默认忽略目录 | T007 |
| FR-012 | Registry 为单例模式 | T007, T009 |
| FR-013 | Registry 提供 resetInstance() 重置能力 | T007, T009 |
| FR-014 | TsJsLanguageAdapter 实现 LanguageAdapter 接口 | T011 |
| FR-015 | TsJsLanguageAdapter 声明 .ts/.tsx/.js/.jsx | T011, T018 |
| FR-016 | TsJsLanguageAdapter.analyzeFile 与 ast-analyzer 行为完全一致 | T012, T019 |
| FR-017 | TsJsLanguageAdapter.analyzeFallback 与 tree-sitter-fallback 行为完全一致 | T013, T019 |
| FR-018 | TsJsLanguageAdapter 封装 dependency-cruiser 依赖图逻辑 | T014, T019 |
| FR-019 | TsJsLanguageAdapter.getTerminology() 返回 TS/JS 术语映射 | T015, T018 |
| FR-020 | TsJsLanguageAdapter.getTestPatterns() 返回 TS/JS 测试文件模式 | T016, T018 |
| FR-021 | TsJsLanguageAdapter 声明 TS/JS 生态默认忽略目录 | T011, T018 |
| FR-022 | LanguageSchema 扩展为 10 个语言值 | T035, T036 |
| FR-023 | ExportKindSchema 扩展新增 5 个值 | T035, T036 |
| FR-024 | MemberKindSchema 扩展新增 3 个值 | T035, T036 |
| FR-025 | filePath 正则放宽为支持 20 种扩展名 | T035, T036 |
| FR-026 | CodeSkeleton 变更为纯扩展，旧版数据仍通过新 schema 验证 | T035, T036, T037 |
| FR-027 | file-scanner 扩展名从 Registry 动态获取 | T021, T034 |
| FR-028 | file-scanner 默认忽略目录从 Registry 聚合 | T022 |
| FR-029 | file-scanner 支持调用方显式传入扩展名集合 | T021 |
| FR-030 | single-spec-orchestrator 通过 Registry 路由文件分析 | T024, T026, T039 |
| FR-031 | batch-orchestrator 通过 Registry 路由依赖图构建 | T025, T027 |
| FR-032 | 编排器错误消息使用语言无关表述 | T026 |
| FR-033 | CLI 和 MCP 启动时自动完成 TsJsLanguageAdapter 注册 | T017, T031, T032 |
| FR-034 | Registry 未注册适配器时被查询，给出明确错误提示 | T024（UnsupportedFileError）, T009（Registry 空状态测试）|
| FR-035 | 任何 TS/JS 命令输出与 Feature 前完全一致（零行为变更） | T019（等价性）, T028, T029, T030, T033, T040 |
| FR-036 | 不引入任何新运行时依赖，不移除任何现有依赖 | T040（依赖审计）|

**覆盖率**：FR-001 ~ FR-036，共 36 条，全部覆盖（100%）。

---

## SC 覆盖映射表

| SC | 成功标准 | 覆盖任务 |
|----|---------|---------|
| SC-001 | 现有 42 个测试文件 100% 通过 | T010, T020, T033, T037, T040 |
| SC-002 | self-hosting golden-master 零差异 | T019（等价性测试），T040（全量验收） |
| SC-003 | Mock 适配器验证：无需修改核心流水线文件 | T039 |
| SC-004 | 旧版 baseline JSON 被新版 schema 成功解析 | T036, T037 |
| SC-005 | `package.json` `dependencies` 前后一致 | T040 |
| SC-006 | Registry 查找为 O(1)（Map 实现） | T007（Map<string, LanguageAdapter> 实现） |
| SC-007 | 新增单元测试 >= 20 个 | T009(~10) + T018(~6) + T019(~4) + T036(~8) = ~28 个 |

---

## 风险缓解任务对照

| 风险 | 归属步骤 | 缓解任务 |
|------|---------|---------|
| R1: CodeSkeleton 变更导致旧 baseline 失败 | Step 3 | T035, T036, T037 |
| R2: 提取 TsJsLanguageAdapter 时引入隐式行为变更 | Step 2, 5 | T019（等价性）, T020（验证门）, T040 |
| R3: Registry 单例在测试中的状态泄露 | Step 1 | T007（resetInstance），T009（每用例前后重置）|
| R4: file-scanner 参数化后破坏 .gitignore 交互 | Step 4a | T022（UNIVERSAL_IGNORE_DIRS 独立维护 .git），T034 |
| R5: dependency-graph 重构引入 circular import | Step 4c | T025（adapter 通过延迟调用避免循环）|
| R6: 多语言 filePath 正则过于宽松 | Step 3 | T035（仅扩展到已知语言扩展名）|
| R7: 改动量大导致 PR 过大 | 全部 | 按 Phase 分步提交，每 Phase 独立验证门 |
