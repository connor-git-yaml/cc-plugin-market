# OctoAgent 大规模重构 Session 反思 & Spec Driver 改进建议

> 基于 2026-04-05 一次持续 session 中对 OctoAgent 代码库的 12+ 项重构实施经验，
> 对 cc-plugin-market（reverse-spec + spec-driver）的架构和流程提出改进建议。

---

## 一、Session 背景

在一次连续的 Claude Code session 中完成了以下工作：

| 改动 | 规模 | 核心挑战 |
|------|------|---------|
| Feature 070: 权限系统简化 | 删 7 文件，改 7 文件 | 三套 Hook 合并为单函数，需要理解完整调用链后才能安全删除 |
| 安全边界: PathAccessPolicy | 新增 2 文件 | 设计白/黑/灰名单三级策略 |
| Feature 072: Core/Deferred 工具分层 | 改 6 文件 | 接通三个断开的链路，Review 发现 2 个 P0 bug |
| Feature 073: ToolProfile + Workspace 清除 | 改 48 文件 | 跨层级删除 deprecated 概念，SQLite DDL 需同步 |
| A1: capability_pack God Object 拆分 | 新增 15 文件，改 1 文件 | 5112 行→2052 行，47 个工具 handler 迁移 |
| A2: provider/dx 反向依赖消除 | 重写 1 文件 | CLI 改为 HTTP 调用 gateway API |
| A4: dx 运行时服务上移 | 迁移 27 文件 | 97 文件 import 路径替换 |
| A6: Butler 命名彻底清除 | 改 38 文件 | 枚举值/DB 迁移/文件路径/活跃逻辑全面替换 |
| Chat 模块改进 | 新增 1 hook，改 6 文件 | 智能滚动/Markdown 升级/memo/深色模式 |
| Blueprint 维护 | 16 处过时修复 + 3 节新增审计 | 架构文档与代码同步 |

---

## 二、反思：研发流程中反复出现的问题

### 问题 1: 改动后 Review 反复发现 P0 bug

**现象**: 几乎每次改动提交后，subagent Review 都能发现 P0 bug（如 `WORK_TERMINAL_VALUES` 大小写不匹配、`WorkProjectionItem` 字段名不一致、`_tool_promotion` 属性不存在等）。

**根因**: 大规模重构时，人工（或 AI）在改动过程中关注"移动代码"而忽略"验证一致性"。尤其是：
- 枚举值的大小写（StrEnum `.value` 是小写，常量写了大写）
- 模型字段名改了一侧没改另一侧
- 删除枚举值但未搜索所有引用方

**对 Spec Driver 的建议**:

1. **implement agent 应内置"一致性扫描"步骤**：在代码实现完成后、提交前，强制执行一轮"改动影响范围扫描"——搜索所有被修改的类型/枚举/字段的引用方，确认全部同步。当前 implement agent 的 prompt 中缺少这一步。

2. **verify agent 应区分"功能验证"和"一致性验证"**：当前 verify 只跑测试。应增加静态一致性检查（如 grep 搜索旧名称是否残留、类型定义和使用方是否匹配）。

### 问题 2: 架构文档（Blueprint）与代码持续脱节

**现象**: Blueprint 中 16 处描述与代码实际状态矛盾（已删的 PolicyEngine 仍被描述为"当前状态"、ToolProfile 枚举在 Blueprint 示例中仍然存在等）。

**根因**: 代码改动后没有流程强制更新文档。

**对 Spec Driver 的建议**:

3. **implement 阶段完成后，增加"文档同步检查"子步骤**：自动检查是否有架构文档（如 Blueprint、README、ADR）引用了被修改/删除的概念。可以通过 grep 被删除的函数名/类名在 docs/ 中的残留来实现。

4. **verify agent 增加"文档一致性"检查项**：在 verification-report-template.md 中增加一个检查维度——"架构文档是否与代码同步"。

### 问题 3: 大规模删除/迁移时遗留"半清理"状态

**现象**: Feature 073 删除 Workspace 概念时，先删了 Store 层参数再删 Gateway 层调用方，导致中间状态不可运行（Store 参数删了但调用方还在传）。同样，A4 迁移文件后，dx/ 内部的相对导入全部断开。

**根因**: 跨层删除/迁移缺乏"原子性"——改了底层但忘了改上层调用方。

**对 Spec Driver 的建议**:

