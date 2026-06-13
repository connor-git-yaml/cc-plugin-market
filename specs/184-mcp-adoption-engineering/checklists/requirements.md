# F184 质量检查清单 — MCP 触发率工程

**生成时间**: 2026-06-13
**Spec 版本**: Draft（specs/184-mcp-adoption-engineering/spec.md）
**检查员**: quality-checklist 子代理

---

## 一、Content Quality（内容质量）

- [x] **无实现细节**：spec.md 未提及具体编程语言框架选择（TypeScript 仅以技术背景出现），未规定 HTTP 框架、打包方式等实现细节
- [x] **聚焦用户价值和业务需求**：每个 FR 均关联用户故事（US-1~US-5），说明子代理体验或维护者量化需求
- [x] **面向非技术利益相关者可读**：背景与问题陈述使用自然语言，数据（1.77/run，16/30 零调用）可直接理解
- [x] **所有必填章节已完成**：背景与问题陈述、用户故事（5 条）、Edge Cases（8 条）、功能需求（FR-001~FR-011）、Success Criteria（SC-001~SC-007）、复杂度评估、歧义处理均存在

---

## 二、Requirement Completeness（需求完整性）

- [x] **无 [NEEDS CLARIFICATION] 标记残留**：全文检索无此标记；F170d 三选项和 graph_node fuzzy 路径均标注为 AUTO-RESOLVED
- [x] **需求可测试且无歧义**：每个 FR 都有独立测试方式说明，SC-001~SC-006 均有可量化的验收条件
- [x] **成功标准可测量**：SC-001（E2E 测试返回 warnings）、SC-002（fuzzyMatches 字段存在）、SC-004（触发率 ≥2.5/run，零调用 ≤37%）均为可测量条件
- [x] **成功标准是技术无关的**：SC-001~SC-007 以行为结果表述，不约束实现方式
- [x] **所有验收场景已定义**：US-1 至 US-5 各有 2~4 条验收场景，EC-001~EC-008 均指明关联 FR
- [x] **边界条件已识别**：EC-001（graph-not-built 降级）、EC-002（多候选无高置信）、EC-003（空/无效 symbolId）、EC-004（envelope 向后兼容）、EC-005（instructions 传播未知）、EC-006（F193 scope 冲突）、EC-007（listTools 断言回归）、EC-008（阈值一致性）均已识别
- [x] **范围边界清晰**：FR-008 明确区分路径 A（做）/路径 B（deferred），spec 不允许二者混淆；FR-003 明确 write scope 边界（不碰 graph-query.ts）
- [x] **依赖和假设已识别**：依赖 F174 resolveSymbolFuzzy 已落地、依赖 F176 telemetry 基础设施、F193 scope 风险显式记录、SDK 签名已核实（@modelcontextprotocol/sdk 1.26.0）

---

## 三、Feature Readiness（特性就绪度）

- [x] **所有功能需求有明确的验收标准**：FR-001~FR-011 均在 Success Criteria 中有对应 SC（FR-001/FR-006/FR-011 → SC-006，FR-002 → SC-003，FR-003 → SC-001，FR-004 → SC-002，FR-005 → SC-005，FR-010 → SC-003/SC-004/SC-007）
- [x] **用户场景覆盖主要流程**：5 个用户故事涵盖 fuzzy 解析（US-1）、instructions 注入（US-2）、server 工具 description 补齐（US-3）、graph 工具 description 补齐（US-4）、A/B 评测量化（US-5）
- [x] **功能满足 Success Criteria 中定义的可测量成果**：SC-001~SC-007 逐一可与对应 FR 映射，无孤立 SC
- [x] **规范中无实现细节泄漏**：实施位置注记（如 src/mcp/server.ts:40）作为辅助信息标注，不约束实现方式；SDK 签名说明是 scope 风险提醒而非实现强制

---

## 四、FR 维度逐条验证项

### FR-001 — 响应 schema 向后兼容

