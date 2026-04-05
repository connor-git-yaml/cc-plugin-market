# Spec Driver 优化建议——基于 OctoAgent 10,000+ 行重构实战反思

> **背景**：本文来自 OctoAgent（Personal AI OS，Python，10+ 个子包）连续 3 个月使用 Spec-Driven Development 的实战经验。
> 期间经历了：Memory 模块从未工作过（6 层 silent failure）、God Class 膨胀到 5,112 行、3 次循环依赖、4 次 force push 丢 commit、Blueprint 膨胀到 3,558 行无人读等真实问题。
> 以下建议按**实际痛点严重程度**排序，每条都有真实案例支撑。

---

## 一、Implement 阶段：最大的黑箱

### 问题 1.1：implement agent 是整个流水线最弱的环节

**实际经历**：OctoAgent 的 Memory 模块经过完整的 spec → plan → tasks 流程后，implement 阶段产出的代码有 6 层 silent failure chain（LITELLM_MASTER_KEY 未注入 → Qwen3 thinking 模式返回空 → scope 解析返回 None → partition 枚举不匹配 → turn 数量无上限 → cursor 不推进）。每层都 catch 了异常然后返回空结果，表面上"没有报错"，实际上**一条记忆都没写入过**。

**根因分析**：当前 implement.md 的"验证铁律"只要求`运行验证命令 + 退出码 0 + 输出摘要`。但：
- `npm test` 通过不等于功能正确（Mock 测试可以 100% 通过但实际运行一塌糊涂）
- 退出码 0 不等于行为正确（silent failure 就是退出码 0）
- 没有要求**端到端行为验证**（发消息 → 数据库有记录）

**建议**：

```markdown
### implement.md 增强：三层验证要求

#### Layer 1（现有）：工具链验证
- 构建通过 + Lint 通过 + 单元测试通过

#### Layer 2（新增）：行为验证
- 对每个 FR 的 happy path，必须描述一个可观测的端到端验证步骤
- 示例："发送包含个人信息的消息 → 查询 memory 表 → 确认至少 1 条 SoR 记录"
- 如果无法在当前环境执行端到端验证，必须明确标注 `[E2E_DEFERRED]` 及原因

#### Layer 3（新增）：失败路径验证
- 对每个涉及外部依赖的模块，至少验证 1 个失败场景的行为
- 示例："LLM 返回空响应时 → 不应 silent fail → 应有明确错误日志"
- 禁止使用 bare except / catch-all 吞掉异常后返回空结果
```

### 问题 1.2：implement 产出的代码容易架构劣化

**实际经历**：
- `CapabilityPackService` 在 10+ 次 implement 后膨胀到 5,112 行（60 个工具 handler 全作为闭包内嵌）
- `MemoryService` 膨胀到 2,260 行、25 个方法、5 种职责混合
- `control_plane.py` 膨胀到 11,707 行
- 每次 implement 都"完成了 tasks.md 上的 checkbox"，但没有人检查是否引入了结构性退化

**根因**：tasks.md 分解的粒度是功能维度（"添加 X 功能"），不是架构维度（"在正确的位置添加 X"）。implement agent 倾向于把新代码塞进现有最近的文件，而不是思考是否需要拆分。

**建议**：

```markdown
### tasks.md 增强：架构守护条目

在 tasks.md 末尾增加一个 `## Architecture Guard` 节：

- [ ] T-GUARD-001 [P1] 本次改动涉及的最大文件行数不超过 500 行（若超过，先拆分再实现）
- [ ] T-GUARD-002 [P1] 新增代码不引入循环依赖（检查方式：grep 延迟 import）
- [ ] T-GUARD-003 [P1] 新增的公共方法不超过 5 个/文件（若超过，考虑拆分子模块）
- [ ] T-GUARD-004 [P2] 新增代码不引入 bare except / catch-all-return-empty 模式

这些条目由 plan agent 在规划阶段自动生成，implement agent 必须逐条检查。
```

---

## 二、Verify 阶段：检查太表面

### 问题 2.1：verify 的 Spec-Code 对齐检查过于形式化

**实际经历**：verify agent 逐条检查 FR，看到"memory.search 工具已注册"就标记 ✅。但实际上：
- 工具注册了但 scope 解析永远返回 None
- 数据库写入了但没有 commit（缺 `await conn.commit()`）
- LLM 调用成功了但 `enable_thinking=False` 没有传递到底层

这些问题 verify 阶段完全没发现，因为它只检查"代码是否存在"而不是"代码是否正确运行"。

**建议**：

```markdown
### verify.md 增强：增加 Layer 1.5 深度检查

