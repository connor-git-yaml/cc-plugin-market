# 需求质量检查表

> Feature: 025-multilang-adapter-layer | 检查日期: 2026-03-16
> 检查输入: spec.md, research/tech-research.md
> 检查配置: quality-first preset

---

## 1. User Story 验收场景完备性（Given-When-Then）

| User Story | 有 GWT 场景 | 场景数量 | 判定 | 备注 |
|------------|:-----------:|:-------:|:----:|------|
| US-1: TS/JS 用户无感知升级 (P1) | Yes | 3 | PASS | 覆盖 generate、batch、npm test 三个维度 |
| US-2: 语言适配器开发者注册新语言 (P1) | Yes | 3 | PASS | 覆盖 Registry 注册、file-scanner 识别、编排器路由 |
| US-3: 非支持语言文件的友好提示 (P2) | Yes | 2 | PASS | 覆盖混合目录和纯不支持目录两种场景 |
| US-4: CodeSkeleton 数据模型前向兼容 (P2) | Yes | 2 | PASS | 覆盖 schema 解析和 drift 检测两个维度 |
| US-5: Registry 扩展名冲突检测 (P3) | Yes | 1 | WARN | 仅覆盖"冲突时抛错"场景；**建议补充**：注册成功（无冲突）的正向场景，以及同一适配器重复注册的幂等/报错行为 |

**小结**: 5/5 User Story 均有 GWT 验收场景。US-5 场景略薄，建议补充正向路径和重复注册边界。

---

## 2. 功能需求可测试性

| FR | 描述摘要 | 可测试 | 判定 | 备注 |
|----|---------|:------:|:----:|------|
| FR-001 | LanguageAdapter 接口定义 | Yes | PASS | 可通过 TypeScript 编译时检查 + 结构断言验证 |
| FR-002 | 文件分析能力声明 | Yes | PASS | 可验证方法签名和返回类型 |
| FR-003 | 正则降级分析能力 | Yes | PASS | 可验证方法签名和返回类型 |
| FR-004 | 依赖图构建能力（可选） | Yes | PASS | 可验证可选方法的存在性/缺失 |
| FR-005 | 语言术语映射能力 | Yes | PASS | 可验证返回值结构和具体字段值 |
| FR-006 | 测试文件匹配模式 | Yes | PASS | 可验证正则模式和目录集合 |
| FR-007 | Registry 按扩展名查找 | Yes | PASS | 输入文件路径 → 返回适配器或 null |
| FR-008 | Registry 注册适配器 | Yes | PASS | 注册后查找应返回对应实例 |
| FR-009 | 注册时扩展名冲突检测 | Yes | PASS | 重复注册 → 抛出异常 |
| FR-010 | 查询已注册扩展名 | Yes | PASS | 返回 Set 可直接断言 |
| FR-011 | 聚合默认忽略目录 | Yes | PASS | 返回 Set 可直接断言 |
| FR-012 | Registry 单例模式 | Yes | PASS | 两次 getInstance() 返回 `===` 同一引用 |
| FR-013 | Registry 重置能力 | Yes | PASS | reset 后 getInstance 返回空白实例 |
| FR-014 | TsJsLanguageAdapter 实现 | Yes | PASS | 可验证 `implements LanguageAdapter` |
| FR-015 | 支持四种扩展名 | Yes | PASS | 可断言 `extensions` 集合内容 |
| FR-016 | analyzeFile 与现有行为一致 | Yes | PASS | golden-master 快照比对 |
| FR-017 | analyzeFallback 与现有行为一致 | Yes | PASS | 可对比新旧函数的输出 |
| FR-018 | 封装 dependency-cruiser 逻辑 | Yes | PASS | SHOULD 级别，可验证方法存在性 |
| FR-019 | TS/JS 术语映射 | Yes | PASS | 可断言具体术语值 |
| FR-020 | TS/JS 测试文件匹配模式 | Yes | PASS | 可用示例文件名验证正则 |
| FR-021 | 默认忽略目录 | Yes | PASS | 可断言集合包含 node_modules、dist 等 |
| FR-022 | LanguageSchema 扩展 | Yes | PASS | Zod parse 验证新旧值均通过 |
| FR-023 | ExportKindSchema 扩展 | Yes | PASS | 同上 |
| FR-024 | MemberKindSchema 扩展 | Yes | PASS | 同上 |
| FR-025 | filePath 正则放宽 | Yes | PASS | 用各种扩展名验证通过/拒绝 |
| FR-026 | 纯扩展（只增不减）约束 | Yes | PASS | 旧值 parse 不抛错 |
| FR-027 | file-scanner 扩展名动态获取 | Yes | PASS | mock Registry 验证扫描行为 |
| FR-028 | file-scanner 忽略目录聚合 | Yes | PASS | mock Registry 验证忽略行为 |
| FR-029 | 扫描选项支持显式扩展名 | Yes | PASS | SHOULD 级别，传入 override 验证 |
| FR-030 | 编排器通过 Registry 路由文件分析 | Yes | PASS | mock 适配器验证路由正确性 |
| FR-031 | 编排器通过 Registry 路由依赖图构建 | Yes | PASS | 同上 |
| FR-032 | 错误消息语言无关 | Yes | WARN | **建议**：明确列出需修改的消息原文和目标文案，当前仅提了"支持的源文件"示例 |
| FR-033 | CLI/MCP 启动自动注册 | Yes | PASS | 启动后 Registry 非空即可验证 |
| FR-034 | 未注册时明确报错 | Yes | PASS | 空 Registry 查询时断言错误信息 |
| FR-035 | 零行为变更约束 | Yes | PASS | golden-master 比对 |
| FR-036 | 零新增/移除运行时依赖 | Yes | PASS | package.json diff 比对 |