- [ ] **验证方式**：运行 F180 44 个 stdio E2E（`npm run test:e2e` 或对应命令），确认所有工具响应 schema 无字段删除；在 vitest 中检索 `buildErrorResponse` 调用点，确认错误 envelope 顶层字段未新增；人工检查 `view_file` 成功响应的 `warnings` 字段仅在有内容时写入（非空才出现）

### FR-002 — MCP server instructions 字段注入

- [ ] **SDK 签名正确性（Codex C-002 核查）**：检查 `src/mcp/server.ts` 第 40 行附近，确认 `new McpServer({ name, version }, { instructions })` 格式——`instructions` 在**第二个 ServerOptions 参数**，而非第一个 serverInfo 对象；人工 grep `new McpServer` 确认参数位置
- [ ] **内容完整性**：unit test 或人工读取 server.ts，确认 instructions 字符串包含：(a) 17 工具分组导览、(b) 典型链路 `detect_changes → impact → context → view_file`、(c) graph-not-built 恢复流说明
- [ ] **非空验证**：`createMcpServer()` 返回的 server 实例通过 `getServerInfo()` 或等价接口确认 instructions 字段非空字符串

### FR-003 — view_file 接入 resolveSymbolFuzzy

- [ ] **SC-001 E2E**：stdio E2E 测试，传入 `src/mcp/server.ts::CreateMcpServer`（首字母大写偏差），断言返回成功响应、响应体含正确代码内容、`warnings` 含 `'fuzzy-resolved'`
- [ ] **confidence ≥ 0.9 自动采用**：E2E 或 unit test 确认唯一高分候选时自动 resolve，不中断调用链
- [ ] **阈值一致性（EC-008）**：grep `resolveSymbolFuzzy` 调用处，确认使用 `autoResolveThreshold: 0.9`，未引入新常量
- [ ] **scope 边界**：`git diff` 确认 `src/panoramic/graph/graph-query.ts` 及 F193 相关文件（`src/knowledge-graph/{index,persistence,incremental}.ts`）无新增编辑

### FR-004 — fuzzyMatches 候选结构与位置

- [ ] **SC-002 E2E**：stdio E2E 测试，传入无高置信解析的模糊 symbolId，断言返回错误响应、错误体 `context.fuzzyMatches` 存在且为 `Array<{ id: string; confidence: number }>`、最多 3 条、按 confidence 降序
- [ ] **与 F174 约定一致性**：对比 `src/mcp/agent-context-tools.ts:183/315` 的 fuzzyMatches 格式，确认字段名、类型、排序方式逐字段一致
- [ ] **位置约束**：确认 fuzzyMatches 放在 `context.fuzzyMatches`（`buildErrorResponse` 第 4 参 context 扩展点），而非错误 envelope 顶层

### FR-005 — server 5 工具 description 补齐至 4 要素

- [ ] **SC-005 代码审查**：读取 `src/mcp/server.ts` 中 `prepare`、`generate`、`batch`、`diff`、`panoramic-query` 5 个工具注册代码，逐一人工确认 description 包含：what（功能说明）、when（使用时机）、example（调用示例）、chained-usage（链路位置）
- [ ] **格式范本对照**：与 `src/mcp/file-nav-tools.ts:304-360` file-nav 3 工具 description 结构比对，确认 4 要素格式一致
- [ ] **listTools E2E 零回归（EC-007）**：运行 F180 stdio E2E，确认 listTools 17 工具断言全部通过

### FR-006 — 工具名称不变

- [ ] **名称不变验证**：运行 F180 stdio E2E `listTools` 断言，确认 17 工具名称与改动前完全一致；或 `git diff` 确认工具注册名称字符串无变更

### FR-007 — graph 6 工具 description 补 Use when / chained-usage（SHOULD）

- [ ] **代码审查**：读取 `src/mcp/graph-tools.ts`，对 `graph_query`、`graph_node`、`graph_path`、`graph_community`、`graph_god_nodes`、`graph_hyperedges` 6 个工具注册 description，逐一确认包含"Use when"和"chained usage"两项语义要素
- [ ] **vitest 零回归**：运行 `npx vitest run`，确认 4250+ 测试全部通过，无新增失败

