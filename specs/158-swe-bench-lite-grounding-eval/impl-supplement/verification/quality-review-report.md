---
feature_id: "157"
reviewer: "quality-review 子代理"
review_date: "2026-05-09"
scope: "implement 完成后，与 spec-review 并行"
---

# Feature 158 代码质量审查报告

## 六维度评估

| 维度 | 评级 | 关键发现 |
|------|------|---------|
| 架构合理性 | GOOD | 新增脚本独立，不污染 SUPPORTED_TOOLS；telemetry hook 侵入最小，符合 plan.md 决策 |
| 设计模式合理性 | GOOD | `recordAndReturn` wrapper 覆盖全部 return 路径设计合理；`loadSpectraContextForSweBench` 自实现而非 hack runner 内部 map |
| 安全性 | GOOD | oracle check cmd 使用 `<SPECTRA_REPO_ROOT>` 替换机制可控；无硬编码凭证；子进程 spawn 无 shell 注入风险（args 数组形式） |
| 性能 | GOOD | `appendFileSync` 在 eval 场景下每 tool call 一次，SSD < 5ms 合理；fuzzy match O(n) 线性；标注了 sync 原因（Codex W5 评估已记录）|
| 可读性 | GOOD | 中文注释完整；函数命名清晰；关键决策点（为何 sync、为何 multiset 而非行 Jaccard）均有注释 |
| 可维护性 | NEEDS_IMPROVEMENT | `eval-mcp-augmented.mjs` 929 行超警戒线（WARNING 阈值 500 行）；`agent-context-tools.ts` 909 行接近上限 |

## 问题清单

| 严重程度 | 维度 | 位置 | 描述 | 修复建议 |
|---------|------|------|------|---------|
| WARNING | 可维护性 | `scripts/eval-mcp-augmented.mjs`（929 行） | 超出 500 行 WARNING 阈值（累积劣化检测 §1.5），包含 argv 解析、fixture 加载、三组 prompt 构造、worktree 管理、Claude spawn、oracle 执行、report 写入等多个职责混合 | 建议 Stage 7 实跑前将 `spawnClaudeAndWait`（L487-537）、`runOne`（L543-772）、`runForTaskList`（L778-843）拆为单独的 `eval-runner-core.mjs`，主脚本仅做入口；但评估阶段脚本若短期 discard 则不 CRITICAL |
| WARNING | 架构合理性 | `scripts/eval-mcp-augmented.mjs:227-228` | `buildFuzzyCmd` 中的 goldpatch.diff 路径拼接 `/tmp/${task_id}.actual.diff`：若 taskId 含特殊字符（如 `$`、`\``、`"`）会在 shell 层导致意外行为；当前 taskId 格式 `SWE-L00X-repo-desc` 实测无此风险，但无显式校验 | 在 `buildFixture` 或 `resolveOracleChecksPaths` 中对 taskId 做白名单正则断言（`/^SWE-L\d{3}-[a-z0-9\-]+$/`），构建时明确拒绝非预期格式 |
| WARNING | 可维护性 | `scripts/eval-mcp-augmented.mjs:740-741` | `realCostUsd` 硬编码为 `null`，注释说"暂置 null 待未来 LLM token usage 集成"，但 `costUsd` 字段在 run-N.json schema 中是必须字段；调用方读取时无明确默认行为 | 在 schema 注释和 plan.md 中显式说明 `costUsd=null` 的含义，或用 `0` 替代，避免消费方 null 判断歧义 |
| WARNING | 架构合理性 | `scripts/verify-feature-158.mjs:11` 注释 + L207-211 | 检查点 ⑤ 从 spec 约定的 §6 改为 §10（原因注释：§6 已被 fixture 清单占用），但 plan.md 和 spec.md 仍写的是 §6；两份文档与验收脚本实现不一致，将来维护者会困惑 | 在 plan.md §成功标准 SC-005 处补注记录"实际使用 §10，因 §6 被 fixture 清单占用"，避免文档与代码不一致 |
| INFO | 可维护性 | `scripts/eval-mcp-augmented.mjs:201` `isMain` 判断 | `import.meta.url === 'file://${process.argv[1]}'` 与 `process.argv[1]?.endsWith(...)` 双重判断有逻辑冗余；`eval-diff-fuzzy-match.mjs:201` 也有同样 pattern | 统一为 `process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)` 以避免路径别名误判（`../scripts/eval-mcp-augmented.mjs` vs 绝对路径场景） |
| INFO | 可读性 | `scripts/swe-bench-fixture-import.py:159-201` | `select_with_degradation` 三段降级逻辑正确，但降级路径的 `reason` 字符串非常长且含格式化，读测试或 debug 时难解析 | 用枚举常量（`DEGRADED_STRICT_THRESHOLD` / `DEGRADED_FALLBACK` / `DEGRADED_DATASET_MAX`）替代拼接字符串 |
| INFO | 可维护性 | `tests/unit/mcp/telemetry.test.ts` | 仅测试 `handleImpact` 的 telemetry，未覆盖 `handleContext` 和 `handleDetectChanges` 的同类 4 状态矩阵；三个 handler 的 `recordAndReturn` 逻辑相同，理论上单测覆盖 impact 即可推断，但缺少对 toolName 字段正确性的验证 | 可选：在 telemetry.test.ts 各加一个 smoke test 验证 `handleContext({ symbolId: '' })` 和 `handleDetectChanges({})` 写入的 JSONL toolName 正确（3 行，低成本）|