**小结**: 36/36 FR 均可测试。FR-032 的具体断言标准建议更明确。

---

## 3. FR → User Story 可追踪性

| FR | 追踪到的 User Story | 判定 |
|----|---------------------|:----:|
| FR-001 ~ FR-006 | US-2（接口定义是注册新语言的前提） | PASS |
| FR-007 ~ FR-013 | US-2（Registry 是注册的核心）、US-5（冲突检测） | PASS |
| FR-014 ~ FR-021 | US-1（TS/JS 封装保证零回归）、US-2（首个具体实现） | PASS |
| FR-022 ~ FR-026 | US-4（数据模型前向兼容） | PASS |
| FR-027 ~ FR-029 | US-1（file-scanner 参数化不破坏现有行为）、US-3（动态扩展名支持提示） | PASS |
| FR-030 ~ FR-031 | US-1（编排器零回归）、US-2（路由到新适配器） | PASS |
| FR-032 | US-3（友好提示） | PASS |
| FR-033 ~ FR-034 | US-1（自动初始化保证开箱即用） | PASS |
| FR-035 ~ FR-036 | US-1（零回归约束） | PASS |

**小结**: 所有 FR 均可追踪到至少一个 User Story。追踪关系合理。

---

## 4. 成功标准可量化性

| 成功标准 | 可量化 | 判定 | 备注 |
|----------|:------:|:----:|------|
| SC-001: 42 个测试文件 100% 通过 | Yes | PASS | 明确数字 + 百分比 |
| SC-002: golden-master 逐字节比对无差异 | Yes | PASS | "逐字节"是可量化的精确标准 |
| SC-003: 新增适配器仅需接口实现 + 1 次 register 调用 | Yes | WARN | "无需修改核心流水线文件"可量化为"修改文件数 = 0"；**建议**：补充"核心流水线文件"的精确清单（如 file-scanner.ts、single-spec-orchestrator.ts、batch-orchestrator.ts） |
| SC-004: 旧版 baseline JSON parse 不抛 ZodError | Yes | PASS | 明确的通过/失败判定 |
| SC-005: package.json dependencies 前后一致 | Yes | PASS | diff 比对 |
| SC-006: 适配器查找 O(1) | Yes | WARN | 时间复杂度是理论标准，实际不易测量；**建议**：明确实现方式为 `Map.get()`，这隐含 O(1) |
| SC-007: 新增单元测试 ≥ 20 个 | Yes | PASS | 明确数字下限 |