5. **tasks agent 在分解大规模迁移任务时，应保证每个子任务的"原子性"**：每个子任务完成后系统应该能通过编译/测试。当前 tasks 模板缺少"原子性约束"指导。建议在 tasks-template.md 中增加：
   ```
   ## 原子性约束
   每个任务完成后，整个系统必须可以通过 `{verification_command}`。
   如果一个改动需要同时修改多个层级（如删除模型字段 + 删除 Store 参数 + 删除 Service 调用），
   这些修改必须在同一个任务中完成，而不是拆分到不同任务。
   ```

### 问题 4: subagent 的改动质量参差不齐

**现象**: 用 subagent 并行迁移工具模块时，一个 agent 把 `WORK_TERMINAL_VALUES` 定义为大写字符串（与 StrEnum 小写 `.value` 不匹配），另一个 agent 遗漏了文件内部的相对导入更新。

**根因**: subagent 缺乏"交叉验证"机制——每个 agent 只关注自己的任务，不检查与其他 agent 产出的一致性。

**对 Spec Driver 的建议**:

6. **implement agent 委派多个子任务后，应有"交叉一致性检查"步骤**：在所有并行子任务完成后，编排器应执行一轮全局扫描，确认：
   - 所有模块的 import 路径一致
   - 共享常量/类型的定义和使用一致
   - 没有引用了被其他子任务删除的符号

7. **quality-review agent 增加"跨模块一致性"检查维度**：当前 quality-review 主要关注单文件质量（命名、复杂度、测试覆盖），应增加跨文件检查（如 import 一致性、类型定义与使用的匹配）。

### 问题 5: 设计方案过度工程化后被简化

**现象**: Feature 070 最初设计了 ToolCallPlanner/Executor/ConflictDetector 三层抽象 + ParameterRiskEvaluator + CommandRiskClassifier + RateLimitEvaluator + 批量审批，最终用户一句"Claude Code 的策略是不是更清爽"推翻了全部设计，改为一个 `check_permission()` 函数。

**根因**: 调研了三个参考系统后，把"参考系统有这个能力"等同于"我们也需要这个能力"。缺乏"什么是最小必要设计"的判断框架。

**对 Spec Driver 的建议**:

8. **specify agent 应增加"最小必要性检验"**：在生成 spec 时，对每个拟定的组件/抽象/层级问一个问题："如果去掉这个，功能是否仍然可以实现？"如果答案是"可以，只是不够灵活/可扩展"，则默认不加（YAGNI）。

9. **plan agent 应明确标注"可选 vs 必须"**：在技术计划中，每个步骤/组件应标注为"必须"或"可选（等实际遇到需求再加）"。当前 plan-template.md 没有这个区分。

10. **GATE_DESIGN 的审查标准应包含"复杂度合理性"**：当前门禁主要审查"需求是否覆盖"，缺少"设计是否过度复杂"的审查维度。建议在 clarify/checklist 阶段增加一个明确的检查项："方案中是否有可以去掉而不影响核心功能的组件？"

---

## 三、对 Spec Driver 代码的具体改进建议

### 建议 11: implement agent 增加"改动后自检"步骤

当前 `implement.md` 的流程是：读 spec → 读 plan → 读 tasks → 逐任务实现 → 跑测试。

建议在"跑测试"之前增加一步：

```markdown
### 改动后自检（实现完毕、测试前）

1. 搜索所有被修改/删除的类型名、函数名、枚举值在整个代码库中的引用，确认无遗漏
2. 检查所有新增 import 路径是否正确（特别是文件迁移后的路径更新）
3. 如果修改了 Pydantic 模型字段，搜索所有构造该模型的代码，确认字段名匹配
4. 如果修改了枚举值，搜索所有 `.value` 比较，确认字符串大小写一致
```

### 建议 12: verify agent 增加"残留扫描"

当前 `verify.md` 主要运行测试命令。建议增加：

```markdown
### 残留扫描

如果本次改动涉及删除/重命名，执行以下检查：
1. `grep -rn "旧名称" src/ --include="*.{py,ts,tsx}" | grep -v test_` — 确认零残留
2. 如果修改了架构文档引用的概念，`grep -rn "旧概念" docs/` — 确认文档同步
3. 如果迁移了文件，确认旧位置无孤立文件
```

### 建议 13: story 模式增加"scope 评估"

