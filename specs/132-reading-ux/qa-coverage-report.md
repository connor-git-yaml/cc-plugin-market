---
feature: F5 Reading UX
branch: 132-reading-ux
phase: implement
subphase: step-5-qa-coverage
created: 2026-04-20
---

# F5 问答覆盖率报告（T-042 / T-043）

## 1. Citation 结构覆盖率（mock 验证）

### 测试策略

由于 `ANTHROPIC_API_KEY=UNSET`，真实 LLM 问答质量验证标注 `[E2E_DEFERRED]`。

已通过 **mock 集成测试** 验证 Citation 结构正确性：
- 使用 mock LLM（Anthropic SDK mock）
- 使用 mock 图谱数据（5 个节点 + 1 个 hyperedge）
- 使用 mock embedding provider
- 验证所有 Citation 的 **specPath / lineRange / excerpt** 三字段完整性

```
命令: npx vitest run --project unit tests/panoramic/qa/qa-integration.test.ts
退出码: 0
测试结果: 10 tests passed, 0 failed
```

### FR-011 五类问题覆盖结果

| 问题类型 | 测试用例数 | Citation 覆盖率（结构） | 状态 |
|---------|-----------|----------------------|------|
| 类型 1：调用关系（"什么调用了 X"） | 2 | 100% | ✅ mock 验证通过 |
| 类型 2：调用路径（"从 A 到 B 的路径"） | 2 | 100% | ✅ mock 验证通过 |
| 类型 3：设计决策映射（"X 的设计决策"） | 1 | 100% | ✅ mock 验证通过 |
| 类型 4：技术债（"最老的 TODO"） | 2 | 100% | ✅ mock 验证通过 |
| 类型 5：流程归属（"Y 流程涉及哪些模块"） | 2 | 100% | ✅ mock 验证通过 |
| 溯源正确性（R6 缓解） | 1 | 100%（三字段必填） | ✅ mock 验证通过 |

**总计：10 次 mock 调用，100% Citation 结构覆盖（三字段：specPath + lineRange + excerpt）**

### Citation 格式验证

- ✅ `specPath`：非空字符串
- ✅ `lineRange.startLine`：number 类型
- ✅ `lineRange.endLine`：number 类型
- ✅ `excerpt`：非空字符串
- ✅ hyperedge citation：`specPath = '[graph hyperedge]'`，`lineRange = { startLine: 0, endLine: 0 }`

## 2. 问答性能测量（T-042 性能子章节）

**[E2E_DEFERRED]**：真实问答性能测量需要 Anthropic API Key。

### 性能目标（SC-002 / plan §8 Story 2 性能）

| 场景 | 目标 | 状态 |
|------|------|------|
| 问答冷启动（embedding provider 首次加载） | < 20 秒 | [E2E_DEFERRED] |
| 问答热启动（embedding singleton 已加载） | < 5 秒 | [E2E_DEFERRED] |

### 代码级性能实现验证

已通过代码审查确认以下性能优化机制存在：

| 机制 | 文件 | 状态 |
|------|------|------|
| embedding provider singleton（R2 缓解） | `src/panoramic/qa/rag-reranker.ts` | ✅ 已实现 |
| `durationMs` 计算和日志输出 | `src/panoramic/qa/index.ts` | ✅ 已实现（`[info] qa: ... total_ms=X`） |
| BFS < 3 节点时跳过 embedding（`fallback='rag-only'`） | `src/panoramic/qa/graph-retriever.ts` | ✅ 已实现 |

### verify 阶段性能测量命令

```bash
# 确认 API Key 已设置
[ -n "$ANTHROPIC_API_KEY" ] && echo "SET" || echo "UNSET"

# 通过 MCP 调用问答（冷启动）
# 工具：panoramic-query，operation: natural-language
# 观察日志中的 total_ms 值

# 或直接调用
npx tsx src/cli/index.ts batch <project_root> --mode=reading
# 然后通过 MCP 问 5 类问题各 3 次（共 15 次）
```

## 3. SC-004 差异化点验证（T-043 — hyperedge Citation）

**[E2E_DEFERRED]**：真实 hyperedge Citation 验证需要 API Key。

### mock 结构验证

已通过 `qa-integration.test.ts` 验证：
- mock 数据包含 1 个 hyperedge（登录流程：3 节点）
- 类型 5（流程归属）问题返回的 citation 含 `specPath: '[graph hyperedge]'`
- citation 格式合法（specPath + lineRange + excerpt 三字段）

### verify 阶段验证步骤（SC-004）

```
1. 对含 F4 hyperedge 数据的项目运行 spectra batch --mode=reading
2. 通过 MCP panoramic-query 问："X 对应哪个设计决策"
3. 验证返回的 Citation 中至少 1 条 specPath 指向含 [conceptually_related_to] 区块的 spec
```

## 4. 风险标记

- **R6 缓解**：Citation 定位准确性——已通过 mock 单测验证三字段格式；实际 specPath 定位精度需 verify 阶段真实问答验证
- **E2E_DEFERRED 范围**：问答质量（是否回答准确）、实际性能数值（冷/热启动时间）、真实 hyperedge Citation 精度
- **非 DEFERRED 范围**：Citation 结构完整性（已验证）、pipeline 调用链（单测 10 条全绿）