**小结**: 7/7 标准均可量化。SC-003 和 SC-006 的验证方式建议更具体。

---

## 5. 边界条件与 Edge Case 覆盖

### 5.1 spec.md 中已列出的 Edge Case

| Edge Case | 有对应 FR/验收场景 | 判定 |
|-----------|:-----------------:|:----:|
| 混合已支持和未支持文件扩展名 | US-3 场景 1 | PASS |
| Registry 无任何适配器时的错误信息 | FR-034 | PASS |
| 文件无扩展名或空字符串 | 仅在 Edge Case 列表中 | WARN |
| ts-morph 解析失败时降级到正则 fallback | FR-017 隐含 | PASS |
| Registry 单例保证 | FR-012 | PASS |
| resetInstance 后新实例无残留 | FR-013 | PASS |

### 5.2 建议补充的 Edge Case

| 缺失的 Edge Case | 建议归属 | 风险级别 |
|------------------|---------|:--------:|
| **符号链接文件**的扩展名解析（`link.ts` → 实际文件可能是 `.py`） | FR-007/FR-027 | 低 |
| **大小写敏感性**：`.TS` / `.Ts` 是否视为 TypeScript？ | FR-015/FR-025 | 中 |
| **隐藏文件**（`.hidden.ts`）是否被扫描？ | FR-027 | 低 |
| **空目录**作为扫描目标时的行为 | FR-027 | 低 |
| **adapter.analyzeFile 抛出异常**时编排器的错误处理策略 | FR-030 | 中 |
| **同一 adapter 实例被注册两次**的行为（非冲突，但重复） | FR-008/FR-009 | 低 |
| **扩展名含多个点**的文件（如 `file.test.ts`）的 `getAdapter` 行为 | FR-007 | 中 |
| **Registry 并发调用 register** 的线程安全性（Node.js 单线程下非问题，但异步场景下的 re-entrant 行为） | FR-008 | 低 |
| **filePath 正则**中 `.c` 和 `.h` 扩展名可能匹配到非 C/C++ 文件（如 Objective-C 的 `.h`） | FR-025 | 低 |

**小结**: spec 已列出 6 个 Edge Case，覆盖了主要场景。"文件无扩展名"缺少对应 FR 条目，建议提升为正式 FR 或在 FR-007 中明确。多点扩展名（`.test.ts`）和大小写敏感性是值得关注的中等风险点。

---

## 6. 术语一致性

| 检查项 | 判定 | 详情 |
|--------|:----:|------|
| "LanguageAdapter" 命名 | PASS | 全文统一使用，接口名、变量名、描述文字一致 |
| "LanguageAdapterRegistry" 命名 | PASS | 全文统一 |
| "TsJsLanguageAdapter" 命名 | PASS | 全文统一 |
| "CodeSkeleton" 命名 | PASS | 与现有代码库一致 |
| "golden-master" 术语 | PASS | US-1 和 SC-002 中一致使用 |
| "file-scanner" vs "scanFiles" | WARN | spec 中混用 `file-scanner`（文件名）和 `scanFiles`（函数名），语义一致但**建议**在 FR 中明确指代的是 `src/utils/file-scanner.ts` 模块 |
| "编排器" 指代范围 | WARN | FR-030 指 `single-spec-orchestrator`，FR-031 指 `batch-orchestrator`，但 FR-032 仅说"编排器"而未明确两者均需修改；**建议**：FR-032 明确列出受影响的编排器 |
| "LanguageTerminology" / "TestPatterns" 类型名 | PASS | 与 tech-research.md 中的设计一致 |
| "零行为变更" vs "零回归" | PASS | 含义一致，spec 中以"零行为变更"为主术语，验收场景中的用法清晰 |
| MUST / SHOULD 使用 | PASS | 遵循 RFC 2119 风格，MUST 用于必须项，SHOULD 用于推荐项 |

**小结**: 术语基本一致。有两处指代范围建议更精确。

---

## 7. 优先级标注合理性