当前 story 模式缺少对任务规模的评估。OctoAgent session 中多次出现"以为是小改动但实际涉及 40+ 文件"的情况。

建议 story SKILL.md 在 Phase 1 增加：

```markdown
### Scope 评估

在实现前评估改动规模：
1. 搜索受影响的文件数量
2. 如果 > 15 个文件或涉及跨包改动，建议切换到 Feature 模式
3. 如果涉及数据库 schema 变更，强制切换到 Feature 模式
```

### 建议 14: tasks 模板增加"原子性"和"验证点"

当前 `tasks-template.md` 的任务描述是平铺的 checklist。建议增加：

```markdown
## 任务原子性要求

- 每个任务完成后系统必须可以通过基础验证（编译/lint/单元测试）
- 跨层级改动（模型+Store+Service+API）必须在同一任务内完成
- 标注每个任务的验证命令

## 验证点

| 任务 | 完成后验证 |
|------|-----------|
| T1: ... | `npm test` / `uv run pytest` |
| T2: ... | `grep -rn "旧名称" src/` 确认零残留 |
```

### 建议 15: constitution 模板增加"文档同步规则"

基于 OctoAgent 的经验，建议在 constitution-template.md 中增加：

```markdown
## 文档同步

- 任何影响架构的代码改动完成后，必须同步更新架构文档中的相关描述
- 代码中删除的模块/概念不能在文档中继续描述为"当前状态"
- verify 阶段应检查文档一致性
```

### 建议 16: fix 模式增加"根因分析"深度

当前 fix 模式是：诊断 → 规划 → 修复 → 验证。在 OctoAgent session 中，多次出现"修了表面症状但遗漏了同类问题"（如改了 `_resolve_instance_root` 的一个调用但遗漏了另外三个）。

建议 fix SKILL.md 在诊断阶段增加：

```markdown
### 影响范围扫描

修复不仅是改一个点，需要确认：
1. 同一个 pattern 是否在其他位置也存在（搜索同名函数/相似逻辑）
2. 修复是否需要同步更新调用方、测试、文档
3. 是否有其他代码路径会触发相同的 bug
```

---

## 四、对 Spec Driver 架构的观察

### 优势（保持）

1. **Prompt-as-Code 零运行时依赖**：纯 Markdown + YAML + Bash，无需安装运行时
2. **门禁系统设计优秀**：5 个质量门 + strict/balanced/autonomous 三级策略，平衡了安全性和效率
3. **并行子代理调度**：RESEARCH_GROUP/DESIGN_PREP_GROUP/VERIFY_GROUP 通过 Task tool 实现真并行
4. **双运行时兼容**：Claude Code + Codex 通过 model_compat 无缝切换
5. **模板体系完整**：10 个制品模板覆盖了 SDD 全生命周期

### 可改进

1. **implement agent 的 prompt 偏重"做什么"而轻"检查什么"**：~80% 的内容在描述如何实现，只有 ~5% 在描述实现后的自检。应该至少 20% 的 prompt 空间用于指导"改完后如何验证一致性"。

2. **缺少"大规模重构"模式**：Feature/Story/Fix 三种模式都假设改动是局部的。当改动涉及 40+ 文件的全局命名替换或跨包迁移时，需要不同的策略（如分批迁移 + 中间验证 + 残留扫描）。可以考虑增加一个 `refactor` 模式。

3. **verify 阶段缺少"回归检查"**：当前只跑 `verification_command`（通常是测试命令）。应增加对"本次改动是否引入新问题"的定向检查——不仅是测试通过，还要确认没有引入新的坏味道、死代码、或文档脱节。

---

## 五、总结

本次 OctoAgent session 的核心教训是：**大规模重构的质量瓶颈不在"如何改"，而在"改完后如何确认改干净了"**。

Spec Driver 的 implement → verify 流程在"局部功能开发"场景下工作良好，但在"跨层级/跨包的全局重构"场景下，需要强化以下三个能力：

1. **改动影响范围的自动扫描**（改完后搜索所有受影响的引用方）
2. **跨模块一致性的自动验证**（类型/枚举/常量的定义和使用是否匹配）
3. **文档同步的自动检查**（架构文档是否与代码实际状态一致）

这些能力可以通过 implement/verify/quality-review 三个 agent 的 prompt 增强来实现，不需要新增代码或运行时依赖。