### FR-008 — graph_node fuzzy（条件项，路径 A/B 二选一）

- [ ] **路径决议记录**：plan.md 和 tasks.md 中明确标注路径 A（做）或路径 B（deferred），不允许默默消失
- [ ] **（若路径 A）实现验证**：graph_node handler 层 fuzzy 预解析单测通过，候选/warnings 格式与 FR-003/FR-004 一致；`src/panoramic/graph/graph-query.ts` 无新增编辑
- [ ] **（若路径 B）deferred 记录**：plan.md、tasks.md、verification report 各含一行 deferred 事实 + 后续处理归属（F193 ship 后单独处理），FR-008 不计入本 feature pass 判定

### FR-009 — F170d 任务→工具映射提示（AUTO-RESOLVED MAY）

- [ ] **instructions 内容覆盖检查**：若选做，确认 FR-002 instructions 字符串中含有任务类型→推荐工具映射（如"代码定位任务 → context + view_file"）；若 A/B 显示 instructions 不传播，确认关键 chained-usage 已同时在各工具 description 中落地（FR-005/FR-007）

### FR-010 — A/B 评测基础设施复用

- [ ] **三件套凭据 verify**（跑批前必做）：
  - `grep -c "^export SILICONFLOW_API_KEY=" .env.local` 输出 `1`
  - `echo "say only ok" | claude --print --model claude-haiku-4-5 --max-turns 1 --output-format text` 输出 `ok`（Claude OAuth 可用）
  - `ls -la ~/.codex/auth.json` 文件存在且 mtime 近期（Codex CLI OAuth 可用）
- [ ] **成本预估列出**：跑批前在 chat 中列出预估成本（SiliconFlow API token 实付，订阅边际 0），等待用户明确确认后方可执行
- [ ] **A/B 规模满足最小要求**：2 cohort（改造前/改造后）× 3-5 个任务 × N=3
- [ ] **instructions 传播性结论**：A/B 报告对"instructions 是否传播到 Task 子代理"给出明确结论（正/负/部分传播），基于工具调用日志，非猜测

### FR-011 — 现有测试套件零回归

- [ ] **vitest 全量通过**：`npx vitest run` 输出 4250+ 测试全部 pass，零失败
- [ ] **build 零类型错误**：`npm run build` 无 TypeScript 错误
- [ ] **repo:check 全绿**：`npm run repo:check` 57 项全部通过
- [ ] **F180 stdio E2E 全通过**：运行 F180 44 个 stdio E2E，listTools 17 工具断言全部通过，F174 fuzzy E2E 无新增失败

---

## 五、Edge Cases 测试映射

- [ ] **EC-001（graph-not-built 降级）**：E2E 测试在 graph 未构建状态下调用 `view_file` 传入 symbolId，断言返回 `graph-not-built` 错误，提示"请先运行 `spectra batch`"；确认 fuzzy 路径不绕开此检查
- [ ] **EC-002（多候选无高置信）**：unit test 模拟多个候选均 < 0.9 场景，断言返回错误响应，`context.fuzzyMatches` 含 top-3 候选列表
- [ ] **EC-003（空/无效 symbolId）**：unit test 传入空字符串和纯空白字符串，断言 `resolveSymbolFuzzy` 返回空候选不抛异常，`resolveSymbolRange` 返回 `invalid-symbol-id` 错误
- [ ] **EC-004（envelope 向后兼容）**：成功响应中 `warnings` 字段仅在有内容时出现（unit test）；错误响应无新增顶层字段（`buildErrorResponse` 调用点 grep 核查）
- [ ] **EC-005（instructions 传播未知）**：A/B 评测报告中必须有明确结论，不允许以"未知"结案；若传播失败，记录替代方案评估（description 升级为主要载体）
- [ ] **EC-006（F193 scope 冲突）**：plan 阶段明确记录路径 A/B 决议；FR-003（view_file fuzzy）的交付不等待 FR-008 决议（二者在 tasks.md 独立分列）
- [ ] **EC-007（listTools 断言回归）**：F180 stdio E2E listTools 断言全通过，description 改动后工具名称无变更（git diff 核查）
- [ ] **EC-008（autoResolveThreshold 一致性）**：grep `resolveSymbolFuzzy` 调用处，确认阈值 `0.9` 与 F174 一致，无新阈值常量引入