| User Story | 标注优先级 | 评估合理性 | 判定 | 理由 |
|------------|:---------:|:---------:|:----:|------|
| US-1: TS/JS 无感知升级 | P1 | P1 | PASS | 零回归是核心约束，标注完全合理 |
| US-2: 注册新语言 | P1 | P1 | PASS | 建立抽象层是本 Feature 的核心价值，标注合理 |
| US-3: 非支持语言友好提示 | P2 | P2 | PASS | 改善用户体验但非核心架构，P2 合理 |
| US-4: 数据模型前向兼容 | P2 | P2 | WARN | 从用户资产保护角度看可考虑升至 P1（旧 baseline 不可用会直接影响现有用户）；但鉴于 FR-026 的"只增不减"设计使得风险很低，P2 可接受 |
| US-5: 扩展名冲突检测 | P3 | P3 | PASS | 防御性编程，当前阶段仅单适配器，P3 合理 |

### FR 级别隐含优先级评估

| 分组 | FR 范围 | 隐含优先级 | 合理性 |
|------|---------|:---------:|:------:|
| 接口定义 | FR-001 ~ FR-006 | P1 | PASS — 是 P1 US-2 的前提 |
| Registry | FR-007 ~ FR-013 | P1 | PASS — 核心基础设施 |
| TsJsAdapter 封装 | FR-014 ~ FR-021 | P1 | PASS — 零回归保障 |
| CodeSkeleton 扩展 | FR-022 ~ FR-026 | P2 | PASS — 前向兼容 |
| file-scanner 参数化 | FR-027 ~ FR-029 | P1 | PASS — 动态扩展的实际接入点 |
| 编排器路由 | FR-030 ~ FR-032 | P1 | PASS — 端到端路由 |
| 启动初始化 | FR-033 ~ FR-034 | P1 | PASS — 系统可用性基础 |
| 零变更约束 | FR-035 ~ FR-036 | P1 | PASS — 核心约束 |

**小结**: 优先级标注合理。US-4 可斟酌是否升至 P1，但当前 P2 在风险缓解措施充分的前提下可接受。

---

## 总评

| 检查维度 | 结果 | 评分 |
|----------|:----:|:----:|
| 1. User Story 验收场景完备性 | 5/5 有 GWT，US-5 场景略薄 | 4.5/5 |
| 2. FR 可测试性 | 36/36 可测试 | 5/5 |
| 3. FR → US 可追踪性 | 36/36 可追踪 | 5/5 |
| 4. 成功标准可量化性 | 7/7 可量化，2 项建议更具体 | 4.5/5 |
| 5. 边界条件覆盖 | 已列 6 个，建议补充 3-4 个中等风险项 | 4/5 |
| 6. 术语一致性 | 基本一致，2 处指代建议明确 | 4.5/5 |
| 7. 优先级合理性 | 标注合理，US-4 可斟酌 | 4.5/5 |
| **综合评分** | | **4.6/5** |

### 关键改进建议（按优先级排序）

1. **[中]** 补充"文件无扩展名"的正式 FR 条目，或在 FR-007 的描述中明确 `getAdapter()` 对无扩展名/空扩展名文件返回 `null` 的行为
2. **[中]** 补充"多点扩展名"（如 `.test.ts`）的 `path.extname()` 行为说明——`path.extname('file.test.ts')` 返回 `.ts` 而非 `.test.ts`，需确认这是预期行为
3. **[中]** 补充"大小写敏感性"的设计决策——`.TS` / `.Ts` 是否应被识别为 TypeScript
4. **[低]** US-5 补充正向场景（无冲突注册成功）和重复注册场景
5. **[低]** FR-032 明确列出需修改的所有编排器文件和具体消息原文
6. **[低]** SC-003 明确"核心流水线文件"的精确范围清单
7. **[低]** SC-006 补充"基于 Map.get() 实现"的具体说明

### 整体判定

**PASS（建议修订）** — spec 质量整体优秀，User Story 完整度高，FR 覆盖全面且可测试，追踪关系清晰。主要改进空间在边界条件补充和部分术语指代的精确化。建议在进入 plan 阶段前完成上述中等优先级的修订。