当前 Layer 1（Spec-Code 对齐）只检查"FR 对应的代码是否存在"。
新增检查项：

1. **关键路径完整性**：对每个 FR 追踪完整调用链（入口 → 中间层 → 底层），检查链路上是否有断点
   - 特别关注：参数是否在传递链路中丢失（如 `**kwargs` 断链）
   - 特别关注：异常是否在中间层被吞掉

2. **数据持久化验证**：涉及数据库写入的 FR，检查是否有 commit/flush
   - SQLite: `conn.commit()` 是否存在
   - ORM: session.flush() / session.commit() 是否在正确位置

3. **配置贯穿验证**：涉及配置项的 FR，检查配置值是否从配置源一路传递到使用点
   - 检查: env var → config loader → service constructor → 实际使用
```

### 问题 2.2：quality-review 发现问题但不阻断

**实际经历**：quality-review 多次指出"God Class 趋势""职责混合""文件行数过大"，但这些只是 WARNING 级别，从不阻断。结果：每次 review 都在说同样的问题，但代码持续劣化，直到某天不得不花整整 2 天做大规模重构。

**建议**：

```markdown
### quality-review.md 增强：累积劣化检测

新增一个 STRUCTURAL_DEBT 维度：
- 检查目标文件修改前后的行数变化
- 如果单文件行数从 < 300 增长到 > 500：WARNING
- 如果单文件行数从 < 500 增长到 > 800：CRITICAL（应阻断 implement，要求先拆分）
- 如果同一个文件在连续 3 个 Feature 中都被修改且行数持续增长：CRITICAL

这不是"代码质量"问题，而是"架构劣化"问题。
```

---

## 三、Spec / Plan 阶段：与实际代码脱节

### 问题 3.1：spec 写的很漂亮但不接地气

**实际经历**：Memory 模块的 spec 完整描述了 SoR/Fragments/Vault 三线记忆、6 分区、写入仲裁等能力。但 spec 里没有提到：
- 当前代码中 `workspace_id` 到处存在（59 处引用），是个已废弃但未清理的概念
- `MemoryService` 已经有 25 个方法，再往里加功能会变成 God Class
- 现有 LLM 调用路径不支持 `extra_body` 参数透传

结果：implement 阶段才发现这些问题，不得不边写功能边做大量底层修复。

**建议**：

```markdown
### specify.md / plan.md 增强：Codebase Reality Check

在 specify 阶段（或 plan 阶段）新增一个必选步骤：

**Step: Codebase Audit（代码现实检查）**

子代理（或 implement 前的 plan agent）必须：
1. 读取将要修改的目标文件，记录当前行数和公共方法数
2. 检查目标模块的已知 debt（deprecated 字段、TODO 注释、延迟导入）
3. 如果发现需要先清理才能安全添加功能，在 tasks.md 中增加前置清理任务

输出格式：
```yaml
codebase_audit:
  target_files:
    - path: packages/memory/service.py
      current_lines: 2260
      public_methods: 25
      known_debt: ["workspace_id 59 处引用", "VaultAccessDecision 枚举已废弃"]
  prerequisite_cleanup:
    - "移除 workspace_id 参数（影响 59 处调用点）"
    - "MemoryService 需先拆分为子服务 + Facade"
  risk_flags:
    - "LLM 调用链不支持 extra_body 透传，需先修复 provider 层"
```
```

### 问题 3.2：plan 阶段没有评估改动范围的风险

**实际经历**：一个看似简单的"清理 workspace_id"任务，实际影响了 59 个文件、跨 5 个包。plan 阶段完全没有预估这个爆炸半径，tasks 也只写了"移除 workspace_id"一条任务。实际执行中花了 3 倍预估时间。

**建议**：

```markdown
### plan.md 增强：Impact Radius 评估

plan agent 在输出技术方案时，必须增加一个 Impact Assessment 节：

## Impact Assessment

| 维度 | 评估 |
|------|------|
| 影响文件数 | ~60 个（grep 'workspace_id' 的结果） |
| 跨包影响 | memory, provider, gateway, core, tooling |
| 数据迁移 | 需要（sqlite 表字段变更） |
| API 变更 | 是（MemoryService 公共方法签名变更） |
| 向后兼容 | 否（需要全量更新调用方） |
| 预估风险等级 | HIGH（爆炸半径大，建议分多个 PR） |

如果 impact 评估为 HIGH，plan 必须建议分阶段实施策略。
```

---

## 四、Constitution 与门禁：需要更实际的约束

### 问题 4.1：Constitution 偏抽象，缺少可检测的硬约束

**实际经历**：OctoAgent 的 Constitution 写了"Architecture Cleanliness"原则，但没有可量化的检测条件。结果就是——原则一直挂在墙上，代码一直在劣化。

**建议**：

```markdown
### constitution.md 增强：可检测约束