---

## 六、A/B 评测前置项

- [ ] **SILICONFLOW_API_KEY 配置**：`grep -c "^export SILICONFLOW_API_KEY=" .env.local` 输出 1
- [ ] **Claude OAuth 可用**：`echo "say only ok" | claude --print --model claude-haiku-4-5 --max-turns 1 --output-format text` 输出 ok
- [ ] **Codex CLI auth 存在**：`ls -la ~/.codex/auth.json` 文件存在，mtime 近期
- [ ] **成本预估已列出并等待用户确认**：跑批前在 chat 中显示 SiliconFlow 预估 token 费用，收到用户明确"确认"后方执行
- [ ] **SC-004 诚实性声明遵守**：A/B 报告中不做假设检验/置信区间声明，仅报告点估计结果（信号为正/信号不足）

---

## 七、流程项

### 每 Phase Codex 对抗审查

- [ ] **Specify phase 完成后**：通过 Agent tool 启动 `codex:codex-rescue`，重点审查 spec.md 是否覆盖关键 FR + Edge Cases，是否有 over-claim；审查完成后记录结论（critical/warning/info 各几条）
- [ ] **Plan phase 完成后**：Codex 审查架构选择是否务实、FR-008 路径决议是否合理、scope 边界是否清晰
- [ ] **Tasks phase 完成后**：Codex 审查任务分解是否可测、FR-003 与 FR-008 是否独立分列、依赖关系是否合理
- [ ] **Implement phase 完成后**：Codex 对代码改动从"找漏洞"视角审查，重点检查 SDK 签名（Codex C-002）、fuzzy threshold 一致性（EC-008）、scope 边界（FR-003）
- [ ] **Verify phase 完成后**：Codex 审查验收是否真实达成（非纸面声称），尤其 SC-003 instructions 传播结论、SC-004 数据真实性

### Git 提交规范

- [ ] **排除 specs/src.spec.md 再生噪声**：每次 commit 使用显式路径 `git add specs/184-mcp-adoption-engineering/...`，禁止使用 `git add -A`，防止 `specs/src.spec.md` 再生产物污染 commit
- [ ] **feature 分支提交前同步 master**：`git rebase master`，不用 `git merge master`
- [ ] **push master 前 7 字段 report**：提交到 master 前在 chat 中列出：commit hash + summary、改动统计（new/modified 文件数 + 行数 +X/-Y）、关键 finding 总结、Codex 对抗审查结论（各档条数 + 处理情况）、verify 结果（vitest/build/repo:check/release:check）、rebase + 冲突解决状态、下一步建议；等待用户明确"确认 push"后方执行

### 收尾 Dogfooding 反馈

- [ ] **工具使用反馈节（四维度必填）**：交付报告末尾追加"工具使用反馈"节，覆盖：
  - MCP 是否可用（连接/工具/调用状态）
  - 返回信息是否够用（字段/上下文/next-step 提示）
  - 流程是否顺畅（gate/phase/产物体验）
  - 结果是否准确（impact/graph/fuzzy 等准确性）
  - 若本次未用 Spectra/Spec Driver，显式写明"未使用及原因"

---

## 汇总

| 分组 | 检查项数 |
|------|---------|
| Content Quality | 4 |
| Requirement Completeness | 8 |
| Feature Readiness | 4 |
| FR 维度验证项（FR-001~FR-011） | 29 |
| Edge Cases 测试映射（EC-001~EC-008） | 8 |
| A/B 评测前置项 | 5 |
| 流程项（Codex 审查 + Git + Dogfooding） | 12 |
| **合计** | **70** |

**整体状态**：Content Quality / Requirement Completeness / Feature Readiness 三大维度检查全部通过（[x]），无阻塞性质量问题。FR 维度验证项、EC 测试映射、A/B 前置项、流程项为待执行验证项（implement/verify 阶段填写）。