## Feature 155 合同保护评估

| 检查项 | 结论 |
|--------|------|
| `handleImpact` / `handleContext` / `handleDetectChanges` input schema 变更？ | 未变更。三个 handler 签名与 Feature 155 完全一致 |
| output schema 变更？ | 未变更。`recordAndReturn` 原样返回 `ToolResult`，不修改 content |
| `SPECTRA_MCP_TELEMETRY_PATH` 未设置时行为变化？ | 无变化。`writeTelemetry` 首行 no-op guard 保证 |
| 全量 vitest 3484 PASS 含 Feature 155 既有 test cases？ | 是。`tests/unit/mcp/agent-context-tools.test.ts` 是 Feature 155 的主测试，已包含在 3484 pass 中（verify 通过） |

## 安全性补充说明

- `oracle.checks[].cmd` 内容含用户数据（taskId 作为 tmp 文件名后缀），但经 `resolveOracleChecksPaths` 替换后作为 shell 字符串执行（`runPrimaryOracle` 内部通过 `sh -c` 运行）。当前 taskId 格式 `SWE-L00X-[a-z0-9\-]+` 不含危险字符，但建议加白名单断言（已列为 WARNING）。
- `SPECTRA_MCP_RUN_ID` / `SPECTRA_MCP_TELEMETRY_PATH` 通过 env 传递，不含 API key 等敏感信息，安全。
- Python 脚本的 `problem_statement` 截取 200 字符用于 description，不做 XSS 处理，但 fixture 是内部产物非用户直接输入，可接受。

## CLAUDE.md 约定遵守度

| 约定 | 遵守状态 |
|------|---------|
| 函数单一职责 | 部分 — `runOne` 函数 230 行含多职责（WARNING）|
| 命名清晰 | 完全遵守 |
| 关键 why 注释 | 完全遵守（appendFileSync 理由、multiset 而非行 Jaccard 理由均已注释）|
| 类型安全 | 部分 — 三个 `.mjs` 脚本均无 TypeScript 类型；TypeScript 部分（telemetry.ts, agent-context-tools.ts）类型注解完整 |
| 提交前验证 | 完全遵守（vitest 3484 PASS / build 0 error / repo:check 通过）|
| 模型选择 | 遵守（implement 用 Opus）|

## 总体质量评级

**GOOD**

评级依据：
- CRITICAL：0 个
- WARNING：4 个（均为设计权衡或文档不一致，不影响功能正确性）
- INFO：3 个（低优先级改进建议）
- Feature 155 合同完整保护，telemetry hook 静默降级路径覆盖完整
- 核心算法（multiset Jaccard）实现正确，单测 15 cases 边界覆盖充分
- 主要质量风险集中在 eval-mcp-augmented.mjs 行数偏大（929 行），属于 eval 脚本可接受的复杂度，非生产服务代码

## 建议（低优先级，留下次重构）

1. **eval-mcp-augmented.mjs 拆分**：Stage 7 实跑完成后，若该脚本被纳入长期维护，建议拆分为入口（argv/validation）+ runner core（spawn/oracle）+ report（write run-N.json）三个模块。当前阶段属于 eval 脚本，可接受一定复杂度。

2. **handleContext / handleDetectChanges telemetry smoke test**：在 telemetry.test.ts 各补 1 个 case，验证 toolName 字段值正确写入（各 +5 行，成本极低）。

3. **plan.md §6 / §10 章节号矛盾**：在 plan.md SC-005 处补注说明实际使用 §10，消除文档与代码不一致。

### 问题分级汇总

- CRITICAL：0 个
- WARNING：4 个
- INFO：3 个