在 Constitution 中增加"Measurable Guardrails"节：

## Measurable Guardrails（可量化约束）

以下约束在 implement 和 verify 阶段必须检查：

1. **单文件行数上限**：800 行（超过必须拆分后再提交）
   - 检查方式：`wc -l` 新增/修改的文件

2. **单函数行数上限**：50 行（超过必须拆分）
   - 检查方式：AST 或简单行数统计

3. **循环依赖零容忍**：包之间不允许循环 import
   - 检查方式：`grep -r "from.*import" | 检查图环`

4. **Silent Failure 零容忍**：禁止 catch 异常后返回空结果而不记录日志
   - 检查方式：`grep -n "except.*:.*return \[\]" / "except.*:.*return None" / "except.*:.*pass"`

5. **Dead Code 零容忍**：不允许提交注释掉的代码块
   - 检查方式：检测连续 3 行以上的注释代码
```

### 问题 4.2：GATE_DESIGN 是唯一硬门禁，太少了

**实际经历**：GATE_VERIFY 虽然标记为 always，但实际上 verify 的检查太表面（见 §2.1），所以相当于没有有效的验证门禁。大量问题在"verify 通过"后才在生产环境暴露。

**建议**：将 GATE_VERIFY 的实际检查深度加强（见 §2 的建议），而不仅仅是形式上的 always。同时考虑：

```markdown
### 新增 GATE_IMPLEMENT_MID（实现中期门禁）

在 implement 完成 50% 任务后插入一个轻量级检查点：
- 检查已完成任务的代码是否引入了架构劣化信号
- 检查是否有 tasks 的前置假设已经被推翻（如发现底层 API 不支持预期行为）
- 如果发现问题，在此时调整 plan 比完成后再重构成本低得多

触发方式：implement agent 在完成 tasks.md 的 50% checkbox 时自动触发
默认策略：on_failure（发现问题才暂停）
```

---

## 五、状态管理与恢复：需要更强的断点续跑

### 问题 5.1：resume 的上下文恢复不够精确

**实际经历**：OctoAgent 开发中频繁遇到 context window 用尽导致对话断开。恢复后 Agent 经常：
- 重复已完成的工作（没有正确识别断点）
- 遗漏刚才发现但未记录的问题
- 丢失 in-progress 状态（如"正在等待用户确认 X"）

**建议**：

```markdown
### resume.md 增强：结构化断点信息

要求 implement agent 在每个 task 完成后，更新一个 `.specify/features/NNN/execution-state.json`：

{
  "last_completed_task": "T003",
  "in_progress_task": "T004",
  "discovered_issues": [
    "provider 层不支持 extra_body 透传，已临时绕过，需后续修复"
  ],
  "pending_decisions": [
    "workspace_id 清理是否在本 Feature 内完成？等用户确认"
  ],
  "modified_files": ["packages/memory/service.py", "apps/gateway/main.py"],
  "architecture_notes": "MemoryService 已拆分为 4 子服务 + Facade"
}

resume agent 读取此文件后可以精确恢复上下文，而不是重新扫描整个 feature 目录。
```

---

## 六、跨 Feature 一致性：最容易被忽略的问题

### 问题 6.1：多个 Feature 并行或串行修改同一模块时缺少协调

**实际经历**：Feature 066（Memory Recall）和 Feature 067（Session Memory Pipeline）都修改了 `MemoryService`。066 添加了 recall 相关方法，067 添加了 extractor 相关方法，两个 Feature 各自通过了 verify，但合并后 `MemoryService` 就变成了 25 个方法的 God Class。

**建议**：

```markdown
### analyze.md 增强：跨 Feature 冲突检测

在一致性分析阶段新增一个检查维度：

**Cross-Feature Impact Check**：
1. 扫描 specs/ 目录中最近 5 个 Feature 的 tasks.md
2. 提取它们修改的文件列表
3. 如果当前 Feature 要修改的文件在最近 Feature 中也被修改过：
   - 标注为 OVERLAP_WARNING
   - 检查累积修改是否导致文件超过行数阈值
   - 建议：是否需要先做一次结构性清理
```

---

## 七、文档与代码同步：Blueprint 劣化问题

### 问题 7.1：蓝图文档膨胀到无人阅读

**实际经历**：OctoAgent 的 `docs/blueprint.md` 从初始 ~1500 行膨胀到 3,558 行。每次 Feature 完成后都往里追加状态更新，但从不清理已过时的内容。最终：
- 没有人（包括 AI）会完整读一遍
- 加载到 context 占 14K tokens（约 10% 窗口）
- 同一个功能在不同章节有互相矛盾的描述

最终不得不做一次 -87% 的多层级索引重构。

**建议**：

```markdown
### spec-driver-sync.md 增强：文档健康度检查

在 sync 生成产品活文档时，增加文档健康度指标：

1. **膨胀检测**：如果 current-spec.md 超过 1000 行，建议拆分为索引 + 子文档
2. **陈旧检测**：标注最近 3 个 Feature 未触及的章节为"可能过时"
3. **矛盾检测**：如果同一个概念在不同章节有不同描述（如一处说"3 层"另一处说"4 层"），标注为 INCONSISTENCY
4. **术语一致性**：检查已删除的代码概念是否仍在文档中被描述为"当前状态"
```

---

## 八、Story 和 Fix 模式：太依赖 Feature 模式的简化

### 问题 8.1：Fix 模式缺少根因分析

**实际经历**：OctoAgent 多次修一个 Bug 时只 fix 了表面症状，没有追溯根因。例如：
- "Memory 页面显示 0 条记录" → fix 了前端查询 → 实际上是后端从未写入过
- "LLM 调用返回 401" → fix 了 API key → 实际上是 master key 注入机制缺失

修了 5 次才发现 6 层 failure chain 的真正根因。

**建议**：

```markdown
### spec-driver-fix SKILL.md 增强：Root Cause Analysis 阶段

在 Fix 模式的 Phase 1（诊断）中增加：

**Step: 5-Why 根因追溯**

要求 fix agent 对报告的 Bug 做 5-Why 分析：
1. 为什么 Memory 页面是空的？→ 因为 SoR 表没有数据
2. 为什么 SoR 没有数据？→ 因为 commit_memory 从未被调用
3. 为什么 commit_memory 未调用？→ 因为 scope 解析返回 None
4. 为什么 scope 返回 None？→ 因为新项目没有自动注册 memory namespace
5. 为什么没有自动注册？→ 因为 ensure_auto_scope 方法不存在

输出：root cause chain（JSON 格式），从表面症状到根本原因。
fix 范围必须针对根因，而不是最表面的症状。
```

---

## 九、总结：优先级排序

| 优先级 | 建议 | 预期收益 | 实施复杂度 |
|--------|------|---------|-----------|
| **P0** | §1.1 implement 三层验证 | 消除 silent failure（最大痛点） | 中 |
| **P0** | §2.1 verify 深度检查 | 发现"代码存在但不工作"的问题 | 中 |
| **P0** | §4.1 可量化架构约束 | 在问题产生时就阻断，而非事后重构 | 低 |
| **P1** | §1.2 架构守护条目 | 防止 God Class 再次出现 | 低 |
| **P1** | §3.1 Codebase Reality Check | 让 spec/plan 接地气 | 中 |
| **P1** | §8.1 Fix 根因分析 | 修一次就够，不再反复修 | 低 |
| **P2** | §2.2 累积劣化检测 | 渐进式架构守护 | 中 |
| **P2** | §3.2 Impact Radius 评估 | 预防"看似简单实际爆炸"的任务 | 低 |
| **P2** | §5.1 结构化断点 | 改善 resume 精确度 | 低 |
| **P2** | §7.1 文档健康度检查 | 防止文档膨胀到无人读 | 低 |
| **P3** | §4.2 实现中期门禁 | 更早发现偏差 | 中 |
| **P3** | §6.1 跨 Feature 冲突检测 | 多人/多 Feature 协作场景 | 高 |

---

## 附：OctoAgent 实际重构数据（供参考）

| 指标 | 数值 | 说明 |
|------|------|------|
| Memory 模块从未工作到正常 | 修复 6 层 failure chain | 每层都 silent fail |
| MemoryService God Class | 2,260 行 → 680 行 Facade + 4 子服务 | -70% |
| CapabilityPackService | 5,112 行 → 2,052 行 + builtin_tools/ 子包 | -60%, 47 个工具迁移 |
| control_plane.py | 11,707 行 → 12 个独立模块 | 彻底拆分 |
| blueprint.md | 3,558 行 → 453 行索引 + 11 个子文档 | -87% |
| workspace_id 清理 | 59 处引用全部移除 | 跨 5 个包 |
| 循环依赖修复 | tooling ↔ policy | SideEffectLevel 下沉到 core |
| force push 导致 commit 丢失 | 4 次 | 最终加入禁止规则 |
